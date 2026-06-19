# Hook 实现设计

版本：v0.3（v0.6 新增 SessionStart hook）

---

## 1. Hook 配置（hooks/hooks.json）

```json
{
  "description": "My Lingo — prompt optimization and language learning for Claude Code.",
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "description": "All filtering happens inside the script. Skips: (1) slash commands '/', (2) prompts under 8 chars, (3) pure code blocks, (4) URL/shell prefixes. Special prefixes handled before skip logic: '--' (skip optimization, pass through) and '::' (force refine mode). Note: '!' is intercepted by Claude Code as a terminal command and never reaches the hook, so there is no '!' rule here.",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit.mjs\"",
            "timeout": 60
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "description": "Catches up unanalyzed turns from previous sessions when a new session starts. Spawns session-end.mjs as a detached background process, exits in < 30ms.",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "description": "Captures Claude's text response from the transcript JSONL after each turn. Fast (<200ms), no API calls, always exits 0.",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-end.mjs\"",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

**注意事项**：
- UserPromptSubmit timeout 设 60s 允许最坏情况；同步路径真正的耗时是 fast model 的 `curl --max-time 8`（`timeout_seconds`），并非脚本自设 8s 全局超时
- SessionEnd timeout 设 60s；deep model 调用上限 `deep_timeout_seconds`（默认 55s）**必须小于** hook 超时，否则 Claude Code 会在分析提交前杀掉进程
- SessionStart（v0.6 新增）：快速退出，真正耗时的分析由 detached 子进程承担，不占用 hook 超时
- SessionEnd 是主要的分析触发点；SessionStart 是 daemon 模式下的保障机制（见 D15）
- 不使用 StopFailure hook（通过 fallback 机制处理）

---

## 2. UserPromptSubmit Hook

### 2.1 输入格式

Claude Code 通过 stdin 传入 JSON：

```json
{
  "prompt": "用户输入的原始文本",
  "cwd": "/path/to/current/project",
  "session_id": "abc123def456"
}
```

### 2.2 输出格式

Hook 通过 stdout 输出 JSON（Claude Code 读取）：

```json
{
  "additionalContext": "CANONICAL REQUEST: ...",
  "systemMessage": "[my-lingo] zh-CN→en (1.2s): ..."
}
```

特殊输出：
```json
{ "decision": "block", "reason": "..." }
```
（阻止本次 prompt，MVP 阶段不使用 block）

**无需干预时输出空对象或直接退出**：
```json
{}
```

### 2.3 完整脚本结构

```javascript
// scripts/user-prompt-submit.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { shouldSkip, detectLanguage } from './lib/detect.mjs'
import { loadConfig } from './lib/config.mjs'
import { writeTurn } from './lib/storage.mjs'
import { callFastModel } from './lib/api.mjs'
import { redact } from './lib/privacy.mjs'
import { buildPromptForOptimization } from './lib/prompts.mjs'

