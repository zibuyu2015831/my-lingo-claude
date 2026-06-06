# My Lingo v0.2 — Implementation Plan

> **本文档结构**：
> - **〔启动入口〕** — 给**操作者**使用，将其中的 `/goal` 指令文本复制到 Claude Code 命令行。
> - **〔决策原则〕～〔八〕** — 给**实施中的 Claude** 读取，是完整的规格书与约束体系。

---

## 〔启动入口〕/goal 指令文本（复制粘贴到 Claude Code 的 /goal 命令）

```
Read IMPLEMENTATION_PLAN_V0.2.md in the project root and implement My Lingo v0.2
as specified. Consult dev_docs/ for design context. Work Phase 1 → 3 in sequence.
v0.1 is already complete (npm test passes 110 unit tests; npm run test:integration
passes 7 integration tests). Do NOT break any existing passing tests.

── PHASE DISCIPLINE (repeat for EVERY phase) ──────────────────────────────────
After completing each phase:
  1. Run npm test — fix any failures before proceeding.
  2. Run npm run test:integration — fix any failures before proceeding.
  3. Review code for bugs, naming consistency, and adherence to §决策原则.
  4. For any new test that requires external prerequisites (API key, interactive
     Claude session), add it to PENDING_TESTS.md. Automated tests must be
     implemented inline (unit or integration), not deferred.
  5. Create a git commit per phase with a short descriptive message.
────────────────────────────────────────────────────────────────────────────────

DONE when ALL of the following hold:

1. npm test exits 0 — all unit tests pass (must be ≥ 130, up from 110)

2. npm run test:integration exits 0 — all integration tests pass (must be ≥ 9,
   up from 7, including PT-009 and PT-010)

3. These files exist and are non-empty:
   scripts/lib/analysis.mjs
   commands/my-lingo/space.md
   commands/my-lingo/spaces.md
   commands/my-lingo/use.md
   commands/my-lingo/recent.md
   commands/my-lingo/errors.md
   commands/my-lingo/purge.md
   tests/analysis.test.mjs
   tests/spaces.test.mjs

4. New storage functions accessible:
   node -e "import('./scripts/lib/storage.mjs').then(m => {
     console.log(typeof m.writeSession)
     console.log(typeof m.readCorrections)
     console.log(typeof m.readLearningItems)
     console.log(typeof m.readRecentTurns)
     console.log(typeof m.listCorrectionMonths)
   })"
   → each line prints "function"

5. New config/spaces functions accessible:
   node -e "import('./scripts/lib/config.mjs').then(m => {
     console.log(typeof m.setActiveSpace)
     console.log(typeof m.addSpace)
   })"
   → each line prints "function"

6. analysis.mjs exports accessible:
   node -e "import('./scripts/lib/analysis.mjs').then(m => {
     console.log(typeof m.callDeepModel)
     console.log(typeof m.buildAnalysisMessages)
     console.log(typeof m.parseAnalysisResponse)
   })"
   → each line prints "function"

7. session-end.mjs with mock server writes corrections:
   (Covered by PT-009 integration test — must pass)

8. package.json has no "dependencies" key (zero npm packages — unchanged)

9. git log shows one commit per phase (Phase 1–3) with clear messages.

HARD CONSTRAINTS — never violate:
- Do NOT modify any existing passing unit tests or integration tests
- analysis.mjs uses spawnSync('curl') exactly like api.mjs (no http.request, no fetch)
- parseAnalysisResponse is a pure function (testable without network)
- All new storage functions wrapped in try/catch — never throw to caller
- setActiveSpace / addSpace write to spaces.json atomically (write temp then rename)
- purge.md requires user confirmation ("yes") before deleting any data
- readRecentTurns reads from most-recent day backwards — consistent ordering
- CLAUDE_PLUGIN_DATA read at call-time in every function, never cached at module level
- New integration tests use makeTmpDir() / cleanup() isolation (same as PT-001..008)
```

---

## 一·决策原则（实施中遇到歧义时据此自主裁决）

