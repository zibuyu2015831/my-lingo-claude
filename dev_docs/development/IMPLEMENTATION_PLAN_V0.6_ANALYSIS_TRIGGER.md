# My Lingo v0.6 — 分析触发保障机制

> **状态**：待实施
> **目标版本**：v0.6
> **前置版本**：v0.5（SQLite 存储迁移，已完成）
> **问题来源**：生产环境诊断（2026-06-15）：44 条 turns，10 个历史 session，`analyzed=0` 全部为零，`sessions` 表为空。SessionEnd hook 从未成功触发。
> **文档审查**：经三路代码交叉审查（2026-06-15），修正了初稿中的代码缺陷和诊断逻辑错误。
> **二次代码审查**：（2026-06-15）再次三路审查，又修正 4 个 Bug（B1-B4）和 5 处方案描述缺失（D1-D5）。

---

## 〇、结论先行

| 项目 | 结论 |
|------|------|
| **问题根因** | Claude Code daemon 长期运行不退出，SessionEnd 仅在 daemon 进程退出时触发，导致学习分析永远积压 |
| **必要性** | 高。当前架构在 daemon 模式下学习数据完全失效，非偶发问题 |
| **方案选型** | SessionStart hook（主）+ UserPromptSubmit 阈值兜底（副）|
| **改动范围** | `hooks/hooks.json`、新增 `scripts/session-start.mjs`、`scripts/session-end.mjs` 修改（含 import 调整）、`scripts/user-prompt-submit.mjs` 修改、`scripts/lib/config.mjs` 修改 |
| **测试影响** | 新增 session-start 单元测试；集成测试补充跨会话分析场景（PT-014）|

---

## 一、背景与问题诊断

### 1.1 设计预期 vs 实际行为

现有架构依赖 `SessionEnd` 事件做学习分析（`session-end.mjs`）。设计预期：用户结束会话 → SessionEnd 触发 → 分析当次会话的 turns → 写入 corrections/learning_items/sessions。

实际观测到的问题：

```
turns       = 44   ← UserPromptSubmit 正常写入
sessions    = 0    ← SessionEnd 未写入任何记录
corrections = 0    ← 依赖 SessionEnd，同样为零
analyzed    = 0    ← 所有 turns 均未被标记为已分析
```

10 个不同 session_id 跨越同一天多个时间段，均无一被分析。

### 1.2 根本原因

通过 `~/.claude/daemon.status.json` 确认：

```json
{
  "supervisorPid": 79180,
  "supervisorProcStart": "Wed Jun 10 18:21:19 2026"
}
```

Claude Code 以 **daemon 模式**运行。在此模式下：

- 用户打开 / 关闭对话窗口不会终止 daemon 进程
- **SessionEnd 仅在 daemon 进程本身退出时触发**，而非每次对话窗口关闭
- 用户日常使用中 daemon 可能连续运行数天至数周，导致 SessionEnd 永远没有机会触发

这是结构性问题，不是偶发故障。只要 daemon 不重启，学习功能将完全失效。

### 1.3 排除的替代解释

| 假设 | 排除理由 |
|------|---------|
| "插件 hooks 未加载" | UserPromptSubmit 和 Stop hook 均正常工作（circuit.json 有失败记录、turns 有写入），它们与 SessionEnd 声明在同一 `hooks/hooks.json` 文件中；Claude Code 从单文件批量加载，不存在选择性加载 |
| "本次 session 尚未结束" | 10 个不同 session_id 均为 0，且 `analyzed` 也全部为 0，其中多个 session 的时间戳已明显结束 |

**注意：** 不能依靠 `sessions=0` 来排除"脚本被调用但崩溃"。代码审查表明：若 `callDeepModel` 抛出异常，外层 catch（`session-end.mjs:141`）静默吞掉错误，不写 session 记录，不标记 `analyzed`——此路径与"从未调用"在 DB 表现上完全相同。真正可信的证据是 `analyzed=0` + 10 个 session 全部如此，这在"偶发崩溃"假设下概率极低，而在"从未触发"假设下完全自然。

---

## 二、方案设计

### 2.1 核心思路

引入**两层保障**，互为补充：

