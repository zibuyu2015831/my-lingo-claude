# My Lingo v0.5 — SQLite 存储迁移方案

> **状态**：✅ 已实施完成（第 2 版方案）
> **目标版本**：v0.5
> **前置版本**：v0.4（Stop hook + Claude 回复捕获，已完成）
> **修订说明**：第 1 版（草案）的若干技术假设经代码核对与 `node:sqlite` 实测后被证伪，本版逐条修正，并补全被遗漏的实施面（命令重写、测试重写、Node 版本约束、布尔绑定、目录创建、时间查询正确性、事务幂等）。所有标注 ⚠️ 的条目为草案中的错误或遗漏。
> **实施结果**：Phase 0–3 全部落地，218 单元测试 + 11 集成测试通过；实测确认无 ExperimentalWarning、SessionEnd 重跑为空操作、10 并发写入零报错、`data.db` 含 5 张表。

---

## 〇、本版关键结论（先读这一节）

经 `node:sqlite`（v22.22.2）实测与全量代码核对，确认以下决定性事实，它们贯穿整个方案：

| 事实 | 实测结果 | 对方案的影响 |
|------|---------|------------|
| **布尔值无法绑定** | `stmt.run(true, ...)` 抛 `Provided value cannot be bound to SQLite parameter` | `writeTurn` 现把 `fallback` 存为布尔，必须在写入层转 `1/0`（见 §五.3） |
| **`undefined` 无法绑定** | `stmt.run(undefined, ...)` 同样抛错 | 所有字段映射必须 `?? null`，不能依赖对象缺字段（见 §五.3） |
| **`datetime('now')` 格式不同** | 返回 `2026-06-08 12:00:34`（空格分隔、无 `T`、无 `Z`） | 与存储的 ISO-`Z` 字符串字典序不可比，`readTurnsLastNDays` 草案 SQL 有 bug，改用 JS 计算边界 + `substr`（见 §五.2） |
| **`strftime('%Y-%m', isoZ)` 可用** | `'2026-06-08T10:00:00.000Z'` → `'2026-06'` | 月份分组可用，但本方案统一改用 `substr(ts,1,7)` 以彻底脱离 SQLite 日期解析（见 §五.2） |
| **读回时整数列即整数** | `fallback` 列读回为 `1`（非 `true`） | 读取层必须把 `fallback`/`analyzed` 归一化回布尔，否则破坏现有测试与命令语义（见 §五.4） |
| **`ExperimentalWarning` 输出到 stderr** | 构造 `DatabaseSync` 时打印一次 | 需在 `db.mjs` 顶部用「先 `removeAllListeners` 再加过滤监听」抑制（见 §十） |
| **`lastInsertRowid` 为 number** | `typeof === 'number'` | `INSERT` 后可直接拿数值 id，无需 BigInt 处理 |
| **打开 DB 要求父目录存在** | `DatabaseSync(path)` 父目录不存在会抛错 | `getDb()` 必须先 `ensureDir(getDataDir())`（草案遗漏，见 §四） |

此外，两项被草案严重低估的工作量：

- ⚠️ **测试并非"253 个全部不变通过"**。真实单元测试数为 **218**（`node --test tests/*.test.mjs`），其中 `storage.test.mjs`（38 个）有约一半直接断言 JSONL 文件路径/内容、手工写 JSONL 文件、或断言 `fallback === true`；集成测试 `integration.test.mjs`（PT-001~PT-012）有 5+ 处断言 `*.jsonl` 文件存在/不存在。**这些测试必须重写**，不是"加一行 `closeDb()`"。
- ⚠️ **`purge.md` 与 `review.md` 是命令重写，不是顺带改动**。`purge.md` 现删除 `turns/`、`learning/`、`sessions/` 目录——迁移后这些目录不存在，必须改为操作 DB；`review.md` 若按草案改用 `id` 匹配，则 Step 1 输出与 Step 2 入参都要改。这两项必须进入实施阶段（见 §六.B、§六.C）。

---

## 一、背景与动机

### 当前 JSONL 方案的核心问题

| 问题 | 具体表现 |
|------|---------|
| **无法标记已处理** | SessionEnd 重复处理同一会话的 turns 没有防护；每次都读取"当日全部记录 + 按 session_id 过滤"，崩溃重跑时会重复生成 corrections/learning_items |
| **SRS 更新效率差** | `updateLearningItemReview` 必须读取整个 JSONL 文件、逐行修改、整体重写，大量条目时性能线性下降 |
| **跨日期查询低效** | `readItemsDue` 遍历所有月份的 items 文件，`readTurnsLastNDays` 遍历所有日期文件，随数据增长持续变慢 |
| **无法形成跨会话连续性** | SRS 复习到期队列、学习轨迹统计、错误模式分析，都要在应用层拼接多个文件，代码复杂、结果不完整 |
| **并发写入无保护** | `appendFileSync` 单次追加是原子的，但 `updateLearningItemReview` 的「全文件读-改-写」与并发的 Stop hook 写入之间没有一致性保障，存在丢更新窗口 |

### 为什么选择 `node:sqlite`

- **零 npm 依赖**：`node:sqlite` 是 Node.js 22.5+ 内置模块，本环境为 v22.22.2，可直接使用（⚠️ 但 `package.json` 的 `engines.node` 当前为 `>=18.0.0`，必须收紧，见 §十一·Phase 0）
- **WAL 模式**：允许多进程并发读 + 单写者串行化，匹配 hook 进程模型
- **原地更新**：SRS `next_review` / `review_count` 用 `UPDATE`，替换现有的全文件重写
- **`analyzed` 标志位 + 事务**：`turns.analyzed` 列 + SessionEnd 单事务提交，使重处理天然幂等（见 §六.A）
- **SQL 跨表查询**：复习队列、学习统计、错误模式分析直接用 SQL，消除大量应用层遍历代码

---

## 二、数据库文件位置

**单一文件**（WAL 模式下伴随两个临时文件），位于插件数据目录内：