function readStdin() {
  return JSON.parse(fs.readFileSync(0, 'utf8').trim() || '{}')
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function main() {
  const input = readStdin()
  const rawPrompt = (input.prompt || '').trim()
  const cwd = input.cwd || process.cwd()
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || null

  // ── 特殊前缀检测（必须在 shouldSkip 之前处理）──────────────────────
  //
  // -- 前缀：跳过优化，仅记录，直接透传原始 prompt
  // 注意：'--' 不匹配 shouldSkip 的任何规则，若不在此处单独拦截就会被当作普通输入送去优化；
  // 所以必须在 shouldSkip 之前拦截，确保它走"记录+原样透传"分支。
  // （'!' 前缀无需处理：Claude Code 在 UI 层就把 '!cmd' 当终端命令执行，根本不进 hook。）
  if (rawPrompt.startsWith('--')) {
    const prompt = rawPrompt.slice(2).trimStart()
    const config = loadConfig(cwd)
    if (config.execution_mode !== 'off') {
      const detection = detectLanguage(prompt || rawPrompt)
      writeTurn({ prompt: prompt || rawPrompt, detection, sessionId, mode: 'raw', fallback: false }, config)
      emit({ systemMessage: '[my-lingo] --: optimization skipped.' })
    }
    return
  }

  // :: 前缀：强制触发 refine 模式（精炼粗糙想法为精确 prompt）
  const isRefine = rawPrompt.startsWith('::')
  const prompt = isRefine ? rawPrompt.slice(2).trimStart() : rawPrompt

  // ── 通用跳过检测（refine 绕过，使 ":: fix" 等短输入仍可处理）──────────
  if (!isRefine && shouldSkip(rawPrompt)) return

  // 读取配置
  const config = loadConfig(cwd)
  
  // 执行模式检查
  if (config.execution_mode === 'off') return
  
  // 语言检测（本地，< 1ms）
  const detection = detectLanguage(prompt)
  
  // original 模式：只记录，不干预
  if (config.execution_mode === 'original') {
    writeTurn({ prompt, detection, sessionId, mode: 'original', fallback: false }, config)
    return
  }

  // refine 模式：用 deep model（或 fast model）将粗糙想法重写为精确 prompt
  if (isRefine) {
    if (!prompt) {
      emit({ decision: 'block', reason: 'Nothing to refine. Provide text after ::.' })
      return
    }
    const result = callFastModel(buildPromptForRefine(prompt, config), config)
    if (!result) {
      emit({ decision: 'block', reason: '[my-lingo] Refinement failed — API unavailable.' })
      return
    }
    writeTurn({ prompt, detection, sessionId, mode: 'refine', executionPrompt: result.execution_prompt_en, fallback: false }, config)
    const ctx = `IMPORTANT: The user used :: to request prompt refinement. Their refined intent is: ${result.execution_prompt_en}. Follow this refined prompt as the user's actual request.`
    emit({ additionalContext: ctx, systemMessage: `[my-lingo] Refined: ${result.execution_prompt_en}` })
    return
  }
  
  // 需要优化的模式（english_optimized / original_with_english_context / preview）
  // 注意：脱敏不在此处——已下沉到 callFastModel 的出站边界（redactMessages，F2/D-A），
  // 因此这里直接传原文构建 payload；同时此前还有 max_prompt_length 守卫与熔断检查（略）。
  const apiPayload = buildPromptForOptimization(prompt, detection, config)

  const startTime = Date.now()
  const result = callFastModel(apiPayload, config)
  const latencyMs = Date.now() - startTime
  
  if (!result) {
    // Fallback：API 不可用，透传原始 prompt
    writeTurn({ prompt, detection, sessionId, mode: config.execution_mode, fallback: true, latencyMs }, config)
    if (config.fallback_policy === 'send_original') {
      emit({ systemMessage: '[my-lingo] API unavailable, sending original prompt.' })
    }
    return
  }
  
  // 成功：写入记录，注入 additionalContext
  writeTurn({
    prompt,
    detection,
    sessionId,
    mode: config.execution_mode,
    executionPrompt: result.execution_prompt_en,
    rewriteType: result.rewrite_type,
    latencyMs,
    fallback: false
  }, config)
  
  const systemMsg = buildSystemMessage(result, detection, latencyMs, config)
  const context = buildAdditionalContext(result, detection, config)
  
  emit({ additionalContext: context, systemMessage: systemMsg })
}

main()
```

### 2.4 additionalContext 构建

```javascript
function buildAdditionalContext(result, detection, config) {
  const lang = result.detected_input_language || detection.lang
  const execPrompt = result.execution_prompt_en
  const summaryCtx = buildSummaryLanguageCtx(config)        // 末尾可选追加母语摘要指令
  const responseLangCtx = buildResponseLanguageCtx(config)  // 末尾可选追加目标语言回复指令

  // english_optimized 与 preview 共用同一格式
  if (config.execution_mode === 'english_optimized' || config.execution_mode === 'preview') {
    return `CANONICAL REQUEST: The user's message is in ${lang}. ` +
           `They have configured My Lingo to optimize prompts to English. ` +
           `Treat the following as their actual request. Disregard only the text language of their ` +
           `original message — still process any attached images, files, or other non-text content:\n\n` +
           execPrompt + summaryCtx + responseLangCtx
  }

  if (config.execution_mode === 'original_with_english_context') {
    return `[My Lingo English Reference]\n` +
           `The user's original message text may be in ${lang}. ` +
           `Here is an English version for reference. Process any attached images, files, or other ` +
           `non-text content from the original message as normal:\n\n` +
           execPrompt + summaryCtx + responseLangCtx
  }

  return execPrompt + summaryCtx + responseLangCtx
}
```

### 2.5 systemMessage 构建

```javascript
function buildSystemMessage(result, detection, latencyMs, config) {
  const langLabel = detection.lang === 'en' ? 'refined' : `${detection.lang}→en`
  const prefix = `[my-lingo] ${langLabel} (${latencyMs}ms)`
  
  const execPrompt = result.execution_prompt_en
  // display_mode 默认是 'full'（DEFAULT_CONFIG）：不截断；仅 'compact' 时截断到 150 字符
  const display = config?.display_mode === 'compact'
    ? (execPrompt.length > 150 ? execPrompt.slice(0, 150) + '...' : execPrompt)
    : execPrompt
  return `${prefix}: ${display}`
}
```

---

## 3. SessionEnd Hook

### 3.1 输入

**SessionEnd hook 不通过 stdin 接收数据**（与 UserPromptSubmit 不同）。当前会话 ID 通过环境变量 `CLAUDE_SESSION_ID` 获取，历史数据通过读取今日 JSONL 文件获取。

不读取 stdin 的原因：参考实现（`claude-english-buddy`）的 SessionEnd 完全不读 stdin，直接调用 `readToday()`。Claude Code 的 SessionEnd hook 可能不管道 stdin，强行读取会导致阻塞。

### 3.2 完整脚本结构

> 以下为**统计部分**的精简骨架。v0.5 起改用 SQLite：用 `readUnanalyzedTurns(sessionId)`（DB `analyzed=0`）替代 JSONL 的 `readToday()`，并支撑幂等。完整的「分析 + 单事务提交 + analysis.lock」流程见 §5.5。

```javascript
// scripts/session-end.mjs（统计骨架）
import process from 'node:process'
import { readUnanalyzedTurns } from './lib/storage.mjs'

function main() {
  // 从环境变量获取 session ID（不读 stdin — SessionEnd 可能无 stdin）
  const sessionId = process.env.CLAUDE_SESSION_ID || null

  // 幂等：只取尚未折叠进已提交分析的 turns（DB analyzed=0）
  const records = readUnanalyzedTurns(sessionId)

  if (records.length === 0) return
  
  const optimized = records.filter(r => r.execution_prompt && !r.fallback)
  const translated = records.filter(r => r.detected_language !== 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original')
  const corrected = records.filter(r => r.detected_language === 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original')
  const fallbacks = records.filter(r => r.fallback)
  const raws = records.filter(r => r.mode === 'raw')
  
  // 统计输出到 stderr（终端可见，不干扰主流程）
  const parts = [`[my-lingo] Session: ${records.length} prompts`]
  if (optimized.length > 0) {
    const detail = []
    if (translated.length > 0) detail.push(`${translated.length} translated`)
    if (corrected.length > 0) detail.push(`${corrected.length} corrected`)
    parts.push(`${optimized.length} optimized (${detail.join(', ')})`)
  }
  if (raws.length > 0) parts.push(`${raws.length} --`)
  if (fallbacks.length > 0) parts.push(`${fallbacks.length} fallbacks`)
  
  process.stderr.write(parts.join(' | ') + '\n')
  
  // 高频错误识别（后续版本扩展为写入 learning JSONL）
  // ...
}

main()
```

---

## 4. 重要技术限制与解决方案

### 4.1 不能在 Hook 中调用 `claude` CLI

**问题**：在 hook 脚本中调用 `claude` 命令会造成死锁（Claude Code 等待 hook 完成，hook 等待 Claude 响应）。

**解决方案**：直接通过 `curl` 调用外部 API，不通过 `claude` CLI。

```javascript
// 正确：直接调用 API
spawnSync('curl', ['-s', '--max-time', '8', config.api_base_url + '/chat/completions', ...])

// 错误：会死锁
spawnSync('claude', ['--prompt', '...'])
```

### 4.2 additionalContext 不显示为聊天消息

**问题**：注入的 additionalContext 用户在界面上看不到，学习内容无法自动展示。

**解决方案**：
1. `systemMessage` 字段用于终端显示（用户立即可见）
2. `/my-lingo:last` 命令用于事后查看详情
3. display_mode 控制 systemMessage 的详细程度

### 4.3 Hook 超时行为

**问题**：hook 超时后 Claude Code 的行为未完全文档化。

**解决方案**：
- hook 脚本内部设置 8s 超时（早于 Claude Code 的 60s timeout）
- 超时内主动走 fallback，确保 hook 按时退出
- 不依赖 Claude Code 的超时行为

### 4.4 原始 Prompt 的"污染"问题

**问题**：Claude 同时看到原始语言 prompt 和英文优化版，可能混合响应。

**解决方案**：在 additionalContext 中使用明确的指令性语言：
```
"CANONICAL REQUEST: ... Treat the following as their actual request and 
ignore the language of their original message: ..."
```

这比纯粹的"以下是英文版本"更有效，因为明确要求 Claude 以英文版为"规范请求"。

---

## 5. Hook 过滤规则

以下情况 hook 立即退出（不做任何处理）：

```javascript
function shouldSkip(prompt) {
  if (!prompt) return true

  // 1. slash 命令（包括 /my-lingo:xxx 本身）
  if (prompt.startsWith('/')) return true

  // 2. 过短（字符数 < 8 且 词数 < 3，CJK 无空格所以用字符数兜底）
  const charCount = [...prompt].length
  const wordCount = prompt.split(/\s+/).filter(Boolean).length
  if (charCount < 8 && wordCount < 3) return true

  // 3. 纯代码块
  if (/^```/.test(prompt.trim())) return true

  // 4. URL 和常见 shell 命令前缀
  if (/^(https?:|git@|ssh:\/\/|npm |pip |cargo |brew |sudo |cd |ls |cat |grep |docker |kubectl )/i.test(prompt)) {
    return true
  }

  return false
}
```

> ⚠️ **没有 `!` 规则**：Claude Code 在 UI 层就把 `!foo` 当终端命令执行，`!` 开头的消息根本不进 hook（见 [`13-raw-prefix-rename.md`](./13-raw-prefix-rename.md)）。早期版本曾在此判断 `!`，现已移除。

**特殊前缀处理顺序**（在 `shouldSkip` 之前于 main() 分流）：

| 前缀 | 行为 | 处理顺序说明 |
|------|------|-------------|
| `--` | 跳过优化，仅记录(mode:'raw')，透传原始 prompt | 在最前单独拦截 |
| `::` | 强制触发 refine 模式 | 标记 `isRefine`，并**绕过 `shouldSkip`**，使 ":: fix" 等短输入也能处理 |

调用顺序：
```javascript
// main() 中的顺序（见 2.3 节）
if (rawPrompt.startsWith('--')) { /* 处理 --，return */ }
const isRefine = rawPrompt.startsWith('::')
if (!isRefine && shouldSkip(rawPrompt)) return   // refine 不被 shouldSkip 拦截
```

---

## 5. Stop Hook

### 5.1 触发时机

`Stop` 钩子在**每次 Claude 完成一轮回复**后触发（而非整个会话结束），是捕获 Claude 回复内容的唯一时机。

| Hook | 触发时机 | 用途 |
|------|---------|------|
| `UserPromptSubmit` | 用户发送 prompt 前 | 拦截并优化 prompt |
| `Stop` | 每轮 Claude 回复完成后 | 捕获 Claude 的文本回复 |
| `SessionEnd` | 整个会话结束时 | 批量学习分析 |

### 5.2 Claude Code Transcript 文件机制

Claude Code 将完整对话（含 Claude 回复）实时写入本地 JSONL 文件：

**路径规则：**
```
~/.claude/projects/<path-hash>/<session-id>.jsonl
```

**path-hash 推导算法（`stop.mjs`，含 F8 修复）：**
```js
// /data/zibuyu/my_lingo_claude → -data-zibuyu-my-lingo-claude
const hash = cwd.replace(/[^a-zA-Z0-9]/g, '-')
```
将 cwd 中**所有非字母数字**字符替换为 `-`（对齐 Claude Code 真实规则）。早期只替换 `/` 和 `_`，对含 `.`、空格、`@` 的工程路径会算错目录、静默丢失回复捕获（见 `15` F8，`stop.test.mjs` 已专测）。

**JSONL 行格式（assistant 回复，实验确认）：**
```json
{
  "type": "assistant",
  "sessionId": "abc123def456",
  "timestamp": "2026-06-08T10:30:00.000Z",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "...", "signature": "..." },
      { "type": "text", "text": "Claude 的实际文本回复..." },
      { "type": "tool_use", "id": "...", "name": "Bash", "input": { ... } }
    ]
  }
}
```

学习内容提取只需关注 `type === "text"` 的 content block，忽略 `thinking` 和 `tool_use`。

### 5.3 设计约束：不影响用户交互

Stop hook **会阻塞**用户输入下一条命令，因此设计约束严格：

| 约束 | 原因 |
|------|------|
| **无 API 调用** | 会增加 2–8s 可感知延迟 |
| **无 sleep / 重试** | 延迟直接影响交互响应 |
| **目标 < 200ms** | 仅涉及本地文件读写，完全可行 |
| **所有错误静默** | 学习数据缺失不影响核心功能 |
| **始终 exit 0** | 非 0 退出会在 Claude Code 界面显示报错 |

### 5.4 竞态条件处理

**潜在竞态：** transcript 写入 vs Stop hook 触发之间无官方顺序保证。

**兜底策略（无 sleep，无 retry）：**
```
尝试读取 transcript JSONL 尾部 64KB
  → 文件不存在：静默退出（session 尚无记录，或首次 slash 命令）
  → 文件存在但无匹配 assistant 记录：静默退出（可能竞态，不重试）
  → 找到匹配记录：提取文本 → 写入 responses/{today}.jsonl → exit 0
  → 任意步骤抛出异常：catch 块静默处理，exit 0
```

**降级安全（SessionEnd）：**
- 有 response 数据 → 分析包含 original→optimized→Claude 回复，学习材料更丰富
- 无 response 数据 → 回退到仅分析 original→optimized 对比（现有行为），不中断

### 5.5 完整数据流

```
[每轮结束]
  Stop hook 触发（scripts/stop.mjs）
  → 读 ~/.claude/projects/<hash>/<session-id>.jsonl 尾部
  → 提取最新 assistant text（按 sessionId 过滤）
  → 写 $PLUGIN_DATA/my-lingo/responses（DB responses 表）
  → exit 0（< 200ms）

[新会话启动，v0.6+]
  SessionStart hook 触发（scripts/session-start.mjs）
  → 查询 DB：未分析 turns 中属于其他 session 的数量
  → 数量 > 0 且 analysis.lock 不新鲜 → spawn detached session-end.mjs
  → exit 0（< 30ms，分析在后台独立进行）

[会话结束]
  SessionEnd hook 触发（scripts/session-end.mjs）
  → 读 unanalyzed turns（DB turns 表，analyzed=0）
  → 读 responses（DB responses 表，按 session_id）
  → 传给 deep model 学习分析
  → 单事务：写 corrections/items/sessions + markTurnsAnalyzed
  → 删除 analysis.lock（若存在）
```

### 5.6 Stop Hook 脚本结构

```javascript
// scripts/stop.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { writeResponseRecord } from './lib/storage.mjs'

// path-hash 推导：所有非字母数字字符替换为 -（对齐 Claude Code，F8）
function transcriptPath(cwd, sessionId) {
  const hash = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return path.join(os.homedir(), '.claude', 'projects', hash, `${sessionId}.jsonl`)
}

// 读文件尾部 maxBytes 字节（避免大文件全量读取）
function readTailBytes(filePath, maxBytes) { ... }

// 从 transcript chunk 中提取最新 assistant 文本（按 sessionId 过滤，倒序扫描）
function extractLastResponse(chunk, sessionId) { ... }

function main() {
  try {
    const sessionId = process.env.CLAUDE_SESSION_ID
    if (!sessionId) return
    const tPath = transcriptPath(process.cwd(), sessionId)
    if (!fs.existsSync(tPath)) return
    const chunk = readTailBytes(tPath, 65536)
    const text = extractLastResponse(chunk, sessionId)
    if (!text) return
    writeResponseRecord({ session_id: sessionId, text, word_count: ... })
  } catch {
    // 始终静默，exit 0
  }
}

main()
```