```
层 A（主）：SessionStart hook
  新会话启动时 → 检测是否有来自其他 session 的历史积压 turns
               → 有则在后台 spawn 分析进程（不阻塞当前会话启动）

层 B（副）：UserPromptSubmit 阈值兜底
  每条 prompt 写入后 → 检查跨所有 session 的未分析 turns 总数
                     → 超过阈值（默认 10）且不在冷却期内 → 后台 spawn 分析进程
```

两层关注点不同：A 关注"换了新会话"这一自然边界，B 关注"积压过多"这一数量信号。两者共用同一个 `analysis.lock` 文件互斥，天然防止重复 spawn。

### 2.2 方案 A：SessionStart Hook（主）

#### 触发条件

Claude Code 在每次新会话启动时触发 `SessionStart` 事件。此时：
- 当前 session_id 是全新的
- 所有历史 session 的 turns 理论上都已经完成（用户已不在那些会话中）
- 是处理历史积压的最佳时机

#### 执行流程

```
SessionStart 触发（新会话启动）
  → scripts/session-start.mjs 启动（< 30ms 内完成并退出）
  → 读取 CLAUDE_SESSION_ID（当前新会话 ID）
  → 查询 DB：SELECT COUNT(*) FROM turns
             WHERE analyzed=0 AND session_id != $current_session
  → 计数 = 0 → 静默退出
  → 计数 > 0 → 检查 analysis.lock 是否存在且新鲜（< 5min）
                → 锁存在 → 静默退出（已有分析在运行）
                → 无锁 → spawn detached session-end.mjs
                         （不传 CLAUDE_SESSION_ID，使其处理全部积压）
                         → 退出（< 30ms）

[后台独立进行，不占用 hook 超时]
session-end.mjs（detached）
  → CLAUDE_SESSION_ID 未设置 → sessionId = null
  → readUnanalyzedTurns(null) 返回所有积压 turns
  → 写 analysis.lock（覆盖，更新 mtime）
  → 分析、COMMIT / ROLLBACK
  → 删除 analysis.lock
```

#### 关键设计点

**`CLAUDE_SESSION_ID` 处理**：spawn 时主动从环境变量中去掉 `CLAUDE_SESSION_ID`，使子进程的 `sessionId` 为 null，从而调用 `readUnanalyzedTurns(null)` 处理所有积压 turns（而非当前新会话）。

```javascript
const { CLAUDE_SESSION_ID: _drop, ...inheritedEnv } = process.env
const child = spawn(process.execPath, [scriptPath], {
  detached: true,
  stdio: 'ignore',
  env: { ...inheritedEnv, MY_LINGO_CATCHUP: '1' },
})
child.unref()
```

**lock 写入时机**：lock 由 **session-end.mjs（分析进程）** 在确认有工作可做后写入，而非由 session-start.mjs 写入。这样即使 spawn 后进程启动失败，也不会留下悬空锁。session-start.mjs 只做 spawn，不写 lock。

**`analysis.lock` 防并发**：
- 路径：`$PLUGIN_DATA/my-lingo/analysis.lock`，内含分析进程 PID
- 鲜活窗口：5 分钟（超时视为进程已死，下次可重入）
- 分析完成（COMMIT 或 ROLLBACK）后在 `finally` 块中删除 lock

#### 代码结构（session-start.mjs）