- **D1 冲突裁决顺序**：`IMPLEMENTATION_PLAN_V0.2.md` > `dev_docs/` > `IMPLEMENTATION_PLAN.md` 中的 v0.1 规格 > 自行判断。
- **D2 analysis.mjs 职责边界**：仅负责 deep model API 调用和响应解析。session-end.mjs 决定"要不要调用"（e.g. 无优化 turns 时跳过），analysis.mjs 只负责"怎么调用"。
- **D3 corrections 写入时机**：session-end 调用 analysis 成功后写入；分析失败（API 无返回、key 无效、无优化 turns）时静默跳过——不影响已有统计输出，不改变 exit code。
- **D4 deep model 超时**：`analysis.mjs` 中 curl `--max-time 30`（deep model 允许更慢），spawnSync timeout 35000。不从 config 读取（避免复杂度）。
- **D5 空间 key 命名规范**：小写英文 + 下划线，如 `english`、`japanese`、`german`。命令参数接受 `English`、`JAPANESE` 等，内部统一 `.toLowerCase()` 标准化。
- **D6 多条写入原子性**：corrections JSONL 和 items JSONL 用 appendFileSync，每次一行，不做批量事务。写失败单条跳过即可。
- **D7 purge 范围**：`/my-lingo:purge` 只操作当前激活空间的数据（turns JSONL 不删，因为 turns 跨空间共享；只删 learning/{space}/ 目录）。加 `--all` 参数才清空所有空间和 turns。这与 dev_docs/03-commands.md 的描述一致。
- **D8 session 写入**：session-end.mjs 写 sessions/YYYY-MM-DD.jsonl（新增行为），字段见 §七 schema。写失败静默，不影响主要统计。

---

## 二、功能范围（v0.2 新增）

| 功能 | 实现方式 | 阶段 |
|------|---------|------|
| 多语言空间管理（CRUD） | config.mjs 扩展 + spaces.json 写入 | Phase 1 |
| `/my-lingo:space` | commands/my-lingo/space.md | Phase 1 |
| `/my-lingo:spaces` | commands/my-lingo/spaces.md | Phase 1 |
| `/my-lingo:use [lang]` | commands/my-lingo/use.md | Phase 1 |
| SessionEnd 学习分析（deep model） | analysis.mjs + session-end.mjs 扩展 | Phase 2 |
| corrections JSONL 写入 | storage.mjs 扩展（writeSession）| Phase 2 |
| `/my-lingo:recent [n]` | commands/my-lingo/recent.md | Phase 3 |
| `/my-lingo:errors` | commands/my-lingo/errors.md | Phase 3 |
| `/my-lingo:purge` | commands/my-lingo/purge.md | Phase 3 |
| 新单元测试（analysis + spaces） | tests/analysis.test.mjs, tests/spaces.test.mjs | 各阶段 |
| 新集成测试（PT-009, PT-010） | tests/integration/integration.test.mjs 扩展 | Phase 2 |

---

## 三、目录结构变化

```diff
 scripts/
   lib/
+    analysis.mjs           # deep model 调用 + 响应解析（新增）
     api.mjs                # 仅新增 callDeepModel 导出
     config.mjs             # 新增 setActiveSpace / addSpace / removeSpace
     storage.mjs            # 新增 writeSession / readCorrections / readLearningItems / readRecentTurns

 commands/my-lingo/
+  space.md                 # 查看当前语言空间详情
+  spaces.md                # 列出所有语言空间
+  use.md                   # 切换语言空间
+  recent.md                # 最近 N 条记录
+  errors.md                # 常见错误报告
+  purge.md                 # 清空数据（需确认）

 tests/
+  analysis.test.mjs        # parseAnalysisResponse / buildAnalysisMessages 纯函数测试
+  spaces.test.mjs          # setActiveSpace / addSpace / loadSpaces 测试
   integration/
     integration.test.mjs   # 新增 PT-009 / PT-010
     helpers.mjs            # 新增 runSessionEndAsync / writeCorrectionsFile
```

---

## 四、Phase 1 — 语言空间管理

### 4.1 config.mjs — 新增函数

在现有 `loadSpaces()` 和 `getActiveSpace()` 基础上，新增：

