# My Lingo — 开发文档索引

> **AI 协作入口文档**
> 当与 AI 结对编程时，携带本文件即可让 AI 了解项目全貌。涉及具体模块时，AI 应主动阅读对应的详细文档。

---

## 项目一句话定位

**My Lingo** 是一个 Claude Code 插件。它在用户每次提交 Prompt 时，自动将其优化为更适合 Claude Code 理解的英文执行 Prompt，同时将真实交互记录沉淀为个性化语言学习材料。

---

## 技术栈与关键约束

| 项目 | 决策 |
|------|------|
| 实现语言 | **Node.js（ESM，`*.mjs`）**，不使用 Python |
| 外部依赖 | **零 npm 包**，只用 Node.js 标准库 + 系统 `curl` |
| 存储方案 | **JSONL 文件**（MVP），路径 `$CLAUDE_PLUGIN_DATA/my-lingo/` |
| API 调用 | **`spawnSync('curl', [...])`**，不能用 `claude` CLI（会死锁）|
| 语言检测 | **本地 ASCII 比率算法**，无 API 调用，< 1ms |
| Hook 系统 | **UserPromptSubmit**（同步，8s 超时）+ **SessionEnd**（批量分析）|
| 命令格式 | `commands/my-lingo/*.md`（markdown workflow + YAML frontmatter）|
| 当前阶段 | **v0.1 MVP 已完成**（88 单元测试通过，Phase 0–5 全部实现）|

---

## 目录结构（实现完成后）

```
my-lingo-claude/
├── .claude-plugin/
│   └── plugin.json              # 插件元数据，声明 userConfig
├── commands/
│   └── my-lingo/
│       ├── setup.md             # /my-lingo:setup
│       ├── status.md            # /my-lingo:status
│       ├── last.md              # /my-lingo:last
│       └── mode.md              # /my-lingo:mode
├── hooks/
│   └── hooks.json               # UserPromptSubmit + SessionEnd 配置
├── scripts/
│   ├── user-prompt-submit.mjs   # Hook 主入口
│   ├── session-end.mjs          # 会话结束钩子
│   └── lib/
│       ├── detect.mjs           # 语言检测 + 跳过逻辑
│       ├── config.mjs           # 4 层配置合并
│       ├── storage.mjs          # JSONL 读写工具
│       ├── api.mjs              # curl 调用 + 熔断器
│       ├── prompts.mjs          # Prompt 构建
│       └── privacy.mjs          # 脱敏处理
├── tests/
│   ├── detect.test.mjs
│   ├── prompts.test.mjs
│   ├── privacy.test.mjs
│   ├── config.test.mjs
│   └── storage.test.mjs
└── dev_docs/                    # 本文档体系所在位置
```

---

## 文档体系索引

### 阅读哪份文档？

| 你要做的事 | 应该阅读 |
|------------|---------|
| 了解产品背景、目标用户、版本计划 | [`01-overview.md`](./01-overview.md) |
| 理解语言空间、执行模式、语言检测、配置层级 | [`02-core-concepts.md`](./02-core-concepts.md) |
| 实现或修改任意 `/my-lingo:xxx` 命令 | [`03-commands.md`](./03-commands.md) |
| 理解整体数据流、进程模型、时序 | [`04-architecture.md`](./04-architecture.md) |
| 实现或修改 `hooks/hooks.json` 或 hook 脚本 | [`05-hooks.md`](./05-hooks.md) |
| 实现或修改外部 API 调用、System Prompt、JSON 输出格式 | [`06-api-protocol.md`](./06-api-protocol.md) |
| 实现或修改 `storage.mjs`、JSONL 读写、配置文件格式 | [`07-storage.md`](./07-storage.md) |
| 实现或修改 `plugin.json`、目录结构、`package.json` | [`08-plugin-structure.md`](./08-plugin-structure.md) |
| 实现或修改 `privacy.mjs`、脱敏规则、安全设计 | [`09-privacy-security.md`](./09-privacy-security.md) |
| 了解 MVP 范围、实现阶段划分、风险登记、验收清单 | [`10-mvp-roadmap.md`](./10-mvp-roadmap.md) |
| 查询某个关键架构决策的背景和理由 | [`00-decisions.md`](./00-decisions.md) |