```javascript
// SessionStart hook — catches up unanalyzed turns from previous sessions.
// Fires at the start of each new Claude Code session.
// Must exit in < 30ms. Never blocks startup.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'          // static top-level import
import { fileURLToPath } from 'node:url'
import { getDataDir, writeInstallPointer } from './lib/paths.mjs'
import { getDb } from './lib/db.mjs'

// Precomputed at module load: session-start.mjs lives at <root>/scripts/,
// so one path.dirname gives us <root>/scripts/ — where session-end.mjs also lives.
const SESSION_END_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'session-end.mjs'
)

function lockPath() {
  return path.join(getDataDir(), 'analysis.lock')
}

function isLockFresh(maxAgeMs = 5 * 60 * 1000) {
  try {
    const stat = fs.statSync(lockPath())
    return Date.now() - stat.mtimeMs < maxAgeMs
  } catch { return false }
}

function main() {
  try {
    writeInstallPointer()

    const currentSessionId = process.env.CLAUDE_SESSION_ID
    if (!currentSessionId) return

    const db = getDb()
    // B1 Fix: 用 OR session_id IS NULL 覆盖 session_id 为 null 的历史 turns；
    // 纯 `!=` 对 NULL 列求值为 NULL（非 TRUE），导致 NULL session 积压永远不触发。
    const { n } = db.prepare(
      'SELECT COUNT(*) AS n FROM turns WHERE analyzed=0 AND (session_id != ? OR session_id IS NULL)'
    ).get(currentSessionId)

    if (n === 0) return
    if (isLockFresh()) return

    // B2 Fix: 用字符串 'node' 而非 process.execPath。
    // 在 Claude Code 中 process.execPath 可能指向 Electron 二进制而非 Node.js，
    // 后者无法执行 .mjs 文件。'node' 依赖 PATH，与 hooks.json 中的调用方式一致。
    // Drop CLAUDE_SESSION_ID so the child calls readUnanalyzedTurns(null)
    // and processes ALL pending sessions, not just the new one.
    const { CLAUDE_SESSION_ID: _drop, ...inheritedEnv } = process.env
    const child = spawn('node', [SESSION_END_SCRIPT], {
      detached: true,
      stdio: 'ignore',
      env: { ...inheritedEnv, MY_LINGO_CATCHUP: '1' },
    })
    child.unref()
  } catch {
    // never throw — always exit 0
  }
}

main()
```

### 2.3 方案 B：UserPromptSubmit 阈值兜底（副）

#### 触发条件

用户在同一个长时间 session 内发了大量 prompt，其他历史 session 积累了足够多的未分析 turns（不含当前 session）。

#### 阈值设计

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `analysis_threshold` | 10 | **其他 session** 的未分析 turns 总数达到此值时触发（排除当前 session，与 Phase 1 一致）|
| `analysis_cooldown_minutes` | 30 | 两次触发之间的最小间隔，防止 API 失败后每条 prompt 都重试 spawn |

**D2 Fix**：阈值统计**排除当前 session**，SQL 与 session-start.mjs 一致：
```sql
SELECT COUNT(*) AS n FROM turns
WHERE analyzed=0 AND (session_id != ? OR session_id IS NULL)
```
若含当前 session，阈值会被进行中的会话自己触发（10 条 prompt 即满足），形成"提前分析半个 session"的语义错误。

阈值 10 的依据：观测到平均约 4.4 turns/session，阈值 10 约等于 2 个 session 的积压量，足够触发而不过于激进。

#### 冷却机制（D1 Fix）

`analysis.lock` 不能用于冷却：lock 在分析完成后被 finally 块删除，完全不保留状态。冷却需要独立的时间戳文件 `analysis-last-trigger.json`：

```
$PLUGIN_DATA/my-lingo/analysis-last-trigger.json
内容: { "ts": "2026-06-15T10:00:00.000Z" }
```

- **读**：`tryTriggerBackgroundAnalysis` 每次被调用时先读此文件，若距上次触发 < `analysis_cooldown_minutes`，直接返回
- **写**：spawn 成功后立即写入当前时间戳（由 user-prompt-submit.mjs 写，与分析进程生命周期无关）
- 文件不存在 → 视为从未触发，可以 spawn

#### 触发路径（D5 Fix）

`tryTriggerBackgroundAnalysis` **只在主优化路径**调用，即 `emit({ additionalContext, systemMessage })` 之前。其他早退路径（`--` 前缀、shouldSkip、circuit_open、api_error 等）不触发，因为这些路径的 turn 要么未写入 DB，要么本身就表明当前 session 处于异常状态。

```javascript
// 仅主优化路径，emit() 之前：
tryTriggerBackgroundAnalysis(config, sessionId)
emit({ additionalContext, systemMessage })
```

#### 执行实现

