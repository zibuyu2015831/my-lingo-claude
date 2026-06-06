# My Lingo v0.1 MVP — Implementation Plan

> **使用方法**：将第一节的文字直接粘贴到 Claude Code 的 `/goal` 命令中。
> Claude 将自主读取本文档、参考 `dev_docs/`，按阶段完成实施并验证。

---

## 一、/goal 条件文本（直接粘贴使用）

```
Read IMPLEMENTATION_PLAN.md in the project root and implement My Lingo v0.1 MVP as
specified. Consult dev_docs/ for design details. Work Phase 0 → 5 in sequence,
running npm test after each phase.

DONE when ALL of the following hold:

1. npm test exits 0 — all unit tests pass

2. These files exist and are non-empty:
   .claude-plugin/plugin.json
   hooks/hooks.json
   scripts/user-prompt-submit.mjs
   scripts/session-end.mjs
   scripts/lib/detect.mjs
   scripts/lib/config.mjs
   scripts/lib/storage.mjs
   scripts/lib/api.mjs
   scripts/lib/prompts.mjs
   scripts/lib/privacy.mjs
   commands/my-lingo/setup.md
   commands/my-lingo/status.md
   commands/my-lingo/last.md
   commands/my-lingo/mode.md

3. Hook skip behavior verified (run these, all must exit 0):
   echo '{"prompt":"/my-lingo:status"}' | node scripts/user-prompt-submit.mjs
   echo '{"prompt":"ok"}' | node scripts/user-prompt-submit.mjs

4. !raw escape works (must NOT be silently skipped as a shell command):
   echo '{"prompt":"!raw test this please"}' | node scripts/user-prompt-submit.mjs
   → stdout contains "systemMessage" with "!raw"

5. package.json has no "dependencies" key (zero npm packages)

HARD CONSTRAINTS — never violate:
- !raw and :: prefixes handled BEFORE shouldSkip() in user-prompt-submit.mjs
- session-end.mjs does NOT read stdin (no readFileSync(0) or stdin.read())
- recordApiSuccess() called after every successful callFastModel() result
- All file paths built with path.join(), never string-concatenated with input
- config.json written with mode 0o600

Or stop after 40 turns.
```

---

## 二、项目背景与架构摘要

My Lingo 是一个 Claude Code 插件，通过 `UserPromptSubmit` hook 拦截用户输入，
调用外部 AI API 将其优化为标准英文执行 Prompt，并通过 `additionalContext` 注入
Claude。同时记录每次交互，为语言学习提供素材。

**完整设计文档**：`dev_docs/`（11 份文档，本文档是其可执行摘要）

**核心约束**：
- 零 npm 依赖（只用 Node.js 标准库 + 系统 `curl`）
- 不能在 hook 中调用 `claude` CLI（死锁）
- Hook 超时：`hooks.json` 中 60s，脚本内部 curl `--max-time 8`
- 参考实现：`claude-english-buddy-ref/`（可随时阅读对比）

---

## 三、目录结构（实施结束后应存在）

```
my-lingo-claude/
├── .claude-plugin/
│   └── plugin.json
├── commands/
│   └── my-lingo/
│       ├── setup.md
│       ├── status.md
│       ├── last.md
│       └── mode.md
├── hooks/
│   └── hooks.json
├── scripts/
│   ├── user-prompt-submit.mjs
│   ├── session-end.mjs
│   └── lib/
│       ├── detect.mjs
│       ├── config.mjs
│       ├── storage.mjs
│       ├── api.mjs
│       ├── prompts.mjs
│       └── privacy.mjs
├── tests/
│   ├── detect.test.mjs
│   ├── storage.test.mjs
│   ├── privacy.test.mjs
│   └── config.test.mjs
├── package.json
└── .gitignore
```

---

## 四、Phase 0 — 插件骨架

**目标**：Claude Code 能加载插件，hook 能触发，JSONL 能写入。

### 4.1 package.json

```json
{
  "name": "my-lingo-claude",
  "version": "0.1.0",
  "description": "My Lingo Claude Code plugin — prompt optimization and language learning",
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

无 `dependencies` 字段。

### 4.2 .gitignore

```
.env
.env.local
.claude-my-lingo.json
```

### 4.3 .claude-plugin/plugin.json

详见 `dev_docs/08-plugin-structure.md` 第 2 节。关键字段：
- `"name": "my-lingo"`
- `"commands": "./commands"`
- `"hooks": "./hooks/hooks.json"`
- `userConfig` 包含：`api_base_url`、`api_key`（`"sensitive": true`）、`model_fast`、
  `model_deep`、`native_language`（default `"zh-CN"`）、`execution_mode`（default
  `"english_optimized"`）、`timeout_seconds`（default `8`）

### 4.4 hooks/hooks.json

详见 `dev_docs/05-hooks.md` 第 1 节。
- `UserPromptSubmit` matcher `"*"`，timeout `60`，command:  
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit.mjs"`
- `SessionEnd` timeout `15`，command:  
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-end.mjs"`