```javascript
export function setActiveSpace(key)
// 将 spaces.json 的 active 字段改为 key。
// key 不存在于 spaces.spaces 时抛出 Error（调用方在命令中处理）。
// 原子写入：先写 spacesPath + '.tmp'，再 fs.renameSync(tmp, spacesPath)，mode 0o600。
// 示例：
//   const tmp = spacesPath + '.tmp'
//   fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
//   fs.renameSync(tmp, spacesPath)

export function addSpace(key, overrides = {})
// 在 spaces.json 中新增一个语言空间。
// key 已存在时覆盖（merge DEFAULT_SPACE + overrides）。
// 写入后返回新空间对象。

const DEFAULT_SPACE = {
  display_name: '',         // 由调用方填入（通常 = capitalCase(key)）
  target_language: 'en',
  native_language: 'zh-CN',
  level: 'intermediate',
  display_mode: 'compact',
  auto_generate_learning: true,
  created_at: null,         // 调用方或函数内部 = new Date().toISOString()
  updated_at: null,
}

export function removeSpace(key)
// 从 spaces.spaces 删除 key。若 key === active，不自动切换（让调用方处理）。
// key 不存在时静默返回（不抛错）。
```

### 4.2 tests/spaces.test.mjs

使用 `withTempData(fn)` 模式（同 storage.test.mjs）。

| 测试用例 | 断言 |
|---------|------|
| `loadSpaces()` 文件缺失 → 默认 `{ active: 'english', spaces: { english: {...} } }` | `active === 'english'` |
| `loadSpaces()` 读取已有 spaces.json | 字段一致 |
| `getActiveSpace(spaces)` 返回当前激活空间对象 | `activeSpace.key === spaces.active` |
| `setActiveSpace('japanese')` — space 存在 | `loadSpaces().active === 'japanese'` |
| `setActiveSpace('nonexistent')` → 抛出 Error | `assert.throws(...)` |
| `addSpace('japanese', { target_language: 'ja' })` | `loadSpaces().spaces.japanese.target_language === 'ja'` |
| `addSpace` 写入后文件权限 0o600 | `mode & 0o777 === 0o600` |
| `removeSpace('japanese')` → 空间消失 | `!loadSpaces().spaces.japanese` |
| `removeSpace('nonexistent')` → 不抛错 | 静默通过 |

### 4.3 commands/my-lingo/space.md

```yaml
name: space
description: Show current language space configuration and learning stats.
allowed-tools: Bash, Read
```

Workflow（Claude 执行）：
1. 读取 `$CLAUDE_PLUGIN_DATA/my-lingo/spaces.json`，取 active space
2. 统计该空间的 corrections 和 learning items 数量（遍历 learning/{key}/ 目录）
3. 按 dev_docs/03-commands.md 格式输出

### 4.4 commands/my-lingo/spaces.md

```yaml
name: spaces
description: List all configured language spaces with stats.
allowed-tools: Bash, Read, Glob
```

Workflow：列出所有 spaces，每个显示 turns 数量（过滤 language_space 字段）和 corrections 数量。

### 4.5 commands/my-lingo/use.md

```yaml
name: use
description: Switch active language space.
argument-hint: "<space-key>"
allowed-tools: Bash, Read
```

Workflow：
1. 取参数（`$ARGUMENTS`），`.toLowerCase()` 标准化
2. 用 `node -e` 调用 `setActiveSpace(key)` （node 脚本从 stdin 读取 key，不把 key 作为命令行参数拼入）
3. 输出切换结果；空间不存在时提示可用列表和创建方式

---

## 五、Phase 2 — SessionEnd 学习分析

### 5.1 scripts/lib/analysis.mjs

```javascript
// 构建学习分析用的 messages 数组（pure function）
export function buildAnalysisMessages(turns, config)
// turns: Array<{original_prompt, execution_prompt, detected_language}>
// config: { native_language }
// System prompt: 见 dev_docs/06-api-protocol.md §4.2
// User message: 把 turns 格式化为编号列表：
//   "Turn 1 (detected: zh-CN):\nOriginal: ...\nOptimized: ...\n\n..."
// 返回 { messages: [{role:'system',content:...},{role:'user',content:...}] }
// turns 为空时返回 null（调用方检查后跳过 API 调用）

// 调用 deep model（pure transport，同 callFastModel 结构）
export function callDeepModel(payload, config, opts = {})
// payload: { messages }
// config: { api_base_url, model_deep, api_key? }
// opts.jsonMode: boolean（默认 true）
//   true  → 请求体加 response_format: { type: 'json_object' }，返回解析后的 JSON 对象（或 null）
//   false → 不设 response_format，content 作为字符串返回（供 v0.3 课程 Markdown 使用）
// curl --max-time 30，spawnSync timeout 35000
// 模型用 config.model_deep || config.model_fast（fallback）
// ⚠️ 不调用 recordApiFailure/recordApiSuccess（分析失败不影响熔断器）
// ⚠️ 此接口设计需前向兼容 v0.3 lesson 调用（jsonMode: false）

// 解析 deep model 响应（pure function，可被单元测试覆盖）
export function parseAnalysisResponse(stdout)
// 流程：JSON.parse(stdout) → choices[0].message.content → JSON.parse
// 验证：result.corrections 是数组；result.learning_points 是数组（可为空）
// 任何步骤失败 → 返回 null
// 返回 { corrections: [...], learning_points: [...] } 或 null
```