```javascript
function tryTriggerBackgroundAnalysis(config, currentSessionId) {
  try {
    // 冷却检查
    const cooldownMs = (config.analysis_cooldown_minutes ?? 30) * 60 * 1000
    const dataDir = getDataDir()
    const lastTriggerPath = path.join(dataDir, 'analysis-last-trigger.json')
    try {
      const { ts } = JSON.parse(fs.readFileSync(lastTriggerPath, 'utf8'))
      if (Date.now() - new Date(ts).getTime() < cooldownMs) return
    } catch { /* 文件不存在 = 从未触发，继续 */ }

    // 积压检查（排除当前 session）
    const threshold = config.analysis_threshold ?? 10
    const db = getDb()   // 单例已由 writeTurn 初始化，O(1)
    const { n } = db.prepare(
      'SELECT COUNT(*) AS n FROM turns WHERE analyzed=0 AND (session_id != ? OR session_id IS NULL)'
    ).get(currentSessionId)
    if (n < threshold) return

    // Lock 检查
    const lockFile = path.join(dataDir, 'analysis.lock')
    try {
      const stat = fs.statSync(lockFile)
      if (Date.now() - stat.mtimeMs < 5 * 60 * 1000) return
    } catch { /* lock 不存在，继续 */ }

    // 写冷却时间戳（spawn 前写，防止 spawn 后进程被 kill 导致不写）
    fs.writeFileSync(lastTriggerPath, JSON.stringify({ ts: new Date().toISOString() }))

    const SESSION_END = path.join(path.dirname(fileURLToPath(import.meta.url)), 'session-end.mjs')
    const { CLAUDE_SESSION_ID: _drop, ...inheritedEnv } = process.env
    const child = spawn('node', [SESSION_END], {
      detached: true, stdio: 'ignore',
      env: { ...inheritedEnv, MY_LINGO_CATCHUP: '1' },
    })
    child.unref()
  } catch { /* never throw */ }
}
```

**性能说明**：`getDb()` 在此调用点已是已初始化的单例（`writeTurn` 在前）；COUNT 查询 + 两次 `fs.stat` 总计 < 2ms，不影响 hook 的 60 秒超时预算。

### 2.4 session-end.mjs 适配

需要四处修改：

**① import 补充**：新增 `getDataDir` 导入（B4 Fix：原 import 未声明此函数）：

```javascript
// 修改前：
import { writeInstallPointer } from './lib/paths.mjs'

// 修改后：
import { writeInstallPointer, getDataDir } from './lib/paths.mjs'
// 同时补充 fs 和 path（lock 操作需要）：
import fs from 'node:fs'
import path from 'node:path'
```

**② lock 写入 + 清理（finally 块）**：将外层 try/catch 改为 try/finally，确保 lock 总被清理。lock 由分析进程本身写入（不是 session-start.mjs），写在确认有工作可做后（`records.length > 0`）、网络调用前：

```javascript
function writeLock(dataDir) {
  try { fs.writeFileSync(path.join(dataDir, 'analysis.lock'), String(process.pid)) } catch {}
}
function releaseLock(dataDir) {
  try { fs.unlinkSync(path.join(dataDir, 'analysis.lock')) } catch {}
}

function main() {
  let _dataDir          // 用于 finally 块；未赋值时跳过 releaseLock
  try {
    writeInstallPointer()
    _dataDir = getDataDir()   // 如果找不到数据目录则 throw（被外层捕获）

    const sessionId = process.env.CLAUDE_SESSION_ID || null
    const records = readUnanalyzedTurns(sessionId)
    if (records.length === 0) return   // 无工作，不写 lock

    writeLock(_dataDir)   // ← 有工作才写 lock，spawn 失败时不会留下悬空锁

    // ... stats、stderr 输出、分析逻辑 ...
    // 内层 try/catch（分析异常）保持不变
  } catch {
    // never throw — exit 0 always
  } finally {
    if (_dataDir) releaseLock(_dataDir)   // 无论成功/失败/return 都清理
  }
}
```

**注意**：`finally` 会在所有 `return` 路径上触发，包括内层 try 中的 `return`（如 `shouldAnalyze=false`）。即使 `callDeepModel` 抛出异常被内层 catch 吞掉后继续到 main() 结束，finally 也会执行。

**③ catchup 模式跳过 writeSession**（B3 Fix）：