### 4.5 Phase 0 验收

```bash
npm test   # 即使没有测试文件也应该退出 0（或只提示"no test files found"）
```

---

## 五、Phase 1 — 语言检测与跳过逻辑

**目标**：hook 能正确识别要处理和要跳过的 prompt。

### 5.1 scripts/lib/detect.mjs

导出三个函数，详见 `dev_docs/05-hooks.md` 第 5 节：

```javascript
// 检测语言（ASCII 比率 >= 85% 视为英文）
export function detectLanguage(text)
// 返回 { language: 'english'|'non-english', ratio: number }

// 判断是否应跳过
export function shouldSkip(prompt)
// 跳过条件：
// 1. 以 '/' 开头（slash 命令）
// 2. 以 '!' 开头（shell 命令，注意 !raw 已在上层处理）
// 3. charCount < 8 且 wordCount < 3（过短）
// 4. 以 ``` 开头（纯代码块）
// 5. URL/shell 前缀：https?:, git@, ssh://, npm , pip , cargo , brew ,
//    sudo , cd , ls , cat , grep , docker , kubectl

// 综合检测（外部调用此函数）
export function detectMode(prompt)
// 注意：detectMode 内部不处理 !raw/:: — 调用方已在上层处理
// 返回 { mode: 'skip'|'english'|'non-english', language, ratio, text: prompt }
```

**关键细节**：
- `[...text]` 展开遍历 Unicode 字符（正确处理 CJK）
- ASCII 范围：`charCode >= 0x20 && charCode <= 0x7e`

### 5.2 tests/detect.test.mjs

至少覆盖：
- 中文输入 → `mode: 'non-english'`
- 纯英文 → `mode: 'english'`
- Slash 命令 → `mode: 'skip'`
- 短 prompt（"ok"）→ `mode: 'skip'`
- URL → `mode: 'skip'`
- `npm install` → `mode: 'skip'`
- 中英文混合（如 "把 auth module 重构一下"）→ `mode: 'non-english'`

使用 Node.js 原生 `node:test` + `node:assert/strict`（无 jest/vitest）。

---

## 六、Phase 2 — 外部 API 集成

**目标**：调用外部 API 生成 execution_prompt，注入 Claude。

### 6.1 scripts/lib/api.mjs

详见 `dev_docs/06-api-protocol.md` 第 3 节。导出：

```javascript
export function callFastModel(payload, config)
// payload: { messages: [{role, content}, ...] }
// config: { api_base_url, api_key, model_fast, timeout_seconds }
// 返回解析后的 JSON 对象，或 null（失败/超时）
// 内部 curl: --max-time ${timeout_seconds}, response_format: json_object

export function checkCircuitBreaker()
// 读取 circuit.json，熔断中返回 true，冷却期过自动删文件

export function recordApiFailure()
// 累加 failure_count，返回 true 表示已触发熔断（>= 3 次）

export function recordApiSuccess()
// ⚠️ 关键：成功后删除 circuit.json，重置连续失败计数
// 必须在 callFastModel 返回非 null 后调用

export function getApiKey(config)
// 优先级：MY_LINGO_API_KEY 环境变量 > config.api_key
```

**熔断器文件位置**：`$CLAUDE_PLUGIN_DATA/my-lingo/circuit.json`

**认证错误处理**：API 返回 `authentication_error` 时，存储 pending warning，
下次 emit 时合并进 `systemMessage`（见参考实现 `authWarning` 模式）。

### 6.2 scripts/lib/prompts.mjs

导出两个 System Prompt 构建函数：

```javascript
export function buildOptimizationMessages(prompt, detection, config)
// 构建 messages 数组，用于 callFastModel
// System prompt 见 dev_docs/06-api-protocol.md 第 4.1 节
// 包含 10 条硬约束规则
// 期望模型输出 JSON: { detected_input_language, execution_prompt_en, rewrite_type, key_changes }

