# 关键技术决策与问题解决方案

版本：v0.2  
本文档是对 design.md 初版方案深度复盘后形成的决策文档，每个决策都包含问题背景、推荐方案、备选方案和决策理由。

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

- Wrapper 模式（见 D9），完全替换用户输入——MVP 阶段开发成本过高
- `preview` 模式要求用户确认后再发送——破坏流畅性

### 接受的局限

`additionalContext` 方式在极端情况下（原始日语 prompt 非常长且包含复杂语义）Claude 仍可能"两者都参考"。这是 MVP 阶段的已知局限，通过 wrapper 模式在后续版本解决。

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

```javascript
function detectLanguage(text) {
  // 1. 快速启发式（本地，< 1ms）
  const ascii = asciiRatio(text)
  if (ascii >= 0.85) return { lang: 'en', confidence: 'high' }
  if (ascii <= 0.30) return { lang: 'cjk', confidence: 'high' }  // CJK 字符为主
  
  // 2. 混合语言（如中英混合，常见于技术 prompt）
  return { lang: 'mixed', confidence: 'medium' }
}
```

对于 `mixed` 情况，视为需要优化（英文技术词保留，中文翻译）。  
语言检测结果存入 turn 记录供后续分析。

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

在参考实现基础上扩展：

```javascript
function shouldSkip(prompt) {
  if (prompt.startsWith('/')) return true            // slash 命令（包括 /my-lingo:xxx）
  if (prompt.startsWith('!')) return true            // shell 命令
  if (prompt.startsWith('::')) return false          // 强制优化前缀（保留处理）
  if (/^`{3}/.test(prompt)) return true             // 纯代码块
  const chars = [...prompt].length
  if (chars < 8) return true
  if (/^(https?:|git@|ssh:\/\/|npm |pip |cargo |brew |sudo |cd |ls )/i.test(prompt)) return true
  return false
}
```

**特殊前缀设计：**
- `::` 前缀 → 强制优化模式（参考实现用于"refine"，My Lingo 同样适用）
- `!raw` 前缀 → 本次跳过优化，直接发原始输入
- `/my-lingo:mode raw` → 全局切换模式

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

My Lingo 支持任意 OpenAI-compatible provider，用 curl 同步调用：

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

**API key 存储优先级：**
1. `MY_LINGO_API_KEY` 环境变量
2. `plugin.json` 的 `userConfig.api_key`（Claude Code 加密存储）
3. 不读取磁盘上的明文配置文件

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

**脱敏时机：发送给外部 API 之前，存储到本地 JSONL 不脱敏（用户有权看到自己的原始输入）**

提供 `privacy_mode: "strict"` 配置，开启后连本地存储也脱敏。

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
      status.md
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
6. **`/my-lingo:status`**：显示配置和今日统计
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
2. Wrapper 模式
3. 多端同步
4. Anki 导出

---

## 总结：核心决策一览

| 决策点 | 原设计 | 推荐方案 |
|--------|--------|----------|
| 实现语言 | Python | Node.js |
| 存储方案 | SQLite（7张表）| JSONL 文件（MVP），SQLite（v1.0+）|
| 异步 worker | 独立 daemon | 无 daemon，改用 SessionEnd 钩子 |
| 语言检测 | 调用外部 API | 本地 ASCII 比率算法 |
| API 调用 | Python requests | curl + spawnSync |
| Hook 注入 | 自由文本 additionalContext | 结构化指令 + systemMessage |
| 命令格式 | skills/SKILL.md | commands/**.md |
| API key 存储 | 配置文件 | 环境变量 / plugin.json userConfig |
| 学习系统 | 立即实现（含 jobs 表）| SessionEnd 摘要（MVP），SRS（v0.3）|
| MVP 范围 | 17 项（含多语言空间）| 10 项（单语言空间优先）|