SQLite 的 UNIQUE 约束对 NULL 不去重——每次 `INSERT OR REPLACE INTO sessions (session_id=NULL)` 都会插入新行而非替换，导致 sessions 表无限增长。

Catchup 模式处理的是多个历史 session 的 turns，没有一个对应的"当前会话"记录，不应写 session 行：

```javascript
// B3 Fix: catchup 模式下 sessionId=null，跳过 writeSession。
// NULL 不触发 UNIQUE REPLACE，每次 catchup 都会追加新行（DB 无限增长）。
// catchup 是批量处理，不代表一个真实 session，无需写 session 记录。
if (sessionId !== null) {
  writeSession({
    session_id: sessionId,
    language_space: space,
    total_prompts: records.length,
    // ...
  })
}
```

**④ `MY_LINGO_CATCHUP` 标记（可选）**：在 stderr 统计输出中追加 `[catchup]` 标识，便于调试：

```javascript
const isCatchup = process.env.MY_LINGO_CATCHUP === '1'
process.stderr.write(parts.join(' | ') + (isCatchup ? ' [catchup]' : '') + '\n')
```

---

## 三、文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `hooks/hooks.json` | 修改 | 新增 `SessionStart` hook 条目（10s 超时，无 matcher）|
| `scripts/session-start.mjs` | 新增 | SessionStart hook 主脚本（约 55 行）|
| `scripts/session-end.mjs` | 修改 | 新增 fs/path import + `getDataDir` import；外层 try 改 try/finally；lock 写入/清理；catchup 模式跳过 writeSession；MY_LINGO_CATCHUP stderr 标识 |
| `scripts/user-prompt-submit.mjs` | 修改 | 新增 `tryTriggerBackgroundAnalysis` 辅助函数（约 35 行），在主优化路径 emit() 前调用 |
| `scripts/lib/config.mjs` | 修改 | 新增 `analysis_threshold`（默认 10）/ `analysis_cooldown_minutes`（默认 30）|

运行时数据文件（Phase 2 新增，无需代码创建，由 `tryTriggerBackgroundAnalysis` 按需写入）：

| 文件 | 路径 | 说明 |
|------|------|------|
| `analysis-last-trigger.json` | `$PLUGIN_DATA/my-lingo/analysis-last-trigger.json` | 记录上次 Phase 2 阈值触发时间，实现冷却期 |

文档更新（本次同步完成）：

| 文件 | 内容 |
|------|------|
| `dev_docs/INDEX.md` | 新增 v0.6 实施阶段条目；更新实现状态；`analysis.lock` 路径 |
| `dev_docs/05-hooks.md` | 更新 hooks.json 示例；更新数据流图 |
| `dev_docs/00-decisions.md` | 新增 D15：分析触发保障机制 |

---

## 四、不改动的内容

- `storage.mjs`：`readUnanalyzedTurns(null)` 已支持跨 session 查询，无需改动
- `db.mjs`：无需改动
- 所有 `/my-lingo:xxx` 命令：无需改动
- 测试文件整体结构：在现有测试套件中追加用例即可

---

## 五、测试计划

### 5.1 session-start.mjs 单元测试（新增）

| 测试用例 | 预期行为 |
|---------|---------|
| 无未分析 turns（其他 session）| 静默退出，不 spawn，不写 lock |
| 有未分析 turns，无 lock | spawn 一次，退出；不写 lock（由子进程写）|
| 有未分析 turns，lock 新鲜（< 5min）| 静默退出，不重复 spawn |
| 有未分析 turns，lock 过期（> 5min）| spawn 一次，退出 |
| CLAUDE_SESSION_ID 为空 | 静默退出 |
| spawn 失败（scriptPath 不存在）| catch 静默处理，exit 0；无 lock 残留 |
| **B1 Fix**：所有积压 turns 的 session_id 均为 NULL | COUNT 查询包含这些行（`OR session_id IS NULL`），正确触发 spawn |
| **B2 验证**：spawn 的可执行文件 | 子进程用 `'node'` 启动，而非 `process.execPath` |

### 5.2 session-end.mjs 适配测试（补充）