export function buildRefineMessages(prompt, config)
// 构建 :: 模式的 refine messages
// System prompt: 将粗糙想法重写为精确的 AI coding assistant prompt
// 期望输出 JSON: { execution_prompt_en }
```

---

## 七、Phase 3 — 配置系统

**目标**：配置加载、`/my-lingo:setup` 命令。

### 7.1 scripts/lib/config.mjs

详见 `dev_docs/05-hooks.md` 第 2.3 节的 `loadConfig` 调用。

```javascript
export function loadConfig(cwd)
// 四层合并（优先级从高到低）：
// 1. 项目级：path.join(cwd, '.claude-my-lingo.json')（可选）
// 2. 语言空间级：spaces.json 中 active space 的 overrides（可选）
// 3. 全局：$CLAUDE_PLUGIN_DATA/my-lingo/config.json（必须存在）
// 4. 默认值（下方 DEFAULT_CONFIG）

const DEFAULT_CONFIG = {
  execution_mode: 'english_optimized',
  native_language: 'zh-CN',
  timeout_seconds: 8,
  fallback_policy: 'send_original',
  privacy_mode: 'standard',
  max_prompt_length: 4000,
  circuit_breaker_cooldown_minutes: 5,
  domain_terms: [],
}

export function writeConfig(config)
// 写入 $CLAUDE_PLUGIN_DATA/my-lingo/config.json，mode: 0o600
// 写入前确保目录存在（mode: 0o700）

export function loadSpaces()
// 读取 $CLAUDE_PLUGIN_DATA/my-lingo/spaces.json
// 不存在时返回默认值：{ active: 'english', spaces: { english: DEFAULT_SPACE } }

export function getActiveSpace(config)
// 从 loadSpaces() 返回值中取出 active space 对象
```

### 7.2 tests/config.test.mjs

使用临时目录（`CLAUDE_PLUGIN_DATA` 环境变量覆盖）测试：
- 不存在 config.json 时返回默认值
- 项目级配置覆盖全局配置
- `writeConfig` 写入正确，文件权限 0o600

### 7.3 commands/my-lingo/setup.md

YAML frontmatter：
```yaml
name: setup
description: First-time setup wizard for My Lingo — configure API, model, and language space.
allowed-tools: Bash, Read
```

Workflow 步骤（使用 `AskUserQuestion` 不可用时改用顺序说明）：
1. 检查 config.json 是否已存在，存在则提示是否覆盖
2. 通过对话获取：`api_base_url`、`api_key`、`model_fast`（可选 `model_deep`）、`native_language`
3. 调用 `node -e` 写入 config.json（mode 0o600）
4. 调用 `node -e` 初始化 spaces.json（默认 English 空间）
5. 发起测试请求验证 API 连通性
6. 输出配置摘要

---

## 八、Phase 4 — 脱敏与安全

**目标**：发给 API 的内容不含敏感信息。

### 8.1 scripts/lib/privacy.mjs

详见 `dev_docs/09-privacy-security.md` 第 2.2 节。

```javascript
export function redact(text, privacyMode = 'standard')
// privacyMode === 'off' 时直接返回原文（本地 API 场景）
// 否则应用 REDACTION_RULES 数组（至少 6 条规则）：
// - API keys: sk-xxx, Bearer xxx, ghp_xxx, gho_xxx
// - 数据库连接串密码
// - password=/secret=/token= 格式
// - PEM 私钥块
// - home 路径用户名（/home/alice/ → /home/[USER]/）
// - 私有 IP（RFC 1918）
// - AWS 访问密钥（AKIA/ASIA 前缀）
```

### 8.2 tests/privacy.test.mjs

覆盖：
- `sk-abc123` 被替换为 `[API_KEY]`
- `postgres://user:pass@host/db` → 密码被替换
- `password=secret123` → 被替换
- `/home/alice/projects` → `/home/[USER]/projects`
- `192.168.1.100` → `[PRIVATE_IP]`
- `privacyMode: 'off'` 时不脱敏
- 技术术语（变量名、包名）不被误脱敏

---

## 九、Phase 5 — 完善主 Hook 与命令

**目标**：完整的 hook 流程 + v0.1 所有命令可用。

### 9.1 scripts/lib/storage.mjs

详见 `dev_docs/07-storage.md` 第 3 节。导出：

