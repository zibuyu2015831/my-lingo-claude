# 数据存储设计

版本：v0.2

---

## 1. 存储方案选型

### 1.1 MVP 使用 JSONL 文件

MVP（v0.1）使用按日期分片的 JSONL 文件，不使用 SQLite。

**理由**：
- 无需 schema 迁移、WAL 配置、并发锁管理
- 无需 jobs 表和 worker 进程
- 参考实现（`claude-english-buddy`）验证了 JSONL 在同等场景的可行性
- JSONL 文件天然支持顺序写入（hook 追加），按日期读取（命令分析）

**何时迁移到 SQLite**：
- 历史记录超过 10,000 条（JSONL 读取开始变慢）
- 需要复杂的跨字段查询
- 需要全文搜索

### 1.2 目录结构

```
$CLAUDE_PLUGIN_DATA/my-lingo/
│
├── config.json                    # 全局配置
├── spaces.json                    # 语言空间配置
├── circuit.json                   # 熔断器状态（API 失败计数）
│
├── turns/                         # 按日期分片的 turns 记录
│   ├── 2026-06-01.jsonl
│   ├── 2026-06-02.jsonl
│   └── ...
│
├── learning/                      # 学习材料（按语言空间 + 月份分片）
│   ├── english/
│   │   ├── corrections-2026-06.jsonl
│   │   └── items-2026-06.jsonl
│   └── japanese/
│       ├── corrections-2026-06.jsonl
│       └── items-2026-06.jsonl
│
├── responses/                     # Claude 回复缓存（Stop hook 写入，按日期分片）
│   ├── 2026-06-01.jsonl
│   └── ...
│
└── sessions/                      # 会话摘要（可选，SessionEnd 写入）
    ├── 2026-06-01.jsonl
    └── ...
```

`$CLAUDE_PLUGIN_DATA` 由 Claude Code 提供，通常解析为 `~/.claude/plugins/data/`。

---

## 2. JSONL 记录格式

### 2.1 turns 记录

每次 UserPromptSubmit hook 触发（未被跳过）时写入一条记录。

```jsonc
// turns/2026-06-06.jsonl 中一行
{
  "ts": "2026-06-06T10:23:45.123Z",
  "session_id": "abc123def456",
  "cwd": "/home/user/projects/myapp",
  "language_space": "english",
  "execution_mode": "english_optimized",
  "detected_language": "zh-CN",
  "original_prompt": "检查这个项目有没有架构问题，先不要修改代码。",
  "execution_prompt": "Review this project for potential architectural issues. Do not modify any files yet.",
  "rewrite_type": "translate_and_optimize",
  "latency_ms": 1240,
  "fallback": false
}
```

**跳过的 turns 不写记录**（skipCheck 返回 true 时直接退出，不记录）。

**Fallback turns 的格式**：
```jsonc
{
  "ts": "2026-06-06T10:25:00.000Z",
  "session_id": "abc123",
  "language_space": "english",
  "execution_mode": "english_optimized",
  "detected_language": "zh-CN",
  "original_prompt": "...",
  "execution_prompt": null,
  "fallback": true,
  "fallback_reason": "api_timeout"
}
```

### 2.2 corrections 记录（learning/）

SessionEnd hook 生成，或按需命令触发。

```jsonc
// learning/english/corrections-2026-06.jsonl
{
  "ts": "2026-06-06T10:23:45Z",
  "session_id": "abc123",
  "turn_ref": "2026-06-06T10:23:45.123Z",
  "target_language": "en",
  "type": "grammar",
  "original": "this code have bug",
  "corrected": "this code has a bug",
  "explanation": "单数名词 code 搭配 has；bug 前加 a",
  "pattern": "subject-verb agreement",
  "severity": "medium"
}
```

### 2.3 learning_items 记录

```jsonc
// learning/english/items-2026-06.jsonl
{
  "ts": "2026-06-06T10:23:45Z",
  "language_space": "english",
  "type": "phrase",
  "target_text": "identify potential bugs",
  "native_explanation": "找出潜在问题",
  "example": "Review this code and identify potential bugs.",
  "difficulty": "intermediate",
  "tags": ["debugging", "code-review"],
  "review_count": 0,
  "next_review": null
}
```

### 2.4 session 记录（SessionEnd）