| 测试用例 | 预期行为 |
|---------|---------|
| `CLAUDE_SESSION_ID` 未设 + `MY_LINGO_CATCHUP=1` | 处理所有 session 的未分析 turns |
| 分析完成（COMMIT）后 | lock 文件不存在 |
| 分析中途崩溃（模拟）| finally 块仍删除 lock；ROLLBACK 保证幂等 |
| `callDeepModel` 抛出异常 | 外层 catch 捕获；finally 删除 lock；turns 保持 `analyzed=0`（可被下次重试）|
| **B3 Fix**：catchup 模式（sessionId=null）完成分析 | sessions 表**不**新增行（不调用 writeSession）|
| **B3 验证**：连续两次 catchup | sessions 表行数不增长（NULL 不去重问题不再出现）|
| **B4 验证**：`getDataDir` 可在 lock 路径中调用 | lock 文件写入和清理均正常（import 已声明）|

### 5.3 集成测试（补充 PT-014）

**PT-014：跨 session 积压分析（SessionStart 路径）**

场景：
1. 用两个不同 session_id 写入共 8 条 turns，均 `analyzed=0`
2. 构造第三个 session_id（模拟新会话启动）
3. 以第三个 session_id 作为 `CLAUDE_SESSION_ID` 调用 session-start.mjs
4. 等待后台分析完成（轮询 `analyzed` 列，最多 15 秒）
5. 断言：
   - 前两个 session 的 turns 均 `analyzed=1`
   - **sessions 表无 `session_id=NULL` 行**（B3 Fix 验证）
   - lock 不存在
   - analysis-last-trigger.json 不存在（Phase 1 路径不写此文件）

---

## 六、已知局限与接受的边界

| 局限 | 说明 |
|------|------|
| **当前 session 不立即分析** | SessionStart 只处理其他 session 的积压；当前 session 的 turns 等到下次 SessionStart 或阈值触发 |
| **分析进程无实时输出** | detached spawn 的 stdio 设为 `ignore`；结果只能通过 DB 状态或 `[catchup]` stderr（若终端在场）验证 |
| **`callDeepModel` 失败不重试** | 失败时 turns 保持 `analyzed=0`，下次触发时自动重试（幂等）|
| **lock 写入竞态** | session-start.mjs 读锁（isLockFresh）与 session-end.mjs 写锁（writeLock）之间存在极短竞态窗口；最坏情况是两个分析进程同时启动，但 `analyzed` 标志的幂等性保证不会重复写 corrections |
| **SessionEnd 仍保留** | 两套机制并存；若将来 Claude Code 修复 daemon 模式下 SessionEnd 触发行为，SessionStart hook 自动退化为空操作（积压为 0 则直接返回）|
| **catchup 模式无 response 上下文** | `readResponsesForSession(null, today)` 的 SQL `WHERE session_id = ?` 对 NULL 参数返回 0 行（SQL NULL 比较语义）。catchup 分析时无法读取历史 session 的 Claude 回复，分析仅基于 turns（用户输入），learning_points 质量略有下降。按 session_id 分批读 responses 超出本次方案范围，接受此限制。 |
| **跨 session 混合分析的 token 风险** | catchup 模式把多个历史 session 的 turns 混合后一次性发给 `callDeepModel`（当前固定 `maxTimeSeconds: 12`）。若积压了大量 turns（如 44 条），prompt 可能较大，12 秒超时不一定足够。`analyzed=0` 的 turns 在失败时保持未标记，下次可重试，不会丢失数据，但单次 catchup 可能不完整。 |

---

## 七、实施顺序

```
Phase 1（核心，独立可交付）：
  → 新增 scripts/session-start.mjs
  → 更新 hooks/hooks.json（新增 SessionStart 条目）
  → 更新 scripts/session-end.mjs（lock 写入 + finally 清理 + MY_LINGO_CATCHUP stderr）
  → 新增 session-start 单元测试
  → 补充 PT-014 集成测试

Phase 2（阈值兜底，在 Phase 1 验证通过后进行）：
  → 更新 scripts/lib/config.mjs（新增两个配置项）
  → 更新 scripts/user-prompt-submit.mjs（阈值检查调用）
  → 补充阈值触发单元测试
```
