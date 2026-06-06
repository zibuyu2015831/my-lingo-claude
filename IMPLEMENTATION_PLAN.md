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

6. session-end.mjs runs cleanly with no data present (exit 0, no throw):
   node scripts/session-end.mjs   → exits 0

7. A unit test exercises buildOptimizationMessages() + API-response parsing
   against a mocked JSON string (no network), and it passes under npm test.

HARD CONSTRAINTS — never violate:
- !raw and :: prefixes handled BEFORE shouldSkip() in user-prompt-submit.mjs
- session-end.mjs does NOT read stdin (no readFileSync(0) or stdin.read())
- recordApiSuccess() called after every successful callFastModel() result
  (BOTH the optimize path AND the :: refine path)
- All file paths built with path.join(), never string-concatenated with input
- config.json written with mode 0o600; api_key NEVER passed as a CLI argument
- loadConfig() NEVER throws on missing/corrupt config files — it merges DEFAULT_CONFIG
- emit() drains the pending auth warning (drainWarning) before writing stdout
- storage / circuit I/O is always wrapped so a write failure never blocks emit()
  or changes the exit code
- redact() is applied on BOTH the optimize path AND the :: refine path before
  any text leaves the machine
- The detection object shape and the turn-record schema follow §决策原则 D4
  (one canonical definition, shared by producer and consumer)

Prioritize satisfying the DONE conditions first; defer non-essential polish.
Or stop after 55 turns.
```

---

## 一·补、决策原则（实施中遇到歧义时据此自主裁决）

实施过程中如遇文档冲突、签名歧义或边界未定义，**不要停下来猜**，按以下原则自行裁决并在代码注释中写明依据：

- **D1 冲突裁决顺序**：`IMPLEMENTATION_PLAN.md` > `dev_docs/`（05/06/07/08）> `claude-english-buddy-ref/` > 自行判断。
  两份 dev_docs 互相矛盾时，**以"消费方"实际读取的字段名为权威**（例：turn 记录的字段以 `session-end.mjs` / `status` 命令读取的为准）。
- **D2 失败即放行**：UserPromptSubmit hook 的任何不确定或异常，一律透传原始 prompt、`exit 0`、**绝不抛错**。
  唯一允许输出 `{ decision: 'block' }` 的情形是 `::` 后内容为空。API 不可用、无 key、curl 缺失、JSON 解析失败 → 全部走 fallback，不阻断用户。
- **D3 I/O 永不阻断输出**：`storage.mjs` / 熔断器的所有读写用 try/catch 包裹；写失败时降级（跳过记录）但**不改变 emit 与退出码**。
  顺序上，若 emit 与 writeTurn 并存，emit 的成功不得依赖 writeTurn 成功。
- **D4 单一事实源（检测对象与 turn schema）**：
  - `detectLanguage(text)` 唯一返回 `{ lang, ratio }`，其中 `lang ∈ {'en', 'non-english'}`，`ratio` 为 0–100 整数。
  - turn 记录落盘字段唯一为 snake_case（见 §9.1 schema 表）。`detected_language` 落盘值 = API 返回的 `detected_input_language`（如 `'zh-CN'`），无则回退 `detection.lang`（`'en'` 或 `'non-english'`）。
  - 生产者（hook）与消费者（session-end / status / last）共用同一份定义，禁止各写各的字段名。
- **D5 机密处理**：`api_key` 绝不作为命令行参数传递（会暴露在进程列表 / shell history）；config.json 写入 `0o600`、目录 `0o700`；systemMessage 与日志中不回显 key。
  **api_key 的权威存储位置 = config.json（本计划裁定）**，覆盖 `07-storage.md §4.1` 与 `D7` 中"不存 config.json"的旧表述。
- **D6 测试可决定性**：detect / privacy / config / storage 为纯函数或仅依赖临时目录；测试不触网络，用 `CLAUDE_PLUGIN_DATA` 环境变量覆盖数据目录；**环境变量在函数调用时读取，不在模块顶层 `const` 捕获**（否则破坏测试隔离）。
- **D7 v0.2+ 的预留函数**（`writeCorrection` / `writeLearningItem` / `loadSpaces` / `getActiveSpace`）实现为符合 schema 的可用 stub，但**不接入 v0.1 热路径**。
- **D8 最小输出**：skip → 无 stdout；成功 → `additionalContext` + `systemMessage`；fallback → 仅 `systemMessage`；refine 空 → `decision:'block'`。

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
│   ├── config.test.mjs
│   └── prompts.test.mjs
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
npm test
```