---

## 核心工作流（必须理解）

### UserPromptSubmit Hook 路径（同步，最关键）

```
用户按 Enter
  → hook 进程启动（node scripts/user-prompt-submit.mjs）
  → 读取 stdin JSON：{ prompt, cwd, session_id }
  → shouldSkip()：slash命令/!命令/过短/纯代码块 → 直接退出
  → loadConfig()：读取 config.json + spaces.json（4层合并）
  → execution_mode === 'off' → 退出
  → detectLanguage()：ASCII 比率算法（本地，< 1ms）
  → execution_mode === 'original' → 只写 turn JSONL，退出
  → redact()：脱敏后发给外部 API
  → callFastModel()：curl 调用，超时 8s
      ├─ 成功 → 写 turn JSONL，emit { additionalContext, systemMessage }
      └─ 失败 → fallback：写 turn（fallback:true），emit systemMessage 提示
  → hook 进程退出
  → Claude Code 读取输出，注入 additionalContext，Claude 处理 prompt
```

### additionalContext 注入格式（D1 决策）

```
CANONICAL REQUEST: The user's message is in {lang}. They have configured
My Lingo to optimize prompts to English. Treat the following as their
actual request and ignore the language of their original message:

{execution_prompt_en}
```

### SessionEnd Hook 路径

```
Claude 会话结束
  → hook 进程启动（node scripts/session-end.mjs）
  → 读取今日 turns JSONL，过滤本 session_id
  → 统计：总数 / 优化数 / 翻译数 / 纠错数 / fallback 数
  → 识别高频错误对
  → stderr 输出统计摘要（终端可见）
  → （v0.2+）写 learning JSONL
  → 进程退出
```

---

## 关键技术决策速查（来自 00-decisions.md）