### 5.2 storage.mjs — 新增函数

> **注意**：`writeCorrection(record, space)` 和 `writeLearningItem(record, space)` 已作为 v0.1 stubs 存在于
> `storage.mjs` 末尾（lines 101–121），**无需重新实现**，直接在 session-end.mjs 中调用即可。
> 需要新增的函数如下：

```javascript
// 写会话摘要到 sessions/YYYY-MM-DD.jsonl
export function writeSession(record)
// record: { session_id, language_space, total_prompts, optimized, translated,
//            corrected, fallbacks, raws, top_errors, duration_minutes? }
// ts 由函数内注入（new Date().toISOString()）
// 整体 try/catch，失败静默

// 读取某空间的 corrections（按月列表）
export function readCorrections(space, monthKeys)
// monthKeys: string[]，格式 'YYYY-MM'；空数组时返回 []
// 读取 learning/{space}/corrections-{month}.jsonl，合并返回

// 读取某空间的 learning_items
export function readLearningItems(space, monthKeys)
// 同上，读 items-{month}.jsonl

// 列出某空间可用的 corrections 月份（升序）
export function listCorrectionMonths(space)
// 扫描 learning/{space}/ 目录，提取 corrections-YYYY-MM.jsonl 中的月份
// 不存在目录时返回 []

// 读取最近 N 条 turns（跨日期，最新在前）
export function readRecentTurns(n)
// 从 listTurnDates() 倒序遍历，累积到 n 条为止
// n <= 0 时返回 []
```

### 5.3 session-end.mjs — 扩展

在现有统计输出之后，追加以下逻辑（用 try/catch 包裹，失败不影响 exit code）：

```javascript
// 1. 筛选本次会话中需要分析的 turns
const analysisTargets = records.filter(r =>
  r.execution_prompt &&
  !r.fallback &&
  r.mode !== 'raw' &&
  r.mode !== 'original'
)

// 2. 仅当 auto_generate_learning 为 true 且有可分析 turns 时继续
// 注意：auto_generate_learning 来自空间配置，非全局 config
const shouldAnalyze = activeSpace.auto_generate_learning !== false
if (!shouldAnalyze || !analysisTargets.length) return

// 3. 调用 deep model
const messages = buildAnalysisMessages(analysisTargets, config)
if (!messages) return
const result = callDeepModel(messages, config)
if (!result) return   // API 失败：静默跳过，不影响统计

// 4. 写 corrections
const space = config.language_space ?? 'english'
for (const c of (result.corrections ?? [])) {
  writeCorrection({ ...c, session_id: sessionId, turn_ref: null }, space)
}

// 5. 写 learning_items
for (const item of (result.learning_points ?? [])) {
  writeLearningItem({ ...item, language_space: space }, space)
}

// 6. 写 session 摘要
writeSession({
  session_id: sessionId,
  language_space: space,
  total_prompts: records.length,
  optimized: optimized.length,
  translated: translated.length,
  corrected: corrected.length,
  fallbacks: fallbacks.length,
  raws: raws.length,
  top_errors: result.corrections?.slice(0, 3).map(c => ({
    pattern: c.pattern ?? c.type,
    count: 1,
  })) ?? [],
})
```

**关键约束**：
- ⚠️ **v0.1 的 session-end.mjs 中尚未调用 `loadConfig` / `loadSpaces` / `getActiveSpace`**，v0.2 实现必须在 `main()` 顶部新增以下导入和调用：
  ```javascript
  import { loadConfig, loadSpaces, getActiveSpace } from './lib/config.mjs'
  // 在 main() 内靠前位置（已有 readTurnsForDay 后）：
  const config = loadConfig(process.cwd())
  const spaces = loadSpaces()
  const activeSpace = getActiveSpace(spaces)
  ```
  `config` 和 `activeSpace` 在后续分析逻辑中均需用到。