```
$CLAUDE_PLUGIN_DATA/my-lingo/data.db
$CLAUDE_PLUGIN_DATA/my-lingo/data.db-wal   # WAL 日志（运行时存在）
$CLAUDE_PLUGIN_DATA/my-lingo/data.db-shm   # 共享内存索引（运行时存在）
```

> ⚠️ **WAL 伴随文件**：`data.db-wal` / `data.db-shm` 由 SQLite 自动管理。任何"删除数据库"的逻辑（`purge --all`、测试清理）必须一并删除这三个文件，否则残留 WAL 会与新建的空库冲突。测试用 `fs.rmSync(dir, {recursive:true})` 删整个临时目录，天然覆盖。

**保持不变的 JSON 文件**（这些是配置，不是数据，不迁移）：

```
$CLAUDE_PLUGIN_DATA/my-lingo/
├── config.json       # 全局配置（保持不变）
├── spaces.json       # 语言空间配置（保持不变）
└── circuit.json      # 熔断器状态（保持不变）
```

---

## 三、表结构设计

> 时间戳约定：所有 `ts` / `next_review` 列存储 **JS `new Date().toISOString()` 产出的 ISO 8601 UTC 字符串**（形如 `2026-06-08T10:00:00.000Z`）。该格式定长、字典序 == 时间序，所有日期范围查询用 `substr(ts,1,10)`（日）/ `substr(ts,1,7)`（月）切片比较，**不依赖 SQLite 的 `date()`/`datetime()` 解析**（见 §〇 实测：`datetime('now')` 格式不兼容）。

### 3.1 turns 表

替代：`turns/YYYY-MM-DD.jsonl`

```sql
CREATE TABLE IF NOT EXISTS turns (
  id               INTEGER PRIMARY KEY,
  ts               TEXT    NOT NULL,
  session_id       TEXT,
  cwd              TEXT,
  language_space   TEXT    DEFAULT 'english',
  mode             TEXT,
  detected_language TEXT,
  original_prompt  TEXT,
  execution_prompt TEXT,
  rewrite_type     TEXT,
  latency_ms       INTEGER,
  fallback         INTEGER DEFAULT 0,   -- 0/1，写入层从布尔转换
  fallback_reason  TEXT,
  analyzed         INTEGER DEFAULT 0    -- 0=未被 SessionEnd 处理, 1=已处理
);
CREATE INDEX IF NOT EXISTS idx_turns_session  ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_ts       ON turns(ts);
CREATE INDEX IF NOT EXISTS idx_turns_analyzed ON turns(session_id, analyzed);  -- readUnanalyzedTurns 主路径
```

**新增字段 `analyzed`**：SessionEnd 在单个事务内分析并将本次读取到的 turns 标记为 `analyzed=1`，崩溃重跑时跳过已处理记录（见 §六.A）。

### 3.2 responses 表

替代：`responses/YYYY-MM-DD.jsonl`

```sql
CREATE TABLE IF NOT EXISTS responses (
  id         INTEGER PRIMARY KEY,
  ts         TEXT    NOT NULL,
  session_id TEXT,
  text       TEXT,
  word_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
```

### 3.3 corrections 表

替代：`learning/<space>/corrections-YYYY-MM.jsonl`

```sql
CREATE TABLE IF NOT EXISTS corrections (
  id             INTEGER PRIMARY KEY,
  ts             TEXT NOT NULL,
  session_id     TEXT,
  turn_id        INTEGER,   -- 保留字段，当前始终为 null；未来关联 turns.id
  language_space TEXT,
  type           TEXT,
  original       TEXT,
  corrected      TEXT,
  explanation    TEXT,
  pattern        TEXT
);
CREATE INDEX IF NOT EXISTS idx_corrections_space   ON corrections(language_space);
CREATE INDEX IF NOT EXISTS idx_corrections_session ON corrections(session_id);
```

> ⚠️ **字段名映射**：`session-end.mjs` 现在写入的 correction 记录带的是 `turn_ref: null` 字段（不是 `turn_id`）。JSONL 直接 `JSON.stringify` 整个对象所以无所谓，但 SQL `INSERT` 必须按列名取值。写入层映射时取 `record.turn_id ?? record.turn_ref ?? null`，**或**同步把 `session-end.mjs` 第 62 行的 `turn_ref` 改名为 `turn_id`。本方案选后者（改 `session-end.mjs`），更干净。

### 3.4 learning_items 表

替代：`learning/<space>/items-YYYY-MM.jsonl`（同时承担 SRS 状态）

```sql
CREATE TABLE IF NOT EXISTS learning_items (
  id                 INTEGER PRIMARY KEY,
  ts                 TEXT    NOT NULL,
  session_id         TEXT,
  language_space     TEXT,
  type               TEXT,       -- analysis 产出 'phrase' | 'sentence_pattern'
  target_text        TEXT,
  native_explanation TEXT,
  next_review        TEXT,       -- ISO 8601；null 表示从未复习（立即到期）
  review_count       INTEGER DEFAULT 0,
  interval_days      INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_items_space       ON learning_items(language_space);
CREATE INDEX IF NOT EXISTS idx_items_next_review ON learning_items(next_review);
```

> 注：`type` 由 `analysis.mjs` 的 system prompt 决定，实际产出 `phrase` / `sentence_pattern`（见 `analysis.mjs:27`），与草案注释里写的 `grammar|vocab` 不符。schema 不强约束该列取值，保持 `TEXT` 即可，但文档应如实标注。

**SRS 更新从「文件重写」变为按主键原地更新（见 §五.5 关于 `id` vs `ts` 的决策）：**

```sql
UPDATE learning_items
SET review_count = ?, next_review = ?, interval_days = ?
WHERE id = ?
```

### 3.5 sessions 表