```javascript
export function getDataDir()
// path.join(process.env.CLAUDE_PLUGIN_DATA || fallback, 'my-lingo')
// fallback: path.join(os.homedir(), '.claude', 'plugins', 'data')

export function writeTurn(record)
// 追加到 turns/YYYY-MM-DD.jsonl，使用 new Date().toISOString() 作为 ts
// record 字段：ts, session_id, cwd, language_space, execution_mode,
//   detected_language, original_prompt, execution_prompt, rewrite_type,
//   latency_ms, fallback, mode

export function readTurnsForDay(date)   // date: 'YYYY-MM-DD'，返回记录数组
export function readTurnsForRange(startDate, endDate)
export function readTurnsLastNDays(n)
export function listTurnDates()         // 升序列出 turns/ 下所有日期
export function countTotalTurns()       // 全历史总记录数（用于 status）

export function writeCorrection(record, space)  // 写 learning/{space}/corrections-YYYY-MM.jsonl
export function writeLearningItem(record, space) // 写 learning/{space}/items-YYYY-MM.jsonl
```

### 9.2 tests/storage.test.mjs

使用 `withTempData(fn)` 模式（同参考实现 `state.test.mjs`）：
```javascript
function withTempData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-test-'))
  const prev = process.env.CLAUDE_PLUGIN_DATA
  process.env.CLAUDE_PLUGIN_DATA = dir
  try { fn(dir) }
  finally {
    process.env.CLAUDE_PLUGIN_DATA = prev ?? undefined
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
```

覆盖：`writeTurn` 写入、`readTurnsForDay` 读取、不存在时返回空数组、
`listTurnDates` 多日期排序、`countTotalTurns`。

### 9.3 scripts/user-prompt-submit.mjs — 完整流程

严格按以下顺序（违反顺序是已知 bug）：

```
读取 stdin (readStdin)
  ↓
rawPrompt = input.prompt.trim()

① !raw 前缀检测（BEFORE shouldSkip）
  → 记录 mode:'raw' turn，emit systemMessage，return

② :: 前缀检测（BEFORE shouldSkip）
  → 设置 isRefine = true，text = prompt.slice(2).trimStart()

③ shouldSkip(rawPrompt) 检测
  → 返回 true 时直接 return（无任何输出）

④ loadConfig(cwd)
  → execution_mode === 'off' → return
  → execution_mode === 'original' → writeTurn(mode:'original')，return

⑤ isRefine === true → refine 路径
  → callFastModel(buildRefineMessages(...))
  → 失败：emit { decision:'block', reason:'...' }
  → 成功：recordApiSuccess()，writeTurn(mode:'refine')，emit { additionalContext, systemMessage }

⑥ 主优化路径（english_optimized / original_with_english_context / preview）
  → checkCircuitBreaker() → true 时走 fallback
  → redact(prompt, config.privacy_mode)
  → callFastModel(buildOptimizationMessages(...))
  → 失败：recordApiFailure()，writeTurn(fallback:true)，emit fallback systemMessage
  → 成功：recordApiSuccess()，writeTurn(fallback:false)，emit { additionalContext, systemMessage }
```

**additionalContext 构建**（详见 `dev_docs/05-hooks.md` 第 2.4 节）：
- `english_optimized`：`CANONICAL REQUEST: ... Treat the following as their actual request and ignore the language of their original message:\n\n{execution_prompt}`
- `original_with_english_context`：`[My Lingo English Reference]\n... Here is an English version for reference:\n\n{execution_prompt}`

**systemMessage 构建**（compact mode）：
```
[my-lingo] {lang}→en ({latency_ms}ms): {execution_prompt 前 150 字符}
```

### 9.4 scripts/session-end.mjs — 完整实现

```javascript
// ⚠️ 不读取 stdin — SessionEnd 可能不管道 stdin
// 直接从 process.env.CLAUDE_SESSION_ID 和 JSONL 文件获取数据

import process from 'node:process'
import { readTurnsForDay } from './lib/storage.mjs'

function main() {
  const sessionId = process.env.CLAUDE_SESSION_ID || null
  const today = new Date().toISOString().slice(0, 10)
  const all = readTurnsForDay(today)
  const records = sessionId ? all.filter(r => r.session_id === sessionId) : all

  if (records.length === 0) return

  const optimized = records.filter(r => r.execution_prompt && !r.fallback)
  const translated = records.filter(r => r.detected_language !== 'en' && !r.fallback
                                        && r.mode !== 'raw' && r.mode !== 'original')
  const corrected = records.filter(r => r.detected_language === 'en' && !r.fallback
                                       && r.mode !== 'raw' && r.mode !== 'original')
  const fallbacks = records.filter(r => r.fallback)
  const raws = records.filter(r => r.mode === 'raw')

  const parts = [`[my-lingo] Session: ${records.length} prompts`]
  if (optimized.length) {
    const detail = []
    if (translated.length) detail.push(`${translated.length} translated`)
    if (corrected.length) detail.push(`${corrected.length} corrected`)
    parts.push(`${optimized.length} optimized (${detail.join(', ')})`)
  }
  if (raws.length) parts.push(`${raws.length} !raw`)
  if (fallbacks.length) parts.push(`${fallbacks.length} fallbacks`)

  process.stderr.write(parts.join(' | ') + '\n')
}

main()
```