```jsonc
// sessions/2026-06-06.jsonl
{
  "ts": "2026-06-06T11:45:00Z",
  "session_id": "abc123",
  "language_space": "english",
  "total_prompts": 12,
  "optimized": 10,
  "translated": 3,
  "corrected": 7,
  "fallbacks": 0,
  "skipped": 2,
  "duration_minutes": 82,
  "top_errors": [
    { "pattern": "subject-verb agreement", "count": 3 },
    { "pattern": "missing article", "count": 2 }
  ]
}
```

---

## 3. 存储工具函数

```javascript
// scripts/lib/storage.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PLUGIN_DATA_ENV = 'CLAUDE_PLUGIN_DATA'
const FALLBACK_DIR = path.join(os.homedir(), '.claude', 'plugins', 'data')

export function getDataDir() {
  const base = process.env[PLUGIN_DATA_ENV] || FALLBACK_DIR
  return path.join(base, 'my-lingo')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// 按日期分片
function todayPath(subdir, prefix = '') {
  const date = new Date().toISOString().slice(0, 10)
  const dir = ensureDir(path.join(getDataDir(), subdir))
  return path.join(dir, `${prefix}${date}.jsonl`)
}

// 按月份分片（学习材料）
function monthPath(subdir, space, prefix = '') {
  const month = new Date().toISOString().slice(0, 7)
  const dir = ensureDir(path.join(getDataDir(), subdir, space))
  return path.join(dir, `${prefix}${month}.jsonl`)
}

export function writeTurn(record) {
  const line = JSON.stringify({ ...record, ts: record.ts || new Date().toISOString() })
  fs.appendFileSync(todayPath('turns'), line + '\n', 'utf8')
}

export function readTurnsForDay(date) {
  const file = path.join(getDataDir(), 'turns', `${date}.jsonl`)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

export function readTurnsForRange(startDate, endDate) {
  const records = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    records.push(...readTurnsForDay(d.toISOString().slice(0, 10)))
  }
  return records
}

export function readTurnsLastNDays(n) {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - (n - 1))
  return readTurnsForRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
}

export function writeCorrection(record, space) {
  const line = JSON.stringify({ ...record, ts: record.ts || new Date().toISOString() })
  fs.appendFileSync(monthPath('learning', space, 'corrections-'), line + '\n', 'utf8')
}

export function writeLearningItem(record, space) {
  const line = JSON.stringify({ ...record, ts: record.ts || new Date().toISOString() })
  fs.appendFileSync(monthPath('learning', space, 'items-'), line + '\n', 'utf8')
}

// 列出 turns/ 目录下所有已有数据的日期，升序排列
// 用于：/my-lingo:status 显示总记录数、/my-lingo:errors 扫描历史
export function listTurnDates() {
  const dir = path.join(getDataDir(), 'turns')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''))
    .sort()
}

// 统计所有历史 turns 的总记录数（用于 status 命令）
export function countTotalTurns() {
  return listTurnDates().reduce((sum, date) => {
    return sum + readTurnsForDay(date).length
  }, 0)
}
```

---

## 4. 配置文件格式

### 4.1 config.json（全局配置）

config.json 只存储**偏好类**字段，不存储 API 凭证。凭证通过环境变量提供（见下文）。

```json
{
  "timeout_seconds": 8,
  "fallback_policy": "send_original",
  "execution_mode": "english_optimized",
  "native_language": "zh-CN",
  "privacy_mode": "standard",
  "max_prompt_length": 4000,
  "circuit_breaker_cooldown_minutes": 5
}
```

### 4.2 API 凭证：环境变量

API 凭证必须通过环境变量配置，不得写入任何文件：

| 环境变量 | 用途 | 是否必填 |
|---------|------|---------|
| `MY_LINGO_API_KEY` | API 认证密钥 | 必填 |
| `MY_LINGO_API_BASE_URL` | API 端点，如 `https://api.openai.com/v1` | 必填 |
| `MY_LINGO_MODEL_FAST` | 同步优化使用的快速模型 | 必填 |
| `MY_LINGO_MODEL_DEEP` | 异步分析使用的深度模型 | 选填（默认等于 model_fast） |

环境变量在 `loadConfig()` 中作为最高优先级（Layer 0）覆盖所有文件配置。`writeConfig()` 会在写入前自动过滤凭证字段，防止意外落地。

**各平台配置方式：**
- macOS / Linux：将 `export MY_LINGO_API_KEY=...` 写入 `~/.zshrc` 或 `~/.bashrc`
- Windows：系统属性 → 高级 → 环境变量

### 4.3 spaces.json（语言空间）