替代：`sessions/YYYY-MM-DD.jsonl`

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY,
  ts             TEXT NOT NULL,
  session_id     TEXT UNIQUE,
  language_space TEXT,
  total_prompts  INTEGER,
  optimized      INTEGER,
  translated     INTEGER,
  corrected      INTEGER,
  fallbacks      INTEGER,
  raws           INTEGER,
  top_errors     TEXT    -- JSON array 字符串：写入 JSON.stringify，读取 JSON.parse
);
```

> `session_id UNIQUE` 配合 `INSERT OR REPLACE`，使同一会话重跑覆盖而非重复（与 §六.A 幂等一致）。`top_errors` 是对象数组，写入层须 `JSON.stringify`，未来读取层须 `JSON.parse`（当前无 `readSession` 消费者，但写入端必须正确序列化，否则 `INSERT` 绑定对象会抛错——见 §〇 布尔/对象不可绑定）。

---

## 四、DB 初始化模块

新文件：`scripts/lib/db.mjs`

```js
// ── 抑制 node:sqlite 的 ExperimentalWarning（必须在 import 之前/同文件顶部）──
// 默认监听器会打印所有 warning；先移除默认监听，再装一个只放行其它 warning 的过滤器。
process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return
  process.stderr.write((w.stack || w.message) + '\n')
})

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './paths.mjs'   // ⚠️ 见下：避免 storage↔db 循环依赖

let _db = null

export function getDb() {
  if (_db) return _db
  const dir = getDataDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })   // ⚠️ DatabaseSync 要求父目录已存在
  const dbPath = path.join(dir, 'data.db')
  _db = new DatabaseSync(dbPath)
  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA busy_timeout=3000')   // 写冲突等待最多 3s 再报 SQLITE_BUSY
  _db.exec('PRAGMA synchronous=NORMAL')  // WAL 下 NORMAL 足够安全且更快
  _db.exec('PRAGMA foreign_keys=ON')
  initSchema(_db)
  try { fs.chmodSync(dbPath, 0o600) } catch {}   // 与 responses 的 0o600 约定一致，best-effort
  return _db
}

export function resetDb() {   // 单元测试隔离用：关闭并清空单例
  if (_db) { try { _db.close() } catch {} _db = null }
}

function initSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS turns ( ... )`)   // 全部 CREATE TABLE / INDEX IF NOT EXISTS
  // ...
}
```

**设计要点：**
- ⚠️ **目录创建**：`new DatabaseSync(dbPath)` 在父目录不存在时直接抛错（已实测）。`getDb()` 必须先 `mkdirSync(dir, {recursive:true})`。草案完全遗漏此点，首次运行必崩。
- ⚠️ **循环依赖**：草案让 `db.mjs` 从 `storage.mjs` import `getDataDir`，而 `storage.mjs` 又从 `db.mjs` import `getDb`，构成 ESM 循环。虽然因「都在函数体内调用、靠 live binding」侥幸能跑，但脆弱。**抽出 `scripts/lib/paths.mjs`**，只放 `getDataDir()`，`db.mjs` 与 `storage.mjs` 都从它 import；`storage.mjs` 仍 `export { getDataDir } from './paths.mjs'` 以维持现有测试的 `import { getDataDir } from '../scripts/lib/storage.mjs'`。
- **模块级单例**：每个 Node.js 进程（每次 hook 调用、每条命令的 `node -e`）只持有一个连接，进程退出自动关闭。
- **`IF NOT EXISTS`**：首次运行自动建表，无需手动迁移；多进程同时首次运行也安全（SQLite 串行化建表）。
- **抑制实验性警告**：`removeAllListeners('warning')` + 过滤监听，覆盖所有入口（hook 脚本、命令内联 `node -e`），因为它们都 import `db.mjs`。详见 §十。

---

## 五、storage.mjs 接口变更

### 5.1 保持不变的导出函数（签名完全兼容）

以下函数对外签名不变，内部实现替换为 SQL。**所有日期范围用 `substr` 切片，不用 `datetime()`/`LIKE`**（见 §〇 实测）：

| 函数 | SQL 等价操作 |
|------|------------|
| `writeTurn(input, config)` | `INSERT INTO turns (...) VALUES (...)`（经布尔/undefined 归一化映射，见 §5.3） |
| `readTurnsForDay(date)` | `SELECT * FROM turns WHERE substr(ts,1,10)=? ORDER BY id` |
| `readTurnsForRange(start, end)` | `SELECT * FROM turns WHERE substr(ts,1,10) BETWEEN ? AND ? ORDER BY id` |
| `readTurnsLastNDays(n)` | JS 算 `cutoff = toISO(now-(n-1)d).slice(0,10)`；`SELECT * FROM turns WHERE substr(ts,1,10) >= ? ORDER BY id` |
| `listTurnDates()` | `SELECT DISTINCT substr(ts,1,10) AS d FROM turns ORDER BY d` |
| `countTotalTurns()` | `SELECT COUNT(*) AS n FROM turns` |
| `writeCorrection(record, space)` | `INSERT INTO corrections (...)`（`turn_id ?? turn_ref ?? null`） |
| `writeLearningItem(record, space)` | `INSERT INTO learning_items (...)`（默认 `review_count=0, interval_days=1, next_review=null`） |
| `writeSession(record)` | `INSERT OR REPLACE INTO sessions (...)`（`top_errors` 须 `JSON.stringify`） |
| `readCorrections(space, monthKeys)` | `SELECT * FROM corrections WHERE language_space=? AND substr(ts,1,7) IN (?,?,...)` |
| `readLearningItems(space, monthKeys)` | `SELECT * FROM learning_items WHERE language_space=? AND substr(ts,1,7) IN (?,?,...)` |
| `listCorrectionMonths(space)` | `SELECT DISTINCT substr(ts,1,7) AS m FROM corrections WHERE language_space=? ORDER BY m` |
| `listItemMonths(space)` | `SELECT DISTINCT substr(ts,1,7) AS m FROM learning_items WHERE language_space=? ORDER BY m` |
| `updateLearningItemReview(...)` | `UPDATE learning_items SET review_count=?, next_review=?, interval_days=? WHERE id=?`（**签名变更**，见 §5.5） |
| `readItemsDue(space)` | `SELECT * FROM learning_items WHERE language_space=? AND (next_review IS NULL OR next_review<=?) ORDER BY (next_review IS NOT NULL), next_review ASC`（`?` = `now.toISOString()`；NULL 优先，对齐 `getItemsDue`） |
| `writeResponseRecord(record)` | `INSERT INTO responses (...)` |
| `readResponsesForSession(sessionId, date)` | `SELECT * FROM responses WHERE session_id=? ORDER BY id`（**忽略 `date`**，跨日期更正确，见 §5.6） |
| `readRecentTurns(n)` | `SELECT * FROM turns ORDER BY id DESC LIMIT ?` |