### 9.5 commands/my-lingo/status.md

```yaml
name: status
description: Show current My Lingo status, configuration, and today's stats.
allowed-tools: Bash, Read, Glob
```

Workflow：
1. 用 `node -e` 读取 `config.json` 和 `spaces.json`（不存在时提示运行 setup）
2. 读取今日 turns JSONL 统计：total、optimized、translated、corrected、fallbacks
3. 调用 `countTotalTurns()` 获取全历史总数
4. 格式化输出（参考 `dev_docs/03-commands.md` 第 2 节示例）

### 9.6 commands/my-lingo/last.md

```yaml
name: last
description: Show the most recent prompt optimization — original input and execution prompt.
allowed-tools: Bash, Read, Glob
```

Workflow：
1. 读取今日 JSONL，取最后一条非 skip 记录
2. 今日无数据时读昨日
3. 按 `dev_docs/03-commands.md` 第 2 节格式输出

### 9.7 commands/my-lingo/mode.md

```yaml
name: mode
description: View or switch execution mode (english_optimized / original / off).
argument-hint: "[mode]"
allowed-tools: Bash, Read
```

支持模式及别名：
- `english` / `english_optimized` → `english_optimized`
- `raw` / `original` → `original`
- `mixed` → `original_with_english_context`
- `preview` → `preview`
- `off` → `off`

Workflow：无参数时显示当前模式；有参数时更新 config.json 中 `execution_mode` 字段。

---

## 十、关键实现约束汇总

以下规则来自参考项目对比分析，违反任何一条会导致功能错误：

| # | 规则 | 违反的后果 |
|---|------|-----------|
| 1 | `!raw` 在 `shouldSkip()` 之前处理 | `!raw` 被当 shell 命令完全跳过，escape 功能失效 |
| 2 | `session-end.mjs` 不读 stdin | 可能阻塞，SessionEnd hook 挂起 |
| 3 | `recordApiSuccess()` 在每次成功后调用 | 2失败→成功→1失败 = 误触发熔断 |
| 4 | 文件路径用 `path.join()`，不拼接用户输入 | 路径穿越安全漏洞 |
| 5 | `config.json` 写入时 mode `0o600` | API key 可被其他用户读取 |
| 6 | hook 中不调用 `claude` CLI | 死锁（Claude Code 等 hook，hook 等 Claude） |
| 7 | curl `--max-time 8`，`spawnSync` timeout `10000` | hook 超时行为不确定 |
| 8 | `response_format: { type: 'json_object' }` | 部分模型返回非 JSON，解析失败 |

---

## 十一、测试策略

**测试运行命令**：`npm test`（等价于 `node --test tests/*.test.mjs`）

**测试隔离**：所有涉及文件 I/O 的测试必须用临时目录（`CLAUDE_PLUGIN_DATA` env var 覆盖），
测试结束后清理。

**覆盖范围**：

| 文件 | 覆盖点 |
|------|--------|
| `detect.test.mjs` | 中文/英文/混合/slash/短/URL/npm/`!raw`处理前提 |
| `storage.test.mjs` | 写入/读取/空文件/日期列表/总计数/临时目录隔离 |
| `privacy.test.mjs` | 6 类脱敏规则 + off 模式 + 技术词不误脱敏 |
| `config.test.mjs` | 默认值/覆盖合并/写入权限/缺失文件容错 |

---

## 十二、参考资料索引

| 需要了解 | 查看 |
|---------|------|
| 整体架构与数据流 | `dev_docs/04-architecture.md` |
| Hook 完整实现（含代码） | `dev_docs/05-hooks.md` |
| API 调用与熔断器 | `dev_docs/06-api-protocol.md` |
| 存储格式与函数签名 | `dev_docs/07-storage.md` |
| 插件结构与环境变量 | `dev_docs/08-plugin-structure.md` |
| 脱敏规则完整列表 | `dev_docs/09-privacy-security.md` |
| 命令输出格式示例 | `dev_docs/03-commands.md` |
| 参考实现（对照阅读） | `claude-english-buddy-ref/scripts/` |