⚠️ 注意：`node --test tests/*.test.mjs` 在 `tests/` 无匹配文件时，shell 会把 glob 原样传入，
node 报"找不到文件"并**非零退出**。因此 Phase 0 结束前就放入至少一个最小测试（建议先写
`detect.test.mjs` 的骨架），使 `npm test` 从 Phase 0 起即可通过。"每阶段后跑 npm test"从 Phase 1 起才真正有意义。

---

## 五、Phase 1 — 语言检测与跳过逻辑

**目标**：hook 能正确识别要处理和要跳过的 prompt。

### 5.1 scripts/lib/detect.mjs

导出三个函数，详见 `dev_docs/05-hooks.md` 第 5 节：

```javascript
// 检测语言（ASCII 比率 >= 85% 视为英文）
export function detectLanguage(text)
// 唯一返回 { lang, ratio }，其中 lang ∈ {'en','non-english'}，ratio 为 0–100 整数。
// ⚠️ 这是全项目唯一的检测对象契约（见 §决策原则 D4）。
//    systemMessage 用 detection.lang === 'en' 判断 refined/translated；
//    落盘 detected_language 优先用 API 的 detected_input_language（如 'zh-CN'），
//    无则回退 detection.lang。不要再引入 detection.language / 'english' 等别名。

// 判断是否应跳过
export function shouldSkip(prompt)
// 跳过条件：
// 1. 以 '/' 开头（slash 命令）
// 2. 以 '!' 开头（shell 命令，注意 !raw 已在上层处理）
// 3. charCount < 8 且 wordCount < 3（过短）
// 4. 以 ``` 开头（纯代码块）
// 5. URL/shell 前缀：https?:, git@, ssh://, npm , pip , cargo , brew ,
//    sudo , cd , ls , cat , grep , docker , kubectl

// 综合检测（仅供测试 / 工具使用；生产 hook 不调用它，
// 生产流程直接用 shouldSkip + detectLanguage，见 §9.3）
export function detectMode(prompt)
// 注意：detectMode 内部不处理 !raw/:: — 调用方已在上层处理
// 返回 { mode: 'skip'|'english'|'non-english', lang, ratio, text: prompt }
// 其中 mode 由 detectLanguage().lang 推导：'en'→'english'，'non-english'→'non-english'
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

