# 关键技术决策与问题解决方案

版本：v0.2–v0.6（决策记录，含后续版本追加的 D14/D15 与落地修订）  
本文档是对初版设计方案（原 `design.md`，已拆分进本 dev_docs 文档体系后删除）深度复盘后形成的决策文档，每个决策都包含问题背景、推荐方案、备选方案和决策理由。

---

## D1：Hook 无法替换原始输入

### 问题

`UserPromptSubmit` hook 通过 `additionalContext` 注入英文优化内容，但 Claude **同时看到**原始输入（如中文、日语）和英文版本。这不是"替换"，而是"并列"，Claude 可能同时响应两者，核心功能在 MVP 层面受损。

### 参考实现做法

`claude-english-buddy` 的解法是：
- `additionalContext` 写入 `Corrected prompt: {corrected}`（Claude 内部可见）
- `systemMessage` 写入 `User intends to say: {corrected}\n{annotations}`（终端用户可见）
- 两个字段协同工作：Claude 从 context 知道"正确版本是什么"，用户从 systemMessage 看到纠正结果

### 推荐方案

**使用结构化指令注入，而非自由文本注入：**

```json
{
  "additionalContext": "CANONICAL REQUEST: The user's message is in {detected_language}. They have configured My Lingo to optimize prompts to English. Treat the following as their actual request and ignore the language of their original message:\n\n{execution_prompt_en}",
  "systemMessage": "[my-lingo] Optimized ({detected_language}→en, {latency}ms): {execution_prompt_en}\n{key_changes}"
}
```

关键点：
1. 在 `additionalContext` 中显式告诉 Claude "忽略原始消息的语言，以下为规范请求"
2. `systemMessage` 让用户立即在终端看到优化结果（无需 `/my-lingo:last`）
3. 对于纯英文优化（语法纠错），同样格式但注明是"refined"而非"translated"

### 备选方案

- `preview` 模式要求用户确认后再发送——破坏流畅性

### 接受的局限

`additionalContext` 方式在极端情况下（原始输入非常长且语义复杂）Claude 仍可能同时参考原始输入与优化版本。这是 Claude Code hook 机制的结构性上限（无法删除原始输入），通过优化指令措辞可以缓解，无法根治。用户在极端情况下可使用 `--` 前缀跳过优化，手动发送英文输入。

---

## D2：进程生命周期

### 问题

设计中的"异步学习任务"依赖一个持续运行的 worker 进程。但 Claude Code 的 hook 是**每次调用独立启动的进程**，执行完毕后退出。如果依赖一个后台 daemon，需要额外的进程管理机制，大幅增加复杂度。

### 参考实现做法

`claude-english-buddy` **完全没有异步 worker**：
- `UserPromptSubmit` 同步处理（检测+API 调用+写 JSONL）
- `SessionEnd` 钩子在会话结束时做汇总分析
- 所有数据写入 JSONL 文件，命令（`/my-lingo:lesson`）读取文件时按需分析

### 推荐方案

**放弃独立 worker 进程，改用 SessionEnd 钩子 + 按需分析架构：**

```
UserPromptSubmit hook（每次 prompt）：
  - 语言检测（本地，无 API）
  - 调用外部 API 生成 execution_prompt（同步，带超时）
  - 写入 turns JSONL（无需 SQLite jobs 表）
  - 返回 additionalContext + systemMessage

SessionEnd hook（会话结束时）：
  - 读取本次会话的 turns 记录
  - 批量调用外部 API 做学习分析（可接受较长时间）
  - 写入 learning_items JSONL
  - 输出会话学习摘要

/my-lingo:lesson / /my-lingo:errors（按需）：
  - 读取历史 JSONL 文件
  - 调用外部 API 生成课程或错误分析
```

### 好处

- 无需 daemon、无需 jobs 表、无需进程管理
- SessionEnd 天然是"本会话学习材料生成"的正确触发点
- 按需分析命令随时可用，不依赖后台任务完成