> **`IN (...)` 参数化**：`monthKeys` 长度可变，须动态生成占位符 `monthKeys.map(()=>'?').join(',')` 并展开绑定；空数组时短路返回 `[]`（保持现有 `readCorrections` 空 monthKeys 行为，对应已有测试）。

### 5.2 时间查询正确性（草案 bug 修正）⚠️

草案写 `readTurnsLastNDays(n)` → `WHERE ts >= datetime('now', '-N days')`。**这是错的**：

- `datetime('now','-N days')` 产出 `2026-06-01 12:00:34`（空格、无 `T`/`Z`），而 `ts` 存的是 `2026-06-01T12:00:34.000Z`。两者字典序在日界处不可比（`' '`=0x20 < `'T'`=0x54）。
- 语义也不同：`datetime('now','-N days')` 是滚动 24h×N 窗口，现行 JS 实现是「最近 N 个自然日（含今日，UTC）」。

**正确实现**：边界在 JS 里算成日期串，SQL 用 `substr` 比较：

```js
export function readTurnsLastNDays(n) {
  const cutoff = new Date(Date.now() - (n - 1) * 86400000).toISOString().slice(0, 10)
  return getDb().prepare(
    'SELECT * FROM turns WHERE substr(ts,1,10) >= ? ORDER BY id'
  ).all(cutoff).map(normalizeTurn)
}
```

同理 `readItemsDue` 的到期阈值传 `new Date().toISOString()`，靠 ISO 串字典序==时间序成立（同格式比较安全）。

### 5.3 写入层：布尔/undefined/对象归一化（草案致命遗漏）⚠️

实测：`node:sqlite` 绑定 `true`/`false`/`undefined`/对象一律抛 `Provided value cannot be bound`。现有 `writeTurn` 把 `fallback` 存为 `Boolean(...)`，`writeSession` 的 `top_errors` 是数组——**直接 `INSERT` 必崩**。所有写入函数须经统一映射：

```js
const b = (v) => (v ? 1 : 0)              // 布尔 → 0/1
const n = (v) => (v === undefined ? null : v)  // undefined → null（字符串/数字/null 原样）

// writeTurn 内：
getDb().prepare(`INSERT INTO turns
  (ts, session_id, cwd, language_space, mode, detected_language,
   original_prompt, execution_prompt, rewrite_type, latency_ms,
   fallback, fallback_reason, analyzed)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
  new Date().toISOString(),
  n(input.sessionId), n(config.cwd ?? input.cwd ?? process.cwd()),
  config.language_space ?? 'english', n(input.mode),
  input.detectedLanguage ?? (input.detection?.lang ?? 'en'),
  n(input.prompt), n(input.executionPrompt), n(input.rewriteType),
  n(input.latencyMs), b(input.fallback), n(input.fallbackReason),
)
// writeSession 内：top_errors → JSON.stringify(record.top_errors ?? [])
```

写入失败仍须吞掉（现有契约 D3「写失败不外泄」）：用 `try/catch` 包住，与现状一致。

### 5.4 读取层：整数标志归一化回布尔 ⚠️

实测：`fallback` 列读回为整数 `1`/`0`。但现有测试断言 `record.fallback === true`（`storage.test.mjs:119`），且 `session-end.mjs` 用 `!r.fallback` / `r.fallback` 做真值判断（整数 truthy 也能用，但语义上应保持）。读取层须把 turns 行的 `fallback`、`analyzed` 转回布尔：

```js
function normalizeTurn(row) {
  if (!row) return row
  return { ...row, fallback: row.fallback === 1, analyzed: row.analyzed === 1 }
}
```

所有返回 turns 行的读函数（`readTurnsForDay/Range/LastNDays/readRecentTurns/readUnanalyzedTurns`）统一 `.map(normalizeTurn)`。

### 5.5 `updateLearningItemReview` 改为按 `id` 匹配（签名变更，连带改 `review.md` 与测试）⚠️

草案旧签名 `updateLearningItemReview(space, monthKey, itemTs, reviewCount)` 按 `ts` 匹配。`ts` 在同一毫秒内可能重复（两条 item 同时写入），不可靠。**改为按主键**：

```js
// 新签名：
export function updateLearningItemReview(id, reviewCount) {
  const interval = computeIntervalDays(reviewCount)               // 见下，srs.mjs 新增
  const nextReview = computeNextReview(reviewCount).toISOString()
  getDb().prepare(
    'UPDATE learning_items SET review_count=?, next_review=?, interval_days=? WHERE id=?'
  ).run(reviewCount, nextReview, interval, id)
}
```

连带改动（**必须同批完成**，否则复习功能断裂）：
- `srs.mjs` 新增 `export function computeIntervalDays(reviewCount)` 返回 `INTERVALS[min(reviewCount, len-1)]`（`UPDATE` 需要 `interval_days` 值）。
- `commands/my-lingo/review.md` **Step 1**：输出对象里把 `ts`/`month` 换成 `id`（`readItemsDue` 返回的行现在带 `id`）。
- `commands/my-lingo/review.md` **Step 2**：内联脚本改为 `updateLearningItemReview(ITEM_ID, NEW_REVIEW_COUNT)`，删掉 `SPACE`/`MONTH_KEY`/`ITEM_TS` 占位符。
- `tests/storage.test.mjs` 的 3 个 `updateLearningItemReview` 用例：改为先写 item、用 `readItemsDue`/`readLearningItems` 拿回 `id`、再按 `id` 更新、断言。

### 5.6 `readResponsesForSession` 去掉日期约束（更正确）

现实现只读「当日」responses，跨午夜会漏。迁移后改为 `WHERE session_id=? ORDER BY id`，**保留 `date` 形参以兼容调用方但忽略它**。`session-end.mjs:54` 的 `readResponsesForSession(sessionId, today)` 无需改动即获得跨日期正确性。现有测试 `readResponsesForSession: nonexistent date → empty` 仍通过（该用例 session 本身无数据）。

### 5.7 新增导出函数

```js
// SessionEnd 幂等处理核心
export function readUnanalyzedTurns(sessionId)
//   sessionId 非空：SELECT * FROM turns WHERE session_id=? AND analyzed=0 ORDER BY id
//   sessionId 为 null：SELECT * FROM turns WHERE analyzed=0 ORDER BY id（兜底，对齐旧版 sessionId 缺失时处理全部）
//   返回 .map(normalizeTurn)