export function parseModelResponse(stdout)
// 纯函数：把 curl 的 stdout 文本解析为对象，或 null。
// 流程：JSON.parse(stdout) → 取 choices[0].message.content → JSON.parse(content) → 返回对象；
// 任一步失败或 response.error 存在 → 返回 null（auth error 时设置 pending warning）。
// ⚠️ 抽成独立纯函数是为了可被 prompts.test.mjs / api 测试在无网络下覆盖（DONE 校验项 7、D6）。
// callFastModel 内部调用它处理响应。
```

**熔断器调用方约定**：`callFastModel` 自身**不**调用 record* 函数；由 hook 主流程在拿到结果后调用
`recordApiSuccess()`（成功）或 `recordApiFailure()`（失败），见 §9.3。这样熔断状态的语义集中在一处。

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

**命名约定**：本项目统一用 `buildOptimizationMessages` / `buildRefineMessages`。
`dev_docs/05-hooks.md` 中出现的 `buildPromptForOptimization` / `buildPromptForRefine` 是旧名，
实施时以本节名字为准（见 §决策原则 D1）。

**脱敏前置**：两条路径在把文本交给 `buildXxxMessages` 之前都必须先经过
`redact(text, config.privacy_mode)`——优化路径与 `::` refine 路径**都不例外**（见 §9.3）。

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
// 3. 全局：$CLAUDE_PLUGIN_DATA/my-lingo/config.json（可选）
// 4. 默认值（下方 DEFAULT_CONFIG）
//
// ⚠️ 关键（见 §决策原则 D2/D4）：以上文件任意缺失或 JSON 损坏，
//    一律视为空对象处理，与 DEFAULT_CONFIG 合并后返回，**绝不抛错**。
//    /goal 的 DONE 校验项 3/4 会在未跑 setup（无 config.json）的环境运行 hook，
//    此时 loadConfig 必须返回 execution_mode='english_optimized' 等默认值。

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
3. 写入 config.json（mode 0o600，目录 0o700）
   ⚠️ api_key 不得作为 `node -e "...key..."` 的命令行实参拼入（暴露在进程列表 / history）。
   改为：把含 key 的 JSON 通过 stdin 传给一个读 stdin 的 node 脚本，或写入临时文件再由 node 读取后删除。
4. 初始化 spaces.json（默认 English 空间）
5. 发起测试请求验证 API 连通性（失败时给出可操作提示，不写入坏配置）
6. 输出配置摘要（绝不回显完整 api_key，最多显示后 4 位）

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

export function writeTurn(input, config)
// 追加一行到 turns/YYYY-MM-DD.jsonl。⚠️ 这是生产者→消费者的契约核心（见 §决策原则 D4）。
// 调用方传入富对象 input（camelCase + 嵌套 detection）+ config；
// writeTurn 负责映射成下方唯一的 snake_case 落盘 schema，session-end / status / last 据此读取。

// ── 落盘 schema（snake_case，唯一权威）──────────────────────────────
// {
//   ts:                new Date().toISOString(),
//   session_id:        input.sessionId,
//   cwd:               config.cwd ?? input.cwd ?? process.cwd(),
//   language_space:    config.language_space ?? 'english',   // MVP 单空间，默认 english
//   execution_mode:    input.mode,                            // english_optimized/original/raw/refine/...
//   mode:              input.mode,                            // 与 execution_mode 同值，便于 session-end 过滤
//   detected_language: input.detectedLanguage
//                        ?? (input.detection?.lang ?? 'en'),  // 优先 API 的 detected_input_language
//   original_prompt:   input.prompt,
//   execution_prompt:  input.executionPrompt ?? null,
//   rewrite_type:      input.rewriteType ?? null,
//   latency_ms:        input.latencyMs ?? null,
//   fallback:          Boolean(input.fallback),
//   fallback_reason:   input.fallbackReason ?? null,          // 'api_timeout' / 'api_error' / 'circuit_open'
// }
// ──────────────────────────────────────────────────────────────────
// 整个函数体用 try/catch 包裹，写失败时静默返回（见 §决策原则 D3），不得抛错。

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

> **此流程为权威，覆盖 `dev_docs/05-hooks.md §2.3` 的示例**（后者缺熔断与 drainWarning，照抄会有 bug，见 §决策原则 D1）。

`emit(obj)` 实现：先 `obj = drainWarning(obj)`（合并待播 auth warning），再 `stdout.write(JSON.stringify(obj)+'\n')`。

严格按以下顺序（违反顺序是已知 bug）：

```
读取 stdin (readStdin)
  ↓
rawPrompt = input.prompt.trim()

① !raw 前缀检测（BEFORE shouldSkip）
  → loadConfig；execution_mode==='off' 则 return
  → writeTurn(mode:'raw', fallback:false)（try/catch 包裹）
  → emit systemMessage（含字面量 "!raw"），return
  ⚠️ emit 不得依赖 writeTurn 成功（D3）：先 writeTurn 后 emit，writeTurn 抛错也要 emit 成功。

② :: 前缀检测（BEFORE shouldSkip）
  → isRefine = true，text = rawPrompt.slice(2).trimStart()

③ shouldSkip(rawPrompt) 检测
  → 返回 true 时直接 return（无任何输出）

④ loadConfig(cwd)
  → execution_mode === 'off' → return
  → execution_mode === 'original' → writeTurn(mode:'original')，return
  → 长度护栏：[...text].length > config.max_prompt_length 时，跳过 API 优化，
     writeTurn(fallback:true, fallback_reason:'too_long')，emit 提示后 return（避免超时/高成本）

⑤ isRefine === true → refine 路径
  → text 为空 → emit { decision:'block', reason:'Nothing to refine. Provide text after ::.' }，return
  → redacted = redact(text, config.privacy_mode)          // ⚠️ refine 也要脱敏（D5）
  → result = callFastModel(buildRefineMessages(redacted, config), config)
  → 失败：recordApiFailure()；emit { decision:'block', reason:'[my-lingo] Refinement failed — API unavailable.' }，return
  → 成功：recordApiSuccess()；writeTurn(mode:'refine')；emit { additionalContext, systemMessage }