---

## D3：存储方案——JSONL vs SQLite

### 问题

原设计选用 SQLite，并设计了 7 张表。但 SQLite 引入了：并发 WAL 配置、job 依赖管理、schema 迁移、异步 worker 等复杂性，对于 MVP 阶段过重。

### 参考实现做法

`claude-english-buddy` 使用**按日期分片的 JSONL 文件**：
```
$CLAUDE_PLUGIN_DATA/history/
  2026-06-01.jsonl
  2026-06-02.jsonl
  ...
```
每行一条记录，按需 `readRange` 读取多天数据。

### 推荐方案

**MVP 阶段使用 JSONL，后续按需引入 SQLite：**

```
$CLAUDE_PLUGIN_DATA/my-lingo/
  turns/
    2026-06-01.jsonl          # 每天的 turns 记录
  learning/
    english/
      items-2026-06.jsonl     # 按语言空间 + 月份分片
      errors-2026-06.jsonl
  spaces.json                  # 语言空间配置（小文件）
  config.json                  # 全局配置
  sessions/
    {session_id}.json          # 会话元数据（可选）
```

### JSONL 记录格式

```jsonc
// turns/2026-06-01.jsonl 中一行
{
  "ts": "2026-06-01T10:23:45Z",
  "session_id": "abc123",
  "language_space": "english",
  "execution_mode": "english_optimized",
  "original_prompt": "check this code have bug",
  "detected_language": "en",
  "execution_prompt": "Review this code for potential bugs, edge cases, and unsafe assumptions.",
  "rewrite_type": "optimize",
  "latency_ms": 1240,
  "fallback": false
}
```

### 何时引入 SQLite

当以下任意条件成立时迁移到 SQLite：
- 历史记录超过 10,000 条（JSONL 查询开始变慢）
- 需要跨字段复杂查询（如"过去30天语法错误频率"）
- 需要全文搜索历史 prompt

### 决议（v0.5）：迁移到 SQLite（`node:sqlite`）

v0.5 起正式迁移到 SQLite。触发因素是 JSONL 在 SRS 与跨会话学习场景下暴露的结构性问题：
SessionEnd 无法标记"已处理"导致崩溃重跑重复生成 corrections；`updateLearningItemReview`
需全文件重写；跨日期/跨月查询需在应用层拼接多文件。

**关键约束（实施时实测确认，记录以防回退）：**
- 使用 Node 内置 `node:sqlite`（需 **Node ≥ 22.13** —— 该模块 22.5 起需 `--experimental-sqlite` flag，22.13 起免 flag；`package.json` 的 `engines.node` 已锁 `>=22.13.0`），保持零 npm 依赖。
- 单文件 `$CLAUDE_PLUGIN_DATA/my-lingo/data.db`，WAL 模式 + `busy_timeout=3000`，匹配多 hook 进程并发。
- `node:sqlite` **不能绑定布尔 / `undefined` / 对象**，写入层统一转 `0/1` / `null` / `JSON.stringify`；读取层把整数标志位还原为布尔。
- 时间统一存 ISO-`Z` 字符串，日期范围查询用 `substr(ts,1,10)` / `substr(ts,1,7)` 切片比较，**不依赖** SQLite 的 `datetime('now')`（其输出格式与 ISO-`Z` 字典序不可比）。
- SessionEnd 幂等：`turns.analyzed` 标志位 + 写入与标记放在**单个事务**内原子提交（网络分析调用置于事务外）。
- 全部 SQLite 调用封装在 `db.mjs` + `storage.mjs`，应对 `node:sqlite` 未来可能的 breaking change。

实施细节见 [`development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md`](./development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md) 与 [`07-storage.md`](./07-storage.md)。

---

## D4：同步路径超时与熔断

### 问题

