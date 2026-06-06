# Hook 实现设计

版本：v0.2

---

## 1. Hook 配置（hooks/hooks.json）

```json
{
  "description": "My Lingo — prompt optimization and language learning for Claude Code.",
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "description": "Filter slash commands, pure code blocks, and short prompts inside the script. The hook skips: (1) prompts starting with '/', (2) prompts starting with '!', (3) prompts under 8 chars, (4) pure code blocks, (5) URL/command prefixes.",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit.mjs\"",
            "timeout": 60
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
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

**注意事项**：
- timeout 设为 60（UserPromptSubmit）允许最坏情况，实际通过脚本内部限制在 8s
- SessionEnd 替代原设计的 Stop hook（SessionEnd 是正确的会话结束钩子）
- 不使用 StopFailure hook（MVP 阶段通过 fallback 机制处理）

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
  const prompt = (input.prompt || '').trim()
  const cwd = input.cwd || process.cwd()
  const sessionId = input.session_id || null

  // 快速跳过检测
  if (shouldSkip(prompt)) return

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
  
  // 需要优化的模式
  const redactedPrompt = redact(prompt, config.privacy_mode)
  const apiPayload = buildPromptForOptimization(redactedPrompt, detection, config)
  
  const startTime = Date.now()
  const result = callFastModel(apiPayload, config)
  const latencyMs = Date.now() - startTime
  
  if (!result) {
    // Fallback
    writeTurn({ prompt, detection, sessionId, mode: config.execution_mode, fallback: true, latencyMs }, config)
    if (config.fallback_policy === 'send_original') {
      emit({ systemMessage: '[my-lingo] API unavailable, sending original prompt.' })
    }
    return
  }
  
  // 成功
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
  const lang = detection.lang
  const execPrompt = result.execution_prompt_en
  
  if (config.execution_mode === 'english_optimized') {
    return `CANONICAL REQUEST: The user's message is in ${lang}. ` +
           `They have configured My Lingo to optimize prompts to English. ` +
           `Treat the following as their actual request and ignore the language of their original message:\n\n` +
           execPrompt
  }
  
  if (config.execution_mode === 'original_with_english_context') {
    return `[My Lingo English Reference]\n` +
           `The user's original message may be in ${lang}. ` +
           `Here is an English version for reference:\n\n` +
           execPrompt
  }
  
  // preview mode: same as english_optimized
  return buildAdditionalContext(result, detection, { ...config, execution_mode: 'english_optimized' })
}
```

### 2.5 systemMessage 构建

```javascript
function buildSystemMessage(result, detection, latencyMs, config) {
  const langLabel = detection.lang === 'en' ? 'refined' : `${detection.lang}→en`
  const prefix = `[my-lingo] ${langLabel} (${latencyMs}ms)`
  
  const execPrompt = result.execution_prompt_en
  const truncated = execPrompt.length > 150
    ? execPrompt.slice(0, 150) + '...'
    : execPrompt
  
  // compact mode（默认）：一行摘要
  return `${prefix}: ${truncated}`
  
  // full mode：多行
  // return `${prefix}\n→ ${execPrompt}`
}
```

---

## 3. SessionEnd Hook

### 3.1 输入

SessionEnd hook 的 stdin 包含会话信息（具体字段依 Claude Code 版本而定）。My Lingo 主要依赖 `session_id` 过滤本次会话的 turns。

### 3.2 完整脚本结构

```javascript
// scripts/session-end.mjs
import process from 'node:process'
import { readToday } from './lib/storage.mjs'

function main() {
  const input = JSON.parse(process.stdin.read() || '{}')
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID
  
  const allRecords = readToday()
  const records = sessionId
    ? allRecords.filter(r => r.session_id === sessionId)
    : allRecords
  
  if (records.length === 0) return
  
  const optimized = records.filter(r => r.execution_prompt && !r.fallback)
  const translated = records.filter(r => r.detection?.lang !== 'en' && !r.fallback)
  const corrected = records.filter(r => r.detection?.lang === 'en' && !r.fallback)
  const fallbacks = records.filter(r => r.fallback)
  const skipped = records.length - optimized.length - fallbacks.length
  
  // 统计输出
  const parts = [`[my-lingo] Session: ${records.length} prompts`]
  if (optimized.length > 0) {
    const detail = []
    if (translated.length > 0) detail.push(`${translated.length} translated`)
    if (corrected.length > 0) detail.push(`${corrected.length} corrected`)
    parts.push(`${optimized.length} optimized (${detail.join(', ')})`)
  }
  if (skipped > 0) parts.push(`${skipped} skipped`)
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
  // 1. slash 命令（包括 /my-lingo:xxx 本身）
  if (prompt.startsWith('/')) return true
  
  // 2. shell 命令前缀（! 是 Claude Code 的 shell 执行语法）
  if (prompt.startsWith('!')) return true
  
  // 3. 过短（字符数 < 8）
  if ([...prompt].length < 8) return true
  
  // 4. 纯代码块
  if (/^```/.test(prompt.trim())) return true
  
  // 5. URL 和常见命令前缀
  if (/^(https?:|git@|ssh:\/\/|npm |pip |cargo |brew |sudo |cd |ls |cat |grep )/i.test(prompt)) {
    return true
  }
  
  return false
}
```

特殊前缀（不跳过，改变行为）：
- `::` → 强制触发 refine 模式
- `!raw` → 跳过优化，仅记录（这里 `!raw` 不是 shell 命令，需在 shouldSkip 之前单独处理）