⑥ 主优化路径（english_optimized / original_with_english_context / preview）
  → checkCircuitBreaker() === true → 直接走 fallback（fallback_reason:'circuit_open'），不调 API
  → redacted = redact(text, config.privacy_mode)
  → result = callFastModel(buildOptimizationMessages(redacted, detection, config), config)
  → 失败：recordApiFailure()（返回 true 时额外 emit 熔断提示）；
          writeTurn(fallback:true, fallback_reason:'api_timeout'|'api_error')；
          fallback_policy==='send_original' 时 emit 提示 systemMessage，否则静默 return
  → 成功：recordApiSuccess()；writeTurn(fallback:false)；emit { additionalContext, systemMessage }
```

注：`preview` 在 MVP 中行为等同 `english_optimized`（仅 mode 别名，不做"确认后再发送"的干跑）。
若未来实现真正的 preview（不注入、仅展示），需单独设计，不在 v0.1 范围。

**additionalContext 构建**（详见 `dev_docs/05-hooks.md` 第 2.4 节）：
- `english_optimized`：`CANONICAL REQUEST: ... Treat the following as their actual request and ignore the language of their original message:\n\n{execution_prompt}`
- `original_with_english_context`：`[My Lingo English Reference]\n... Here is an English version for reference:\n\n{execution_prompt}`

**systemMessage 构建**（compact mode）：
```
[my-lingo] {lang}→en ({latency_ms}ms): {execution_prompt 前 150 字符}
```

### 9.4 scripts/session-end.mjs — 完整实现

**消费方契约（见 §决策原则 D4）**：`translated` / `corrected` 的区分依赖 `detected_language`：
英文输入落盘为 `'en'`，非英文落盘为非 `'en'` 值（API 的 `detected_input_language` 如 `'zh-CN'`，
或回退 `'non-english'`）。因此下面的 `r.detected_language !== 'en'` 才能正确分流——这要求 §9.1 的
writeTurn 严格按 schema 落盘，否则统计全错。

整个 main() 用 try/catch 包裹或确保 `readTurnsForDay` 不抛错：**无数据时 exit 0、不写任何输出**
（/goal DONE 校验项 6）。

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
| 9 | `detectLanguage` 唯一返回 `{lang,ratio}`，`lang∈{'en','non-english'}` | 字段名漂移（language/lang）导致 systemMessage 显示 `undefined→en` |
| 10 | `writeTurn` 按 §9.1 snake_case schema 落盘，`detected_language` 见 D4 | 落盘 camelCase → session-end 全读 undefined，统计全错 |
| 11 | `loadConfig` 缺文件/坏 JSON 不抛错，合并 DEFAULT_CONFIG | 无 config.json 时 hook 崩溃，/goal 校验项 3/4 失败 |
| 12 | `emit()` 先 `drainWarning` 再写 stdout | auth 失败提示永远不显示给用户 |
| 13 | `redact()` 在优化路径与 `::` refine 路径都执行 | refine 内容明文外发，泄密 |
| 14 | storage/circuit I/O 全 try/catch，不阻断 emit/退出码 | 写盘失败连带 hook 非零退出，/goal 校验项 4 失败 |

---

## 十一、测试策略

**测试运行命令**：`npm test`（等价于 `node --test tests/*.test.mjs`）

**测试隔离**：所有涉及文件 I/O 的测试必须用临时目录（`CLAUDE_PLUGIN_DATA` env var 覆盖），
测试结束后清理。

**覆盖范围**：

| 文件 | 覆盖点 |
|------|--------|
| `detect.test.mjs` | 中文/英文/混合/slash/短/URL/npm/`!raw`处理前提；detectLanguage 返回 `{lang,ratio}` 且 lang∈{'en','non-english'} |
| `storage.test.mjs` | writeTurn 落盘字段为 snake_case（断言 `detected_language`/`original_prompt` 等存在）/读取/空文件/日期列表/总计数/临时目录隔离 |
| `privacy.test.mjs` | 6 类脱敏规则 + off 模式 + 技术词不误脱敏 |
| `config.test.mjs` | 默认值/覆盖合并/写入权限 0o600/**缺失或坏 JSON 时不抛错、返回默认值** |
| `prompts.test.mjs` | buildOptimizationMessages 产出合法 messages；解析 mock 的 `choices[0].message.content`（合法 JSON / 垃圾串两种）→ 对象 / null（DONE 校验项 7）|

`detected_language` 的端到端契约（writeTurn 落盘 → session-end 读取分流）建议在
`storage.test.mjs` 里加一条断言：英文 turn 落盘 `detected_language==='en'`，
非英文 turn 落盘非 `'en'` 值，防止 §9.1/§9.4 契约回归。

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