外部 API 调用是同步的，阻塞 Claude Code 处理。API 不可用、网络慢时，用户体验直接崩溃。原设计提到"5-8 秒超时"但未指定熔断行为。

### 参考实现做法

使用 `curl --max-time 30` + `spawnSync timeout: 35_000`，失败时静默返回 `null`，不阻塞 Claude。代码：
```javascript
if (result.error || result.status !== 0) return null;
// ... 继续处理，null 时走 fallback
```

### 推荐方案

**三级降级策略：**

```
Level 1（快速路径，目标 < 2s）：
  本地语言检测（ASCII 比率，无 API）→ 成功则继续

Level 2（同步 API，目标 < 5s，超时 8s）：
  调用外部 API 生成 execution_prompt
  成功 → 注入 Claude，记录 turn
  超时/失败 → 进入 Level 3

Level 3（Fallback）：
  根据 fallback_policy：
  - "send_original"：直接发原始输入，systemMessage 提示用户 API 不可用
  - "skip"：静默跳过优化（最少干扰）
  记录 turn，标注 fallback=true
  SessionEnd 时补充分析
```

**熔断机制：**
- 连续 3 次 API 失败 → 自动切换 fallback_policy 为 "send_original" 并写入 config
- 下次成功后自动恢复
- 状态写入 `$CLAUDE_PLUGIN_DATA/my-lingo/circuit.json`

---

## D5：语言检测策略

### 问题

原设计未说明语言检测具体实现。调用 API 检测语言会增加延迟。

### 参考实现做法

本地 ASCII 比率启发式算法：
```javascript
// ASCII printable (0x20-0x7E) 占比 >= 85% 视为英文
const ratio = asciiPrintable / totalChars
if (ratio >= 85) return 'english'
else return 'non-english'
```

### 推荐方案

**分层检测（无额外 API 成本）：**

设计阶段曾考虑三分类（en / cjk / mixed），但最终采用与参考实现一致的**二分类**：

```javascript
// 实际实现（detect.mjs）：ratio 为 0–100 整数；只分 en / non-english，无 mixed/cjk/confidence
export function detectLanguage(text) {
  const chars = [...text]
  const asciiCount = chars.filter(c => {
    const code = c.charCodeAt(0)
    return code >= 0x20 && code <= 0x7e
  }).length
  const ratio = Math.round((asciiCount / chars.length) * 100)
  return { lang: ratio >= 85 ? 'en' : 'non-english', ratio }
}
```

> **落地说明**：三分类的 `mixed`/`cjk`/`confidence` 字段从未实现。所有"非以英文为主"的输入统一归为 `non-english`，照常走优化路径（英文技术词由优化器 system prompt 负责保留）。语言检测结果（`lang` + `ratio`）存入 turn 记录供后续分析。

---

## D6：Hook 跳过逻辑

### 问题

不是所有 prompt 都需要处理：slash 命令、纯代码块、过短输入等应跳过。

### 参考实现做法

```javascript
function shouldSkip(prompt) {
  if (prompt.startsWith('/')) return true           // slash 命令
  if (charCount < 10 && wordCount < 3) return true  // 过短
  if (/^(https?:|git@|npm |pip |docker )/i.test(prompt)) return true  // URL/命令
  return false
}
```

### 推荐方案

实际实现（`detect.mjs`，注意**不含 `!` 规则**——见下方落地说明）：