export function markTurnsAnalyzed(ids)
//   UPDATE turns SET analyzed=1 WHERE id IN (...)  ← 按本次实际读取到的 id 集合，而非 session_id 盲标
//   见 §六.A：避免标记到「读取后才写入」的并发 turn
```

> ⚠️ **草案的 `markTurnsAnalyzed(sessionId)` 有两个坑**：(1) `sessionId` 为 `null` 时 `WHERE session_id=NULL` 永不命中（SQL 中 `=NULL` 恒假），会把所有未分析 turn 漏标；(2) 若在「读取 turns」与「标记」之间用户又提交了一条同 session 的 prompt，盲按 session_id 标记会把它误标为已分析、永不被处理。改为**按本次读取到的 `id` 列表标记**，两个坑同时消除。

### 5.8 关于 `closeDb`/`resetDb`

草案的 `closeDb()` 实为 `resetDb()`：单元测试 `storage.test.mjs` 在同一进程内逐个 `withTempData` 切换 `CLAUDE_PLUGIN_DATA`，但 `_db` 单例仍指向**第一个**（已被 `rmSync` 删除的）临时库。必须在每个用例后 `resetDb()`（关闭并置空单例），下个用例 `getDb()` 才会指向新临时目录。见 §八测试改造。

---

## 六、消费方代码变更

### 6.A SessionEnd 幂等化（单事务）

`session-end.mjs` 数据读取与落库逻辑调整。

**现在：**
```js
const all = readTurnsForDay(today)
const records = sessionId ? all.filter(r => r.session_id === sessionId) : all
```

**迁移后**（关键：API 调用在事务外，DB 写入 + 标记在单事务内，保证原子幂等）：
```js
const records = readUnanalyzedTurns(sessionId)
if (records.length === 0) return            // 双次运行：第二次直接空退出
const ids = records.map(r => r.id)
// ... stderr 摘要、过滤 analysisTargets（不变）...

// ① 网络调用在事务之外（耗时、可失败）
const result = callDeepModel(messages, config, { maxTimeSeconds: 12 })