| 决策 | 结论 | 详情 |
|------|------|------|
| D1 Hook 注入 | `additionalContext` 用结构化 CANONICAL REQUEST 指令 | [00-decisions.md#D1](./00-decisions.md) |
| D2 进程模型 | 无 daemon，用 SessionEnd 替代异步 worker | [00-decisions.md#D2](./00-decisions.md) |
| D3 存储 | JSONL 文件，不用 SQLite（MVP） | [00-decisions.md#D3](./00-decisions.md) |
| D4 超时/熔断 | 8s 超时 + 连续 3 次失败触发熔断（circuit.json） | [00-decisions.md#D4](./00-decisions.md) |
| D5 语言检测 | 本地 ASCII 比率（≥85% 英文，≤30% CJK，中间为 mixed） | [00-decisions.md#D5](./00-decisions.md) |
| D6 跳过逻辑 | `/` `!` 前缀、< 8 字符、纯代码块、URL 前缀 | [00-decisions.md#D6](./00-decisions.md) |
| D7 API 调用 | `spawnSync('curl', [...])` —— 不能用 `claude` CLI（死锁）| [00-decisions.md#D7](./00-decisions.md) |
| D8 学习系统 | SessionEnd 生成摘要（MVP），SRS 在 v0.3 | [00-decisions.md#D8](./00-decisions.md) |
| D9 实现语言 | Node.js ESM，零 npm 依赖 | [00-decisions.md#D9](./00-decisions.md) |
| D10 脱敏 | 覆盖 API key、DB 密码、用户名路径、私有 IP、AWS key | [00-decisions.md#D10](./00-decisions.md) |
| D11 命令格式 | `commands/my-lingo/*.md`（不用旧版 `skills/SKILL.md`）| [00-decisions.md#D11](./00-decisions.md) |
| D12 MVP 范围 | 10 项核心功能，单语言空间（English），多语言 v0.2 | [00-decisions.md#D12](./00-decisions.md) |

---

## MVP 实现状态（v0.1）

当前状态：**v0.1 MVP 已完成实现，88 单元测试通过**

### 实现阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | 插件骨架：`plugin.json` + `hooks/hooks.json` + hook 桩 + `storage.mjs` + `status.md` | ✅ 已完成 |
| Phase 1 | `detect.mjs`（语言检测 + 跳过逻辑） | ✅ 已完成 |
| Phase 2 | `api.mjs`（curl 调用 + 熔断器）+ `prompts.mjs` + `additionalContext`/`systemMessage` 注入 | ✅ 已完成 |
| Phase 3 | `config.mjs`（4 层配置合并）+ `setup.md` + `mode.md` | ✅ 已完成 |
| Phase 4 | `privacy.mjs`（脱敏规则） | ✅ 已完成 |
| Phase 5 | 完善 `status.md` + `last.md` + 单元测试 + `session-end.mjs` | ✅ 已完成 |

### MVP 必须实现的功能（10 项）

1. 插件骨架（`plugin.json`、`hooks/hooks.json`、Node.js hook 脚本）
2. 语言检测（本地 ASCII 比率算法）
3. 同步 Prompt 优化（调用外部 API，超时 8s，fallback）
4. JSONL 存储（turns 按日期分片写入）
5. `additionalContext` + `systemMessage` 注入（结构化指令）
6. `/my-lingo:status`（配置和今日统计）
7. `/my-lingo:last`（上一次 original → execution_prompt）
8. `/my-lingo:mode`（切换执行模式）
9. SessionEnd 钩子（会话统计输出 stderr）
10. 基础脱敏（API key、密码、用户名路径）

---

## 数据流关键文件路径

```
$CLAUDE_PLUGIN_DATA/my-lingo/
├── config.json                  # 全局配置（API URL、模型、超时等）
├── spaces.json                  # 语言空间配置（active space、各 space 设置）
├── circuit.json                 # 熔断器状态（failure_count、last_failure_at）
├── turns/
│   └── YYYY-MM-DD.jsonl         # 每日 turns 记录（每次 hook 追加一行）
├── learning/
│   └── english/
│       ├── corrections-YYYY-MM.jsonl   # 语法纠错记录
│       └── items-YYYY-MM.jsonl         # 学习材料
└── sessions/
    └── YYYY-MM-DD.jsonl         # 会话摘要（SessionEnd 写入）
```

**注意**：`api_key` 不存储在任何文件中，从环境变量 `MY_LINGO_API_KEY` 或 `plugin.json` userConfig 读取。

---

## 参考实现

`claude-english-buddy-ref/` 目录（git-ignored）是参考实现，来自 [xiaolai/claude-english-buddy-for-claude](https://github.com/xiaolai/claude-english-buddy-for-claude)。

关键参考文件：
- `claude-english-buddy-ref/scripts/prompt-coach-hook.mjs` — hook 主逻辑（curl 调用、emit 模式）
- `claude-english-buddy-ref/scripts/lib/detect.mjs` — ASCII 比率语言检测
- `claude-english-buddy-ref/scripts/lib/state.mjs` — JSONL 读写模式
- `claude-english-buddy-ref/hooks/hooks.json` — hook 配置格式

---

## 开发约定

- 所有脚本使用 `.mjs` 后缀（ESM 模块）
- `import` 使用 `node:` 前缀（如 `import fs from 'node:fs'`）
- 不引入任何 npm 包
- hook 脚本唯一的外部命令调用：`spawnSync('curl', [...])`
- 文件写入时设置权限 `0o600`（数据目录 `0o700`）
- 所有 JSON 解析加 try/catch，解析失败时安全退出而非崩溃
- `shouldSkip()` 必须在任何 I/O 操作之前执行（保持快速路径）