- deep model 调用不占用熔断器（correction 失败不影响 prompt 优化路径）
- `auto_generate_learning` 是**空间级别**（Space-level）的设置，定义在 `DEFAULT_SPACE`（值为 `true`），**不**在全局 `DEFAULT_CONFIG` 中；判断方式为 `activeSpace.auto_generate_learning !== false`（未配置时视为 true）

### 5.4 tests/analysis.test.mjs

| 测试用例 | 断言 |
|---------|------|
| `buildAnalysisMessages(turns, config)` — 1 条 turn → 返回 `{messages:[...]}` | `messages[0].role==='system'`, `messages[1].role==='user'` |
| `buildAnalysisMessages` — user message 包含 original_prompt | content 含传入文本 |
| `buildAnalysisMessages` — turns 为空 → 返回 null | `result === null` |
| `buildAnalysisMessages` — system prompt 包含 native_language | `messages[0].content` 含 native_language 值 |
| `parseAnalysisResponse` — 合法 stdout（含 choices[0].message.content）→ `{corrections:[...],learning_points:[...]}` | 返回对象，数组类型正确 |
| `parseAnalysisResponse` — 垃圾字符串 → null，不抛错 | `result === null` |
| `parseAnalysisResponse` — `response.error` 存在 → null | |
| `parseAnalysisResponse` — corrections 缺失 → null | `result === null` |
| `parseAnalysisResponse` — corrections 为空数组 → `{ corrections: [], learning_points: [] }` | 不返回 null，corrections.length === 0 |

### 5.5 storage.test.mjs — 新增用例

在现有 `tests/storage.test.mjs` 中追加（使用 `withTempData`）：

| 测试用例 | 断言 |
|---------|------|
| `writeCorrection` + `readCorrections('english', [currentMonth])` | 记录可读取，字段一致 |
| `readCorrections` — 月份不存在 → 空数组，不抛错 | `length === 0` |
| `writeLearningItem` + `readLearningItems('english', [currentMonth])` | 记录可读取 |
| `writeSession` 写入后 sessions/ 目录下文件存在 | 内容包含 session_id |
| `listCorrectionMonths` — 写入 corrections 后 → 返回含当前月的数组 | `months.includes(currentMonth)` |
| `listCorrectionMonths` — 目录不存在 → 空数组，不抛错 | |
| `readRecentTurns(5)` — 写入 8 条 → 返回 5 条 | `length === 5` |
| `readRecentTurns(0)` → 空数组 | |

### 5.6 集成测试扩展（tests/integration/integration.test.mjs）

#### helpers.mjs 新增

```javascript
// 异步版 session-end runner（用于需要 mock server 的测试）
export async function runSessionEndAsync({ dataDir, sessionId, timeout = 5000 })
// 使用 spawn（非 spawnSync），等待进程退出
// 同 runHookAsync 结构
// 返回 { status, stdout, stderr }

// 写 corrections 文件（供 PT-010 前置）
export function writeCorrectionsFile(dataDir, space, month, records)
// 写入 dataDir/my-lingo/learning/{space}/corrections-{month}.jsonl
```

#### PT-009: SessionEnd 分析写入 corrections JSONL（async，需 mock server）

```
scenario: session-end with valid turns + mock deep model
mock: returns { corrections: [{type:'grammar', original:'...', corrected:'...', explanation:'...', pattern:'...'}],
                learning_points: [{type:'phrase', target_text:'...', native_explanation:'...'}] }
setup: pre-write 2 optimized turns (non-fallback, execution_prompt 非 null)
run: runSessionEndAsync
verify:
  - status 0
  - corrections file exists: dataDir/my-lingo/learning/english/corrections-YYYY-MM.jsonl
  - readCorrections('english', [currentMonth]).length >= 1
  - sessions file exists: dataDir/my-lingo/sessions/YYYY-MM-DD.jsonl
```

#### PT-010: SessionEnd 无优化 turns 时跳过分析（sync）

```
scenario: session-end with only raw turns (mode='raw')
mock: NOT needed (should not call API at all)
setup: pre-write 2 raw turns only (mode='raw')
config: api_base_url pointing to port 1 (connection refused — ensures no API call)
run: runSessionEnd (sync)
verify:
  - status 0
  - corrections file does NOT exist (no analysis triggered)
```

---

## 六、Phase 3 — 学习类命令

### 6.1 commands/my-lingo/recent.md