```javascript
export function shouldSkip(prompt) {
  if (!prompt) return true
  if (prompt.startsWith('/')) return true            // slash 命令（包括 /my-lingo:xxx）
  const charCount = [...prompt].length
  const wordCount = prompt.split(/\s+/).filter(Boolean).length
  if (charCount < 8 && wordCount < 3) return true    // 过短：字符<8 且 词数<3（CJK 无空格用字符兜底）
  if (/^```/.test(prompt.trim())) return true        // 纯代码块
  if (/^(https?:|git@|ssh:\/\/|npm |pip |cargo |brew |sudo |cd |ls |cat |grep |docker |kubectl )/i.test(prompt)) return true
  return false
}
```

> **落地说明（v0.3 起）**：`shouldSkip` **不再检查 `!` 前缀**。原因见 [`13-raw-prefix-rename.md`](./13-raw-prefix-rename.md)：Claude Code 在 UI 层把 `!foo` 解释为终端命令，`!` 开头的消息**根本不会进入 hook**，因此 hook 内无需也不应判断它。过短判定是"字符<8 **且** 词数<3"的复合条件（非单纯 `<8`）。

**特殊前缀设计（均在 `shouldSkip` 之前于 `user-prompt-submit.mjs` 分流）：**
- `--` 前缀 → 本次跳过优化，仅记录并透传原始输入（mode:'raw'）
- `::` 前缀 → 强制 refine 模式；**绕过 `shouldSkip`**，使 ":: fix" 等短输入也能处理
- `/my-lingo:mode <mode>` → 全局切换执行模式

---

## D7：API 调用实现

### 问题

原设计使用 Python + `requests`。但参考实现揭示了一个重要限制：**hook 脚本内不能调用 `claude` CLI**（会死锁），必须直接调用 Anthropic API 或外部 API。

### 参考实现做法

```javascript
// 通过 curl 同步调用，避免 claude CLI 死锁
spawnSync('curl', [
  '-s', '--max-time', '30',
  'https://api.anthropic.com/v1/messages',
  '-H', `x-api-key: ${apiKey}`,
  '-d', body,
], { encoding: 'utf8', timeout: 35_000 })
```

API key 从 `ANTHROPIC_API_KEY` 环境变量或 macOS keychain 读取，**不需要单独配置文件**。

### 推荐方案

**统一使用 OpenAI-compatible API + curl 方式：**

My Lingo 支持任意 OpenAI-compatible provider，用 curl 同步调用（下方为决策当时的示意；最终实现 `max_tokens` 改为随输入动态放大 512–2048，并在出站边界统一脱敏，见 [`06-api-protocol.md`](./06-api-protocol.md) §3.1）：

```javascript
function callFastModel(systemPrompt, userText, config) {
  const body = JSON.stringify({
    model: config.model_fast,
    max_tokens: 512,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ]
  })
  
  const result = spawnSync('curl', [
    '-s', '--max-time', String(config.timeout_seconds || 8),
    `${config.api_base_url}/chat/completions`,
    '-H', 'content-type: application/json',
    '-H', `authorization: Bearer ${config.api_key}`,
    '-d', body,
  ], { encoding: 'utf8', timeout: (config.timeout_seconds + 2) * 1000 })
  
  if (result.error || result.status !== 0) return null
  try {
    const resp = JSON.parse(result.stdout)
    return JSON.parse(resp.choices[0].message.content)
  } catch { return null }
}
```

**API key 解析优先级（最终实现，见 `config.mjs` Layer 0 / `credValue()`，另见 [`12-env-var-config.md`](./12-env-var-config.md)）：**
1. **plugin.json `userConfig`**（Claude Code 注入为 `CLAUDE_PLUGIN_OPTION_API_KEY` 环境变量）—— **优先**
2. `MY_LINGO_API_KEY` 用户手动 export 的环境变量 —— **兜底**
3. 绝不读取/写入磁盘上的明文配置文件（`CREDENTIAL_FIELDS` 在读写 config.json 时强制过滤）

> 注：本节早期草稿把优先级写反（env 优先）。最终实现以 userConfig 优先，空值时回退到 `MY_LINGO_*`。

---

## D8：学习系统设计

### 问题

原设计的学习功能缺少间隔重复（SRS）机制，`learning_items` 只是词汇列表。同时，错误分析 AI Prompt 未设计，课程格式未明确。

### 推荐方案

**MVP 阶段：轻量学习系统**

不在 MVP 阶段实现完整 SRS，改为：

1. **SessionEnd 生成学习摘要**：每次会话结束后，对本次 turns 做批量分析，生成 2-5 个"今日学习点"写入 JSONL
2. **错误模式识别**：统计同类错误出现频率（参考实现的 `bucket by (original, corrected) pair`）
3. **`/my-lingo:lesson` 按需生成**：读取最近 N 天的 turns + learning_items，发给 deep model 生成课程 markdown

**错误分析 API Prompt（需明确定义）：**

```
You are a language coach for a developer learning {target_language}.
Analyze the difference between the user's original prompt and the optimized version.
Identify language errors the user made. Be conservative — only flag real errors, not style preferences.
For technical terms (code, variable names, tool names, error messages), never flag them as errors.
Output JSON: { "corrections": [{ "type": "grammar|expression|vocabulary", "original": "...", "corrected": "...", "explanation": "..." }] }
Maximum 3 corrections. If no real errors, output: { "corrections": [] }
```

**v0.3 引入简化 SRS：**
在 learning_items JSONL 中增加字段：
```json
{ "next_review": "2026-06-08", "review_count": 0, "ease": 2.5 }
```
`/my-lingo:review` 命令显示今日到期的复习项目。

---

## D9：实现语言——Python vs Node.js

### 问题

原设计选择 Python。但参考实现使用 Node.js，且 Claude Code 插件生态更倾向 JavaScript。

### 分析

| 因素 | Python | Node.js |
|------|--------|---------|
| 参考实现语言 | ✗ | ✓ |
| Claude Code 插件生态 | 中立 | 更常见 |
| 系统依赖 | `python3`（macOS 内置）| `node`（需安装） |
| SQLite 支持 | `sqlite3`（标准库）| 需要 `better-sqlite3` |
| JSONL 处理 | 简单 | 简单 |
| curl 调用 | `subprocess.run` | `spawnSync` |

### 推荐方案

**使用 Node.js（与参考实现保持一致）：**

理由：
1. 参考实现已验证 Node.js 在 Claude Code hook 中的可行性
2. 可以直接参考 `claude-english-buddy` 的 curl 调用、API key 获取、JSONL 存储等模式
3. `package.json` 管理依赖比 `pyproject.toml` 在插件环境下更轻量

**最小依赖原则：** 只使用 Node.js 标准库（`fs`、`path`、`os`、`child_process`）+ `curl`，不引入 npm 包（避免 `node_modules` 问题）。

---

## D10：隐私与脱敏

### 问题

原设计的脱敏范围只覆盖"API key、密码"，遗漏了：文件路径（含用户名）、内部主机名、IP 地址、stack trace 内部路径、公司内部包名等。

### 推荐方案

**分层脱敏策略：**

```javascript
const REDACTION_PATTERNS = [
  // API keys & tokens
  { pattern: /\b(sk-[a-zA-Z0-9]{32,}|Bearer\s+[a-zA-Z0-9._-]+)\b/g, replacement: '[API_KEY]' },
  // Passwords in connection strings
  { pattern: /(:\/\/[^:]+:)[^@]+(@)/g, replacement: '$1[PASS]$2' },
  // Absolute file paths with home dir
  { pattern: /\/home\/[a-zA-Z0-9_-]+\//g, replacement: '/home/[USER]/' },
  { pattern: /\/Users\/[a-zA-Z0-9_-]+\//g, replacement: '/Users/[USER]/' },
  // Private IP ranges
  { pattern: /\b(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)\d+\.\d+\b/g, replacement: '[PRIVATE_IP]' },
]

function redact(text) {
  let result = text
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}
```

**脱敏时机：发送给外部 API 之前**（最终实现下沉到出站边界 `redactMessages`，见 `09-privacy-security.md`）；本地存储不脱敏（用户有权看到自己的原始输入）。

> 落地说明：当初设想的 `privacy_mode: "strict"`（本地也脱敏）**最终未实现**。当前 `privacy_mode` 只区分 `standard`（出站脱敏）与 `off`（不脱敏）；`strict` 等值都按 `standard` 处理，本地始终存原文。

---

## D11：命令实现方式

### 问题

原设计把 skills 实现为 `SKILL.md` 文件（Claude Code 旧格式）。参考实现使用 `commands/` 目录 + markdown 文件（Claude Code 新格式）。

### 参考实现做法

```
commands/
  review.md       # 包含 YAML frontmatter + workflow markdown
  lesson.md
  ...
```

Frontmatter 格式：
```yaml
---
name: review
description: ...
argument-hint: "<text or file path>"
allowed-tools: Bash, Read
---
```

### 推荐方案

**使用 `commands/` 目录格式（与参考实现保持一致）：**

```
my-lingo-claude/
  commands/
    my-lingo/
      info.md
      use.md
      mode.md
      last.md
      lesson.md
      errors.md
      profile.md
      ...
```

命令实现为 Claude 执行的 markdown workflow，由 Claude 本身读取 JSONL 数据并格式化输出，无需额外 Python/JS 脚本。

---

## D12：MVP 范围重新定义

### 调整理由

基于以上技术决策，MVP 范围需要重新定义：

### MVP 必须实现（v0.1）

1. **插件骨架**：`plugin.json`、`hooks/hooks.json`、Node.js hook 脚本
2. **语言检测**：本地 ASCII 比率算法
3. **同步 Prompt 优化**：调用外部 API，超时 8s，fallback 为发送原始输入
4. **JSONL 存储**：turns 记录写入按日期分片的 JSONL
5. **additionalContext + systemMessage 注入**：结构化指令注入
6. **`/my-lingo:info`**：显示配置和今日统计
7. **`/my-lingo:last`**：显示上一次的 original → execution_prompt
8. **`/my-lingo:mode`**：切换执行模式
9. **SessionEnd 钩子**：输出本次会话统计（corrections / translations 数量）
10. **基础脱敏**：API key、密码、用户名路径

### MVP 推迟到 v0.2

1. 语言空间切换（多语言支持）
2. 异步学习文本生成
3. 错误分析（`/my-lingo:errors`）
4. 课程生成（`/my-lingo:lesson`）
5. 用户画像（`/my-lingo:profile`）
6. 词汇/句型提取

### 推迟到 v0.3+

1. 间隔重复（SRS）
2. 多端同步
3. Anki 导出

---

## D13：项目命名规范

### 问题

项目在多个层级使用名称：用户界面展示名、插件 ID、命令前缀、数据目录、Git 仓库名、npm 包名、JS 代码变量名。需要统一约定，避免混用。

### 候选方案

**`my-lingo` vs `my-lango`**

- `lingo`：真实英文单词，意为"（某群体的）语言/行话"，语义与本插件高度吻合，有词典收录，易记、可搜索
- `lango`：不是词，可能被解读为 language 的缩写，但没有明确含义，增加认知负担

**结论：使用 `my-lingo`**

**仓库名是否带 `-claude` 后缀**

- 带后缀（`my-lingo-claude`）：明确表示这是 Claude Code 专属实现，未来若扩展至 VSCode 或 Cursor 时可以用 `my-lingo-vscode` 等区分
- 不带后缀（`my-lingo`）：更简洁，但和插件 ID 完全相同，容易混淆

**结论：仓库名带 `-claude`，插件 ID 不带**

### 命名层级规范

| 场景 | 形式 | 具体值 |
|------|------|--------|
| 用户界面、文档标题、对话中提及 | `My Lingo`（首字母大写 + 空格）| "My Lingo is a plugin..." |
| `plugin.json` `name` 字段 | `my-lingo`（全小写 kebab-case）| `"name": "my-lingo"` |
| 用户命令前缀 | `my-lingo`（全小写 kebab-case）| `/my-lingo:info` |
| 插件数据目录 | `my-lingo`（全小写 kebab-case）| `$CLAUDE_PLUGIN_DATA/my-lingo/` |
| Git 仓库名 | `my-lingo-claude`（加平台后缀）| `github.com/xxx/my-lingo-claude` |
| `package.json` `name` 字段 | `my-lingo-claude`（加平台后缀）| `"name": "my-lingo-claude"` |
| JS 代码变量/函数前缀 | `myLingo`（camelCase）| `const myLingoConfig = ...` |

### 不可混用的场景

- **文档中**：产品名写 "My Lingo"，不写 "my-lingo" 或 "MyLingo"
- **命令中**：`/my-lingo:setup`，不写 `/MyLingo:setup` 或 `/my_lingo:setup`
- **代码中**：变量名用 camelCase（`myLingo`），不用 kebab 或 snake_case
- **路径中**：目录名用 `my-lingo`，不用 `myLingo` 或 `my_lingo`

---

## D14：通过 Stop Hook + Transcript 文件捕获 Claude 回复

### 问题

SessionEnd 分析目前只有 `original_prompt → execution_prompt` 的对比，缺少 Claude 的实际回复内容。Claude 的高质量英文回复本身是宝贵的学习材料（目标语言的专业示范），忽略它导致学习系统只分析"学习者的输出"，而错过了"母语者的示范"。

### 技术发现

Claude Code 将完整对话（含 Claude 的每条回复）实时写入本地 JSONL 文件：

```
~/.claude/projects/<path-hash>/<session-id>.jsonl
```

**path-hash 推导算法（最终实现，见 `stop.mjs` + F8 修复）：**
```js
// /data/zibuyu/my_lingo_claude → -data-zibuyu-my-lingo-claude
const hash = cwd.replace(/[^a-zA-Z0-9]/g, '-')
```
将 cwd 中**所有非字母数字字符**替换为 `-`（对齐 Claude Code 真实规则）。早期版本只替换 `/` 和 `_`，对含 `.`、空格、`@` 的工程路径会算错目录、静默丢失回复捕获——已由 [`15-architecture-review-v0.5.md`](./15-architecture-review-v0.5.md) 的 F8 修复。

**JSONL 行格式（assistant 回复）：**
```json
{
  "type": "assistant",
  "sessionId": "abc123",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", ... },
      { "type": "text", "text": "实际回复文本..." },
      { "type": "tool_use", ... }
    ]
  }
}
```
学习内容提取只需关注 `type === "text"` 的 content block。

### 推荐方案

**Stop hook（每轮结束触发）+ Transcript 文件尾读**：

1. Stop hook 触发后，读取 transcript JSONL 尾部（最多 64KB）
2. 按 sessionId 过滤，提取最新的 assistant text 内容
3. 写入 `$PLUGIN_DATA/my-lingo/responses/{today}.jsonl`
4. SessionEnd 读取 responses 数据，纳入学习分析（降级安全：无数据则跳过）

### 安全约束（不影响用户交互）

Stop hook 可能阻塞用户输入下一条命令，因此约束严格：

| 约束 | 原因 |
|------|------|
| 无 API 调用 | 会增加 2–8s 可感知延迟 |
| 无 sleep/重试 | 延迟直接影响交互响应 |
| 目标 < 200ms | 仅涉及本地文件读写 |
| 所有错误静默 | 学习数据缺失不影响核心功能 |
| 始终 exit 0 | 非 0 退出会在 Claude Code 界面显示错误 |

### 竞态风险处理

Claude Code 写 transcript 与触发 Stop hook 之间理论上存在竞态，但无官方文档保证顺序。实现时**不依赖时序**：找不到 assistant 记录直接静默退出，不重试不 sleep。SessionEnd 在 response 数据缺失时降级为现有行为（仅分析 original→optimized 对比），不中断。

### 为何不用 PostToolUse Hook

PostToolUse 在每次工具调用后触发，包含工具输出，但不包含 Claude 的文本回复（工具调用之间的 prose）。Stop hook 是唯一能在完整回复生成后运行的钩子，配合 transcript 文件读取是当前最简洁的方案。

---

## D15：分析触发保障机制（v0.6）

### 问题

生产环境诊断（2026-06-15）发现：44 条 turns、10 个历史 session，`sessions` 表为空，`analyzed=0` 全部为零。SessionEnd hook 在 Claude Code daemon 模式下**从未触发**。

根本原因：Claude Code 以 daemon 模式长期运行时，`SessionEnd` 仅在 daemon 进程本身退出时触发，而非每次对话窗口关闭。用户日常使用中 daemon 可能连续运行数天，导致学习分析功能完全失效。

### 推荐方案

**两层保障，以 `analysis.lock` 互斥**：

**层 A（主）：SessionStart hook**
- 新会话启动时触发 `scripts/session-start.mjs`
- 检查是否有来自其他 session 的未分析 turns（一次 `SELECT COUNT`，< 5ms）
- 有积压且 lock 不新鲜 → 写 lock → `spawn detached session-end.mjs` → 立即退出
- 分析进程与 hook 完全解耦，不占用 hook 超时预算
- hook 总耗时 < 30ms

**层 B（副）：UserPromptSubmit 阈值兜底**
- 写入 turn 后检查未分析 turns 总数
- 超过阈值（默认 20）且 lock 不新鲜 → spawn detached 分析进程
- 覆盖"长时间单 session"场景（SessionStart 已处理历史积压，但当前 session 内仍在积累）

**`analysis.lock` 防并发**：
- 路径：`$PLUGIN_DATA/my-lingo/analysis.lock`，内含分析进程 PID
- 新鲜窗口：5 分钟（超时视为进程已死）
- 分析完成（COMMIT 或 ROLLBACK）后删除 lock

### session-end.mjs 适配

- 分析完成后增加 lock 清理（`unlinkSync analysis.lock`）
- 识别 `MY_LINGO_CATCHUP=1` 环境变量（由 SessionStart 设置），可在 stderr 统计输出中区分"正常 SessionEnd"和"补偿运行"

### 接受的局限

- 当前 session 的 turns 只能等到下次 SessionStart 或阈值触发才被分析
- detached spawn 的 stdio 为 `ignore`，分析结果不可见于当前终端
- 若 daemon 从不重启且每个 session 都不超过阈值，分析永远延迟到下次启动——这是可接受的权衡（vs. 完全失效）

---

## 总结：核心决策一览

| 决策点 | 原设计 | 推荐方案 |
|--------|--------|----------|
| 实现语言 | Python | Node.js |
| 存储方案 | SQLite（7张表）| JSONL（v0.1–v0.4）→ **SQLite（v0.5 起，`node:sqlite`，单库 5 表）**|
| 异步 worker | 独立 daemon | 无 daemon，改用 SessionEnd 钩子 |
| 语言检测 | 调用外部 API | 本地 ASCII 比率算法 |
| API 调用 | Python requests | curl + spawnSync |
| Hook 注入 | 自由文本 additionalContext | 结构化指令 + systemMessage |
| 命令格式 | skills/SKILL.md | commands/**.md |
| API key 存储 | 配置文件 | 环境变量 / plugin.json userConfig |
| 学习系统 | 立即实现（含 jobs 表）| SessionEnd 摘要（MVP），SRS（v0.3）|
| MVP 范围 | 17 项（含多语言空间）| 10 项（单语言空间优先）|
| 项目命名 | 未定义 | My Lingo / my-lingo / my-lingo-claude（三层分离）|
| Claude 回复捕获 | 无 | Stop hook + transcript 文件读取，responses/ 缓存 |
| 分析触发保障 | 仅 SessionEnd（daemon 下失效）| SessionStart hook + UserPromptSubmit 阈值兜底（v0.6）|