```json
{
  "active": "english",
  "spaces": {
    "english": {
      "key": "english",
      "display_name": "English",
      "target_language": "en",
      "native_language": "zh-CN",
      "level": "intermediate",
      "display_mode": "compact",
      "auto_generate_learning": true,
      "created_at": "2026-06-01T00:00:00Z",
      "updated_at": "2026-06-06T00:00:00Z"
    }
  }
}
```

### 4.4 circuit.json（熔断器状态）

```json
{
  "failure_count": 2,
  "last_failure_at": 1749200000000,
  "last_error_type": "timeout"
}
```

---

## 5. 数据规模预估

| 数据类型 | 每条大小 | 每天条数 | 每月大小 |
|---------|---------|---------|---------|
| turns | ~300B | ~50 条 | ~450KB |
| corrections | ~200B | ~5 条 | ~30KB |
| learning items | ~250B | ~10 条 | ~75KB |
| sessions | ~400B | ~2 条 | ~24KB |

**一年后总大小**：约 7MB，JSONL 文件读取速度完全够用。

### 2.5 response 记录（responses/，Stop hook 写入）

每次 Claude 完成一轮回复后，Stop hook 从 transcript 文件提取文本并写入。

```jsonc
// responses/2026-06-08.jsonl 中一行
{
  "ts": "2026-06-08T10:30:00.000Z",
  "session_id": "abc123def456",
  "text": "I'll review this code. Here are the main issues I found...",
  "word_count": 87
}
```

**注意事项：**
- 仅存储纯文本内容（`type === "text"` 的 content block），不含 `thinking` 或 `tool_use`
- 竞态或文件未准备好时不写记录（不重试），SessionEnd 降级为现有分析
- 同一 session 的多轮回复按时间顺序追加，`session_id` 用于 SessionEnd 关联

---

## 6. Claude Code Transcript 文件格式（只读参考）

### 6.1 路径规则

Claude Code 将完整对话记录写入：

```
~/.claude/projects/<path-hash>/<session-id>.jsonl
```

**path-hash 推导（已验证）：**
```js
const hash = cwd.replace(/\//g, '-').replace(/_/g, '-')
// 示例：/data/zibuyu/my_lingo_claude → -data-zibuyu-my-lingo-claude
```

`CLAUDE_SESSION_ID` 在 hook 脚本中通过环境变量获取。

### 6.2 行类型

| `type` 字段值 | 含义 |
|--------------|------|
| `mode` | 会话模式记录（无 role） |
| `permission-mode` | 权限模式记录 |
| `file-history-snapshot` | 文件快照 |
| `assistant` | Claude 的回复（含 role: "assistant"） |
| `user` | 用户输入（含 role: "user"） |

### 6.3 Assistant 回复结构

```json
{
  "type": "assistant",
  "sessionId": "abc123",
  "timestamp": "2026-06-08T10:30:00.000Z",
  "isSidechain": false,
  "message": {
    "role": "assistant",
    "model": "claude-sonnet-4-6",
    "content": [
      { "type": "thinking", "thinking": "...", "signature": "..." },
      { "type": "text", "text": "实际回复文本..." },
      { "type": "tool_use", "id": "toolu_xxx", "name": "Bash", "input": { ... } }
    ],
    "usage": { ... }
  }
}
```

### 6.4 高效读取方法

Transcript 文件会随会话增长（每轮约 1–5KB）。Stop hook 只需最新的 assistant 记录，使用尾读策略：

```js
// 读文件末尾 64KB，足够覆盖约 50 条记录
const readSize = Math.min(stat.size, 65536)
const buf = Buffer.alloc(readSize)
const fd = fs.openSync(filePath, 'r')
fs.readSync(fd, buf, 0, readSize, stat.size - readSize)
fs.closeSync(fd)
const lines = buf.toString('utf8').split('\n').filter(Boolean)
// 从最后一行向前扫描，找到第一个 type=assistant 且 sessionId 匹配的记录
```

---

## 7. 迁移路径（v1.0 SQLite）

当需要迁移到 SQLite 时，执行以下步骤：

1. 设计 SQLite schema（参考现有 JSONL 字段结构）
2. 编写迁移脚本：`scripts/migrate-jsonl-to-sqlite.mjs`
3. 批量读取所有 JSONL 文件，写入 SQLite
4. 保留 JSONL 文件作为备份（不删除）
5. 更新 `storage.mjs` 读写逻辑

迁移脚本设计为幂等：可多次运行，重复记录通过 `ts` + `session_id` 去重。