```yaml
name: recent
description: Show the most recent N prompt optimization turns (default 5).
argument-hint: "[n]"
allowed-tools: Bash, Read
```

Workflow（Claude 执行）：
1. 解析 `$ARGUMENTS`，取 n（默认 5，最大 50）
2. 用 `node -e` 调用 `readRecentTurns(n)` 并格式化输出
3. 每条记录显示：时间、模式、detected_language、original_prompt 前 80 字符、execution_prompt 前 80 字符（若有）
4. 无记录时提示"No turns recorded yet"

### 6.2 commands/my-lingo/errors.md

```yaml
name: errors
description: Show common language errors from the last 30 days in current language space.
allowed-tools: Bash, Read, Glob
```

Workflow（Claude 执行）：
1. 获取当前激活 space（`loadSpaces().active`）
2. 计算最近 30 天的月份列表（'YYYY-MM' 格式）
3. 用 `readCorrections(space, months)` 读取所有 corrections
4. 按 `pattern` 分组，统计频率，取 Top 10
5. 按 dev_docs/03-commands.md 示例格式输出（pattern / 频次 / 示例 original→corrected）
6. 无记录时提示"No corrections recorded yet. Corrections are written after each session."

### 6.3 commands/my-lingo/purge.md

```yaml
name: purge
description: Clear learning data for current language space (requires confirmation).
argument-hint: "[--all] [--keep-config]"
allowed-tools: Bash, Read
```

Workflow（Claude 执行）：
1. 解析参数（`--all`、`--keep-config`、`--space <key>`）
2. 显示即将删除的内容：
   - 默认：`learning/{activeSpace}/` 目录
   - `--all`：`learning/`（所有空间）+ `turns/` 目录
   - `--keep-config`：跳过 `config.json` 和 `spaces.json`
3. **要求用户输入 "yes" 确认**（使用 `AskUserQuestion` 或请用户在对话中回复 "yes"）
4. 确认后执行删除（`rm -rf`）
5. 输出删除结果，提示"Data cleared. Config and spaces configuration preserved."

---

## 七、数据格式补充

### sessions JSONL schema

```jsonc
// sessions/YYYY-MM-DD.jsonl 一行
{
  "ts": "2026-06-06T11:45:00.123Z",
  "session_id": "abc123",
  "language_space": "english",
  "total_prompts": 12,
  "optimized": 10,
  "translated": 3,
  "corrected": 7,
  "fallbacks": 0,
  "raws": 2,
  "top_errors": [
    { "pattern": "subject-verb agreement", "count": 1 }
  ]
}
```

### corrections JSONL schema

```jsonc
// learning/english/corrections-2026-06.jsonl 一行
{
  "ts": "2026-06-06T11:45:00.123Z",
  "session_id": "abc123",
  "turn_ref": null,
  "type": "grammar",
  "original": "this code have bug",
  "corrected": "this code has a bug",
  "explanation": "单数名词 code 搭配 has，不用 have；bug 前加 a",
  "pattern": "subject-verb agreement"
}
```

### learning_items JSONL schema

```jsonc
// learning/english/items-2026-06.jsonl 一行
{
  "ts": "2026-06-06T11:45:00.123Z",
  "language_space": "english",
  "type": "phrase",
  "target_text": "identify potential bugs",
  "native_explanation": "找出潜在的问题/bug",
  "review_count": 0,
  "next_review": null
}
```

---

## 八、DONE 验收清单（完整）

```bash
# 单元测试：应 ≥ 130 个通过
npm test

# 集成测试：应 ≥ 9 个通过（含 PT-009 / PT-010）
npm run test:integration

# 文件检查
ls commands/my-lingo/{space,spaces,use,recent,errors,purge}.md
ls scripts/lib/analysis.mjs
ls tests/{analysis,spaces}.test.mjs

# 函数导出检查
node --input-type=module <<'EOF'
import { writeSession, readCorrections, readLearningItems, readRecentTurns, listCorrectionMonths } from './scripts/lib/storage.mjs'
import { setActiveSpace, addSpace } from './scripts/lib/config.mjs'
import { callDeepModel, buildAnalysisMessages, parseAnalysisResponse } from './scripts/lib/analysis.mjs'
console.log('all exports OK')
EOF

# 无 npm 依赖
node -e "const p = JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(!p.dependencies ? 'OK' : 'FAIL')"
```