// ② DB 写入 + 标记，单事务原子提交
const db = getDb()
db.exec('BEGIN')
try {
  for (const c of (result?.corrections ?? []))
    writeCorrection({ ...c, session_id: sessionId, turn_id: null }, space)
  for (const item of (result?.learning_points ?? []))
    writeLearningItem({ ...item, language_space: space }, space)
  writeSession({ ...sessionStats })
  markTurnsAnalyzed(ids)                     // 与上面写入同一事务
  db.exec('COMMIT')
} catch { db.exec('ROLLBACK') }
```

> ⚠️ **为什么必须单事务**：草案先写 corrections 再单独 `markTurnsAnalyzed`，若崩溃发生在"写完 corrections、还没标记"之间，重跑会**重复**生成 corrections——恰是本方案要消灭的问题。把写入与标记放进一个事务，要么全成要么全无，幂等才真正成立。`callDeepModel` 是网络调用、可能 12s，必须在事务外，否则长时间持写锁阻塞其它 hook。
>
> **注意**：`writeCorrection`/`writeLearningItem`/`writeSession` 内部不要再各自 `BEGIN`（SQLite 不支持嵌套事务，会抛 `cannot start a transaction within a transaction`）。它们只发 `INSERT`，事务边界由 `session-end.mjs` 统一掌控。若这些函数也被其它路径单独调用（命令里几乎不会写），裸 `INSERT` 自动走隐式事务，无碍。

**效果：**
- 崩溃重跑：只处理上次事务未提交的 turns（已提交的 `analyzed=1` 被跳过）
- 双次运行：第二次 `readUnanalyzedTurns` 返回空，直接退出，零副作用
- 并发新 prompt：只标记本次读取到的 id，新写入的 turn 留待下次

### 6.B `purge.md` 重写（草案遗漏，必须做）⚠️

现 `purge.md` 删除 `turns/`、`learning/<space>/`、`sessions/` **目录**——迁移后这些目录不存在，命令会"Nothing to delete"却让用户以为已清空。必须改为操作 DB：

- **默认（仅活动空间）**：`DELETE FROM corrections WHERE language_space=?` + `DELETE FROM learning_items WHERE language_space=?`
- **`--all`**：清空 `turns`、`responses`、`corrections`、`learning_items`、`sessions` 全表（`DELETE FROM <t>`），或更简单地关闭连接后 `rmSync` 删除 `data.db`、`data.db-wal`、`data.db-shm` 三件套（下次 `getDb()` 自动重建空库）。`--keep-config` 语义（保留/删除 sessions）按现行参数表保持。
- 内联脚本应 `import { getDb, resetDb } from '../../scripts/lib/db.mjs'`（或经 storage 暴露一个 `purgeSpace(space)` / `purgeAll()` helper，**推荐后者**：把 SQL 收敛进 `storage.mjs`，命令只调函数，符合"不向上层暴露 DB 对象"的设计要点）。

> 推荐在 `storage.mjs` 新增 `export function purgeSpace(space)` 与 `export function purgeAll({ keepSessions })`，`purge.md` 仅调用之。既重写了命令，又避免在 markdown 内联里写裸 SQL。

### 6.C `review.md` 重写

见 §5.5：Step 1 输出 `id`，Step 2 按 `id` 调用新签名。无其它逻辑变化。

### 6.D 其它命令（无需改动）

`profile.md`、`export.md`、`vocab.md`、`sentences.md`、`errors.md`、`recent.md`、`status.md`、`last.md` 仅消费 §5.1 中签名不变的读函数（`readCorrections`/`readLearningItems`/`listItemMonths`/`listCorrectionMonths`/`readTurnsLastNDays`/`readRecentTurns`/`readItemsDue` 等），**无需改动**——只要这些函数的返回结构与字段名维持原样（含 `normalizeTurn` 归一化）。这是"签名兼容"策略的最大收益面，必须在验收时逐命令冒烟确认。

---

## 七、并发安全性

| 进程 | 写入表 | 频率 |
|------|--------|------|
| UserPromptSubmit hook | turns | 每次按 Enter |
| Stop hook | responses | 每次 Claude 完成一轮 |
| SessionEnd hook | corrections, learning_items, sessions; `UPDATE turns SET analyzed=1` | 会话结束一次（单事务） |
| 命令内联 `node -e` | 多为只读；`review` 写 learning_items；`purge` 删表 | 用户手动触发 |

**WAL 模式保证：**
- 多个写者串行化；`busy_timeout=3000` 让写冲突等待而非立即报错。
- SessionEnd 的写事务最长持锁时间 = 几条 `INSERT` + 一条 `UPDATE`（毫秒级，因 `callDeepModel` 已移出事务），不会阻塞 UserPromptSubmit 的 `turns` 写入超过 `busy_timeout`。
- 读者（命令、Stop hook 读 transcript 不读 DB）在 WAL 下不被写者阻塞。

**前提**：数据目录须在本地文件系统（WAL 的 `-shm` 共享内存不支持网络文件系统）。`$CLAUDE_PLUGIN_DATA` 默认在 `~/.claude`，满足。

---

## 八、测试隔离与测试重写（草案严重低估）⚠️

### 8.1 隔离机制

每个用例用独立临时目录（与现状一致）：

```js
function withTempData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-stor-test-'))
  const prev = process.env.CLAUDE_PLUGIN_DATA
  process.env.CLAUDE_PLUGIN_DATA = dir
  try { fn(dir) }
  finally {
    resetDb()                                  // ← 新增：关闭单例，否则指向已删目录
    process.env.CLAUDE_PLUGIN_DATA = prev ?? undefined
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA
    fs.rmSync(dir, { recursive: true, force: true })  // 连带删 data.db / -wal / -shm
  }
}
```

集成测试经 `child_process.spawn` 跑 hook 脚本，每个测试一个新进程，单例天然隔离——但**断言内容必须从 DB 读，不能再读 JSONL 文件**（见下）。

### 8.2 必须重写的单元测试（`tests/storage.test.mjs`，38 个中约 16 个）

| 测试 | 现断言 | 改为 |
|------|--------|------|
| `writeTurn: JSONL file is created` | `existsSync(turns/${TODAY}.jsonl)` | `existsSync(data.db)` 且 `readTurnsForDay(TODAY).length===1` |
| `writeTurn: fallback field is boolean` | `record.fallback === true` | 保持断言；靠 §5.4 `normalizeTurn` 满足 |
| `writeTurn: write failure does not throw` | chmod `turns/` 只读 | 改为令 `getDb` 失败（如把 `CLAUDE_PLUGIN_DATA` 指向不可创建路径），断言 `writeTurn` 不抛 |
| `listTurnDates: ascending order` | 手工写 3 个 `*.jsonl` | 改用测试 seam 插入 3 条不同 `ts` 的 turn（见 §8.4），断言去重日期升序 |
| `countTotalTurns: across multiple days` | 手工 append 第二天 `*.jsonl` | 同上，跨日 seed 后断言计数 |
| `writeSession: sessions file is created` | `existsSync(sessions/*.jsonl)` + 文件含 id | 断言 DB 中该 session 行存在（新增 `readSession` 或直接 `getDb().prepare(...).get()`） |
| `updateLearningItemReview: *`（3 个） | 按 `ts` 调用 | 改按 `id`（§5.5） |
| `writeResponseRecord: file created` | `existsSync(responses/*.jsonl)` | `readResponsesForSession(id).length>=1` |
| `writeResponseRecord: write failure` | chmod `responses/` | 同 writeTurn 失败注入改法 |

其余 `storage.test.mjs` 用例（`readCorrections`/`readLearningItems`/`readItemsDue`/`listItemMonths` 等）**断言的是返回值不是文件**，迁移后大概率原样通过，仅需 `withTempData` 加 `resetDb()`。

### 8.3 必须重写的集成测试（`tests/integration/integration.test.mjs`）

以下行断言 JSONL 文件，须改为查 DB（`spawn` 子进程跑完后，在测试进程里 `getDb()` 打开同一 `dataDir/my-lingo/data.db` 查询，或用 `readCorrections`/`readLearningItems`）：

- L282-289（PT-009 类）：`corrections-*.jsonl` / `sessions-*.jsonl` 存在 → 改 `readCorrections('english',[month]).length`、查 `sessions` 表
- L321-322：raw-only 会话 `corrections-*.jsonl` **不存在** → 改 `readCorrections(...).length===0`
- L341、L403（PT-011 类）：`corrections-*.jsonl` / `items-*.jsonl` → 改 `readCorrections` / `readLearningItems`
- L378-379（lesson 文件）：`lesson` 输出可能仍是独立 `.md` 文件（非 DB），需确认 `generate-lesson.mjs` 是否写 DB——若 lesson 不进 DB 则该断言不变。

> ⚠️ 测试进程查 DB 时同样要注意单例：集成测试主进程若也 `import` 了 `storage.mjs`，多个 `dataDir` 间要 `resetDb()`。最稳妥是用独立 `node -e` 子进程查询并打印 JSON，避免主进程单例污染。

### 8.4 测试 seam：插入带任意 `ts` 的 turn

多日/排序类测试需要构造历史日期的 turn，而 `writeTurn` 用 `new Date()`。建议给 `writeTurn` 的 `input` 增加可选 `ts` 覆盖（`record.ts = input.ts ?? new Date().toISOString()`），仅测试使用，生产路径不传。改动极小且无副作用。

### 8.5 真实测试基线

- ⚠️ 草案"253 个测试"无法对应当前代码。实测 `node --test tests/*.test.mjs` 为 **218** 个单元测试；集成 `integration.test.mjs` 为 PT-001~PT-012。验收以**重写后全绿**为准，并在文档记录新的真实数字，不沿用 253。

---

## 九、现有 JSONL 数据迁移

**决策：不迁移，直接切换。**

- 项目未发布，无用户现有数据需保留。
- 旧 JSONL 目录（`turns/`、`responses/`、`learning/`、`sessions/`）切换后不再读写，残留磁盘。
- ⚠️ 但 `purge.md` 重写后（§6.B）将操作 DB 而非删旧目录，因此**旧 JSONL 目录不会被任何命令自动清理**。处置：在 §六.B 的 `purgeAll` 里附带 best-effort `rmSync` 这四个旧目录，或在 `setup`/首次运行打印一次"检测到旧 JSONL 数据，可手动删除 X"提示。本版采用前者（`purgeAll` 顺带清旧目录）。
- 如未来需迁移，单独提供 `scripts/migrate-jsonl.mjs`，本次不在范围内；若迁移则把导入的 turns 全部 `analyzed=1`（避免历史 turn 被 SessionEnd 重分析）。

---

## 十、`node:sqlite` 实验性警告处理

实测构造 `DatabaseSync` 时 stderr 打印：

```
(node:xxxx) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

对 UserPromptSubmit 同步 hook，stderr 可能干扰界面。处理方式（已写入 §四 `db.mjs` 顶部）：

```js
process.removeAllListeners('warning')        // 移除 Node 默认打印监听
process.on('warning', (w) => {               // 仅放行非 SQLite-Experimental 的警告
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return
  process.stderr.write((w.stack || w.message) + '\n')
})
```

> 必须"先 `removeAllListeners` 再加过滤监听"：单加监听不会移除 Node 默认打印器，警告仍会输出。该处理放在 `db.mjs` 顶层、`import 'node:sqlite'` 之前，覆盖所有经 `db.mjs` 的入口（hook + 命令内联）。
>
> 备选：在 hook 调用加 `--disable-warning=ExperimentalWarning`（Node 21.3+）。但命令内的 `node --input-type=module` 内联脚本不易统一加 flag，故仍以 `db.mjs` 内处理为单一可靠收口。

**API 稳定性风险**：`node:sqlite` 在 Node 24 LTS 前可能有 breaking change。缓解：所有 SQLite 调用封装在 `db.mjs` + `storage.mjs`，改动点单一。

---

## 十一、实施阶段

### Phase 0 — 前置约束（草案遗漏）⚠️

1. `package.json`：`engines.node` 由 `>=18.0.0` 改为 `>=22.5.0`（`node:sqlite` 最低版本；本环境 22.22.2 满足）。
2. `dev_docs/INDEX.md`「技术栈」与 `00-decisions.md` D9 中"零 npm 依赖、Node 标准库"措辞补注 Node 版本要求。
3. （可选但推荐）在 `db.mjs` `getDb()` 首次失败（如 `node:sqlite` 不可用）时降级：捕获 `ERR_UNKNOWN_BUILTIN_MODULE`，让 hook 静默退出而非崩溃——保护 Node < 22.5 的用户不至于每次按 Enter 报错。

### Phase 1 — DB 基础层（不改对外接口）

1. 新建 `scripts/lib/paths.mjs`：迁出 `getDataDir()`（解循环依赖）；`storage.mjs` re-export 之。
2. 新建 `scripts/lib/db.mjs`：警告抑制、`getDb()`（含 `mkdirSync` + PRAGMA + `initSchema` + chmod）、`resetDb()`。
3. 重写 `scripts/lib/storage.mjs`：全部函数替换为 SQL；新增 `normalizeTurn`、布尔/undefined 映射、`readUnanalyzedTurns`、`markTurnsAnalyzed`、`purgeSpace`、`purgeAll`；`updateLearningItemReview` 改 `id` 签名；`readResponsesForSession` 去 date 约束。
4. `scripts/lib/srs.mjs`：新增 `computeIntervalDays(reviewCount)`。
5. 改造 `tests/storage.test.mjs`：`withTempData` 加 `resetDb()`；重写 §8.2 列出的 ~16 个文件级断言用例；`writeTurn` 加 `ts` 测试 seam（§8.4）。
6. **验收**：`node --test tests/*.test.mjs` 全绿（数量以重写后为准，记录真实值）。

### Phase 2 — SessionEnd 幂等化 + 命令重写

1. `session-end.mjs`：改用 `readUnanalyzedTurns` + 单事务写入 + `markTurnsAnalyzed(ids)`（§6.A）；`turn_ref` 改名 `turn_id`。
2. `commands/my-lingo/review.md`：Step 1 输出 `id`、Step 2 按 `id` 调用（§6.C）。
3. `commands/my-lingo/purge.md`：改为调用 `purgeSpace`/`purgeAll`（§6.B），并顺带清理旧 JSONL 目录。
4. 重写集成测试 §8.3 中断言 JSONL 文件的行（PT-009、PT-010、PT-011 等）。
5. **验收**：集成测试全绿；手动验证 SessionEnd 重复运行（模拟 crash 重跑）不产生重复 corrections；`/my-lingo:purge` 与 `/my-lingo:review` 端到端可用。

### Phase 3 — 文档更新

1. `dev_docs/00-decisions.md`：D3 改为"SQLite via `node:sqlite`（v0.5），WAL，单文件 `data.db`"，记录"为何脱离 JSONL"及布尔绑定/时间格式等实测约束。
2. `dev_docs/07-storage.md`：反映表结构、`paths.mjs`/`db.mjs` 分层、`normalizeTurn`、幂等事务。
3. `dev_docs/INDEX.md`：标记 v0.4 完成、v0.5 进行/完成；技术栈表"存储方案"改为 SQLite；数据流文件路径节用 `data.db` 替换 JSONL 目录树；补 v0.5 实现计划链接。

---

## 十二、不在本次范围内的事项

- **跨会话错误模式检测**：`SELECT pattern, COUNT(*) FROM corrections GROUP BY pattern ORDER BY 2 DESC`
- **SRS 统计仪表盘**：到期数量、复习次数趋势
- **全文搜索**：`FTS5` 搜索 `original_prompt`、corrections 内容
- **`corrections.turn_id` 真实外键填充**：写入时关联当轮 `turns.id`
- **JSONL → SQLite 迁移脚本**：`scripts/migrate-jsonl.mjs`

---

## 十三、边界问题汇总（修订）

| 问题 | 处置 |
|------|------|
| 布尔/undefined/对象无法绑定（实测抛错） | 写入层 `b()`/`n()` 映射 + `top_errors` `JSON.stringify`（§5.3） |
| 整数列读回非布尔，破坏 `fallback===true` 断言 | 读取层 `normalizeTurn` 转回布尔（§5.4） |
| `datetime('now')` 与 ISO-`Z` 字典序不可比 | 边界在 JS 算成日期串，SQL 用 `substr` 比较（§5.2） |
| `DatabaseSync` 要求父目录存在 | `getDb()` 先 `mkdirSync(recursive)`（§四） |
| `storage.mjs` ↔ `db.mjs` 循环依赖 | 抽 `paths.mjs`，两者都依赖它（§四） |
| SessionEnd 崩溃中途重跑产生重复 corrections | 写入 + `markTurnsAnalyzed` 单事务原子提交（§6.A） |
| `markTurnsAnalyzed(sessionId)` 漏标（null）/误标（并发新 turn） | 改按本次读取的 `id` 列表标记（§5.7） |
| `callDeepModel`（12s 网络）若在事务内会长期持写锁 | 网络调用移到事务外（§6.A） |
| Stop hook 竞态（多进程写 responses） | WAL + `busy_timeout=3000`，`INSERT` 原子，无需应用层锁 |
| 首次运行 DB 文件不存在 | `mkdirSync` + `CREATE TABLE IF NOT EXISTS` 自动建库建表 |
| 单元测试跨 case 共享单例连接（指向已删目录） | `withTempData` finally 调 `resetDb()`（§5.8、§8.1） |
| `node:sqlite` 实验性警告输出 stderr | `db.mjs` 顶部 `removeAllListeners` + 过滤监听（§十） |
| Node < 22.5 无 `node:sqlite` | `engines.node>=22.5.0` + `getDb` 降级静默退出（§十一 Phase 0） |
| `node:sqlite` 未来 breaking change | 全封装在 `db.mjs`/`storage.mjs`，单一改动点 |
| WAL 伴随文件 `-wal`/`-shm` 残留 | `purgeAll` 删三件套；测试 `rmSync` 删整目录（§二） |
| `purge.md` 删旧 JSONL 目录但 DB 不在那里 | 重写为操作 DB + 顺带清旧目录（§6.B、§九） |
| `review.md` 按 `ts` 更新不可靠 | 改 `id` 匹配，连带改 Step 1/2 与测试（§5.5、§6.C） |
| `updateLearningItemReview` 需要 `interval_days` 值 | `srs.computeIntervalDays(reviewCount)`（§5.5） |
| `readResponsesForSession` 跨午夜漏读 | 去 `date` 约束，保留形参忽略其值（§5.6） |
| `readUnanalyzedTurns`/`readTurnsForDay` 顺序 | `ORDER BY id`，保证分析按时间序构造 Turn 1..N |
| `monthKeys` 长度可变的 `IN (...)` | 动态占位符 + 展开绑定；空数组短路返回 `[]` |
| `IN` 子句嵌套事务 | 写入函数只发 `INSERT`，事务边界由 `session-end.mjs` 统一（§6.A） |

---

## 十四、验收标准（修订）

- [ ] `package.json` `engines.node >= 22.5.0`
- [ ] 首次运行（空 `$CLAUDE_PLUGIN_DATA`）：hook 不报错，自动创建目录与 `data.db`，含 5 张表（`turns/responses/corrections/learning_items/sessions`）
- [ ] `node --test tests/*.test.mjs` 全部通过（重写后的真实数量已记录，非 253）
- [ ] `node --test tests/integration/integration.test.mjs` 全部通过（PT-009/PT-010/PT-011 断言已改查 DB）
- [ ] SessionEnd 重复运行（模拟 crash 重跑）不产生重复 corrections（验证幂等事务）
- [ ] SessionEnd 在「读 turns 后、提交前」并发写入一条新 turn，该新 turn 不被误标 `analyzed`
- [ ] Stop hook 并发运行（同 session 两个 Stop 同时写 responses）不报错、不丢记录
- [ ] `writeTurn` 写入含 `fallback:true` 的记录不抛错，读回 `fallback === true`
- [ ] `/my-lingo:review` 端到端可走完一次复习并正确更新 `next_review`（按 `id`）
- [ ] `/my-lingo:purge`（默认 / `--all`）正确清空对应数据，且删除 `data.db`/`-wal`/`-shm`
- [ ] `profile`/`export`/`vocab`/`sentences`/`errors`/`recent`/`status`/`last` 八条只读命令冒烟通过（验证签名兼容策略）
- [ ] hook stderr 中无 `ExperimentalWarning` 输出，其它 Node 警告仍可正常打印
