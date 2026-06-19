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
| 存储方案 | **SQLite**（v0.5 起，`node:sqlite`，单库 `data.db`，WAL），路径 `$CLAUDE_PLUGIN_DATA/my-lingo/`；配置仍为 JSON。**需 Node ≥ 22.13**（`node:sqlite` 免 flag 起点）|
| API 调用 | **`spawnSync('curl', [...])`**，不能用 `claude` CLI（会死锁）|
| 语言检测 | **本地 ASCII 比率算法**，无 API 调用，< 1ms |
| Hook 系统 | **UserPromptSubmit**（同步；API 调用 8s 超时，hook 配置超时 60s）+ **Stop**（回复捕获）+ **SessionEnd**（批量分析）+ **SessionStart**（v0.6 补偿触发）|
| 命令格式 | `commands/my-lingo/*.md`（markdown workflow + YAML frontmatter）|
| 当前阶段 | **v0.6（版本号 0.6.0）**：v0.5 SQLite + 架构审查修复（[`15`](./15-architecture-review-v0.5.md)）+ v0.6 Phase 1（SessionStart 补偿触发）已落地；v0.6 Phase 2（阈值兜底）待实施。**256 单元 + 14 集成测试通过（另有 5 个 e2e 默认 skip）** |

---

## 目录结构（实现完成后）

```
my-lingo-claude/
├── .claude-plugin/
│   └── plugin.json              # 插件元数据，声明 userConfig
├── commands/
│   └── my-lingo/
│       ├── setup.md             # /my-lingo:setup
│       ├── info.md              # /my-lingo:info
│       ├── last.md              # /my-lingo:last
│       ├── mode.md              # /my-lingo:mode
│       ├── use.md               # /my-lingo:use（切换语言空间）
│       ├── addspace.md          # /my-lingo:addspace（创建并切换到新语言空间）
│       ├── rmspace.md           # /my-lingo:rmspace（删除语言空间）
│       ├── space.md             # /my-lingo:space（查看当前空间配置）
│       ├── spaces.md            # /my-lingo:spaces（列出所有语言空间）
│       ├── recent.md            # /my-lingo:recent（近期纠错）
│       ├── errors.md            # /my-lingo:errors（错误摘要）
│       ├── purge.md             # /my-lingo:purge（清除旧数据）
│       ├── vocab.md             # /my-lingo:vocab（词汇表）
│       ├── sentences.md         # /my-lingo:sentences（句式表）
│       ├── review.md            # /my-lingo:review（SRS 复习）
│       ├── lesson.md            # /my-lingo:lesson（AI 课程生成）
│       ├── profile.md           # /my-lingo:profile（学习画像）
│       └── export.md            # /my-lingo:export（导出 Markdown）
├── hooks/
│   └── hooks.json               # UserPromptSubmit + SessionEnd 配置
├── scripts/
│   ├── user-prompt-submit.mjs   # UserPromptSubmit hook 主入口
│   ├── stop.mjs                 # Stop hook：每轮结束后捕获 Claude 回复
│   ├── session-end.mjs          # SessionEnd hook：批量学习分析（含 analysis.lock 互斥）
│   ├── session-start.mjs        # SessionStart hook（v0.6）：补偿触发历史积压分析
│   ├── generate-lesson.mjs      # 课程生成脚本（被 lesson.md 调用）
│   ├── validate-manifests.mjs   # CI 用：校验 plugin/marketplace/package 元数据一致性
│   └── lib/
│       ├── detect.mjs           # 语言检测（二分类 en/non-english）+ 跳过逻辑
│       ├── config.mjs           # 5 层配置合并（Layer 0 凭证 … Layer 4 默认）
│       ├── paths.mjs            # getDataDir() + install.json 指针（解 storage↔db 循环依赖）
│       ├── db.mjs               # SQLite 连接单例 getDb()/resetDb()（WAL + initSchema）
│       ├── storage.mjs          # SQLite 读写工具（含 SRS + 幂等扩展）
│       ├── api.mjs              # curl 调用（callFastModel）+ 熔断器
│       ├── prompts.mjs          # Prompt 构建
│       ├── privacy.mjs          # 脱敏处理（redact / redactMessages 出站边界）
│       ├── analysis.mjs         # SessionEnd 学习分析（callDeepModel）
│       ├── srs.mjs              # SRS 纯函数（computeNextReview / getItemsDue）
│       ├── lesson.mjs           # 课程纯函数（buildLessonMessages / parseLessonResponse）
│       └── debug.mjs            # MY_LINGO_DEBUG 调试日志（写前脱敏 + 轮转）
├── tests/
│   ├── *.test.mjs               # 单元测试（analysis/api/config/debug/detect/lesson/
│   │                            #   paths/privacy/prompts/spaces/srs/stop/storage），共 256 个
│   ├── integration/
│   │   ├── mock-server.mjs      # 本地 HTTP mock server
│   │   ├── helpers.mjs          # 临时目录、配置写入封装
│   │   └── integration.test.mjs # 14 个集成测试用例（PT-001 ~ PT-016，PT-007/014 为手动）
│   └── e2e/
│       └── e2e.test.mjs         # 5 个端到端用例（默认 skip）
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
| 实现或修改 `storage.mjs`、SQLite 读写、配置文件格式 | [`07-storage.md`](./07-storage.md) |
| 实现或修改 `plugin.json`、目录结构、`package.json` | [`08-plugin-structure.md`](./08-plugin-structure.md) |
| 实现或修改 `privacy.mjs`、脱敏规则、安全设计 | [`09-privacy-security.md`](./09-privacy-security.md) |
| 了解 MVP 范围、实现阶段划分、风险登记、验收清单 | [`10-mvp-roadmap.md`](./10-mvp-roadmap.md) |
| 查询某个关键架构决策的背景和理由 | [`00-decisions.md`](./00-decisions.md) |
| 运行集成测试、了解各用例原理、查看与 PENDING_TESTS.md 的差异 | [`11-integration-tests.md`](./11-integration-tests.md) |
| 回溯 v0.5 架构审查的发现（F1–F12）、更优方案（D-A–D-G）与修复落地状态 | [`15-architecture-review-v0.5.md`](./15-architecture-review-v0.5.md) |
| 查看 v0.1 实现计划（MVP 完整阶段）| [`./development/IMPLEMENTATION_PLAN_V0.1.md`](./development/IMPLEMENTATION_PLAN_V0.1.md) |
| 查看 v0.2 实现计划（多语言空间 + SessionEnd 学习分析 + 学习命令）| [`./development/IMPLEMENTATION_PLAN_V0.2.md`](./development/IMPLEMENTATION_PLAN_V0.2.md) |
| 查看 v0.3 实现计划（SRS 复习 + 课程生成 + 画像 + 导出）| [`./development/IMPLEMENTATION_PLAN_V0.3.md`](./development/IMPLEMENTATION_PLAN_V0.3.md) |
| 查看 v0.5 实现计划（SQLite 存储迁移）| [`./development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md`](./development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md) |
| 查看 v0.6 实现计划（分析触发保障机制）| [`./development/IMPLEMENTATION_PLAN_V0.6_ANALYSIS_TRIGGER.md`](./development/IMPLEMENTATION_PLAN_V0.6_ANALYSIS_TRIGGER.md) |

---

## 核心工作流（必须理解）

### UserPromptSubmit Hook 路径（同步，最关键）

```
用户按 Enter
  → hook 进程启动（node scripts/user-prompt-submit.mjs）→ writeInstallPointer()
  → 读取 stdin JSON：{ prompt, cwd, session_id }
  → 前缀分流（在 shouldSkip 之前）：
      ├─ '--' 前缀 → 跳过优化，写 turn(mode:'raw')，emit 提示，退出
      └─ '::' 前缀 → 标记 isRefine（绕过 shouldSkip，使 ":: fix" 等短命令可用）
  → shouldSkip()（非 refine 时）：slash命令 '/' / 过短 / 纯代码块 / URL·shell前缀 → 退出
      （注：'!' 由 Claude Code 在更上层拦截为终端命令，根本不进 hook；shouldSkip 不含 '!' 规则）
  → loadConfig()：读取 config.json + spaces.json（5 层合并，Layer 0 凭证来自 env）
  → execution_mode === 'off' → 退出
  → max_prompt_length 守卫（超长 → 写 turn(fallback,'too_long')，退出）
  → execution_mode === 'original' → 只写 turn 记录（DB），退出
  → '::' refine 路径：callFastModel(refine) → 注入“refined intent”
  → detectLanguage()：ASCII 比率算法（本地 < 1ms，二分类 en / non-english）
  → checkCircuitBreaker()：连续 3 次失败且冷却窗内 → fallback，退出
  → callFastModel()：curl 调用，超时 8s（脱敏在 callFastModel 内的出站边界完成）
      ├─ 成功 → recordApiSuccess()，写 turn 记录（DB），emit { additionalContext, systemMessage }
      └─ 失败 → recordApiFailure()，写 turn（fallback:true），按 fallback_policy emit 提示
  → hook 进程退出
  → Claude Code 读取输出，注入 additionalContext，Claude 处理 prompt
```

### additionalContext 注入格式（D1 决策）

```
CANONICAL REQUEST: The user's message is in {lang}. They have configured
My Lingo to optimize prompts to English. Treat the following as their actual
request. Disregard only the text language of their original message — still
process any attached images, files, or other non-text content:

{execution_prompt_en}
```

> 之后可能追加（取决于配置）：`summary_language_mode='native'` 时的母语摘要指令、
> `response_language_mode='target'` 时的目标语言回复指令（见 `02-core-concepts.md` §6–7）。

### Stop Hook 路径（每轮结束，捕获 Claude 回复）

```
Claude 完成一轮回复
  → hook 进程启动（node scripts/stop.mjs）
  → 读取 ~/.claude/projects/<hash>/<session-id>.jsonl 尾部（64KB）
  → 提取最新 assistant text（按 sessionId 过滤）
  → 有结果 → 写 responses 记录（DB）
  → 无结果（竞态或首轮）→ 静默退出
  → 进程退出（< 200ms，不做 API 调用）
```

### SessionEnd Hook 路径

```
Claude 会话结束
  → hook 进程启动（node scripts/session-end.mjs）
  → readUnanalyzedTurns(session_id)：只取本会话未处理的 turns（analyzed=0）
  → 空 → 直接退出（崩溃重跑 / 双次运行均为幂等空操作）
  → 读取本 session 的 responses（跨日期）
  → 统计：总数 / 优化数 / 翻译数 / 纠错数 / fallback 数
  → stderr 输出统计摘要（终端可见）
  → （v0.2+）调用 deep model 分析（含 Claude 回复上下文，置于事务外）
  → 单事务：写 corrections/items/sessions + markTurnsAnalyzed(ids) 原子提交
  → 进程退出
```

---

## 关键技术决策速查（来自 00-decisions.md）

| 决策 | 结论 | 详情 |
|------|------|------|
| D1 Hook 注入 | `additionalContext` 用结构化 CANONICAL REQUEST 指令 | [00-decisions.md#D1](./00-decisions.md) |
| D2 进程模型 | 无 daemon，用 SessionEnd 替代异步 worker | [00-decisions.md#D2](./00-decisions.md) |
| D3 存储 | v0.1–v0.4 JSONL；**v0.5 起 SQLite（`node:sqlite`，WAL，单库 `data.db`）** | [00-decisions.md#D3](./00-decisions.md) |
| D4 超时/熔断 | 8s 超时 + 连续 3 次失败触发熔断（circuit.json） | [00-decisions.md#D4](./00-decisions.md) |
| D5 语言检测 | 本地 ASCII 比率二分类：≥85% → `en`，否则 `non-english`（无 mixed 态） | [00-decisions.md#D5](./00-decisions.md) |
| D6 跳过逻辑 | `/` 前缀、`< 8 字符且 < 3 词`、纯代码块、URL/shell 前缀（`!` 由 Claude Code 上层拦截，不在 shouldSkip 内）；`--`/`::` 在 shouldSkip 前分流 | [00-decisions.md#D6](./00-decisions.md) |
| D7 API 调用 | `spawnSync('curl', [...])` —— 不能用 `claude` CLI（死锁）| [00-decisions.md#D7](./00-decisions.md) |
| D8 学习系统 | SessionEnd 生成摘要（MVP），SRS 在 v0.3 | [00-decisions.md#D8](./00-decisions.md) |
| D14 Claude 回复捕获 | Stop hook + transcript 读取，responses/ 缓存，竞态静默处理 | [00-decisions.md#D14](./00-decisions.md) |
| D9 实现语言 | Node.js ESM，零 npm 依赖 | [00-decisions.md#D9](./00-decisions.md) |
| D10 脱敏 | 覆盖 API key、DB 密码、用户名路径、私有 IP、AWS key | [00-decisions.md#D10](./00-decisions.md) |
| D11 命令格式 | `commands/my-lingo/*.md`（不用旧版 `skills/SKILL.md`）| [00-decisions.md#D11](./00-decisions.md) |
| D12 MVP 范围 | 10 项核心功能，单语言空间（English），多语言 v0.2 | [00-decisions.md#D12](./00-decisions.md) |
| D15 分析触发保障 | SessionStart hook（主）+ UserPromptSubmit 阈值兜底（副），解决 daemon 模式下 SessionEnd 不触发问题 | [00-decisions.md#D15](./00-decisions.md) |

---

## 实现状态（v0.6 进行中）

当前状态：**v0.5 已完成（SQLite 存储迁移）+ 架构审查修复轮（2026-06-11，[`15-architecture-review-v0.5.md`](./15-architecture-review-v0.5.md)）；v0.6 Phase 1（SessionStart 补偿触发 + analysis.lock）已落地（版本号 0.6.0）。256 单元 + 14 集成测试通过。v0.6 Phase 2（UserPromptSubmit 阈值兜底）及 Phase 1 配套测试（PT-014 / session-start 单测）待补。**

### v0.1 实现阶段（MVP）

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | 插件骨架：`plugin.json` + `hooks/hooks.json` + hook 桩 + `storage.mjs` + `status.md`（v0.5 重命名为 `info.md`） | ✅ 已完成 |
| Phase 1 | `detect.mjs`（语言检测 + 跳过逻辑） | ✅ 已完成 |
| Phase 2 | `api.mjs`（curl 调用 + 熔断器）+ `prompts.mjs` + `additionalContext`/`systemMessage` 注入 | ✅ 已完成 |
| Phase 3 | `config.mjs`（4 层配置合并）+ `setup.md` + `mode.md` | ✅ 已完成 |
| Phase 4 | `privacy.mjs`（脱敏规则） | ✅ 已完成 |
| Phase 5 | 完善 `status.md` + `last.md` + 单元测试 + `session-end.mjs` | ✅ 已完成 |

### v0.2 实现阶段（多语言空间 + 学习分析）

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | `config.mjs` 语言空间支持 + `setlang.md` + `addSpace/removeSpace` 命令 | ✅ 已完成 |
| Phase 2 | `analysis.mjs` SessionEnd 学习分析 + `storage.mjs` corrections/items 扩展（PT-009/PT-010） | ✅ 已完成 |
| Phase 3 | 学习命令：`recent.md` / `errors.md` / `purge.md` | ✅ 已完成 |

### v0.3 实现阶段（SRS + 课程生成 + 画像 + 导出）

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | `srs.mjs` 纯函数 + `storage.mjs` SRS 扩展 + `vocab.md` / `sentences.md` / `review.md` | ✅ 已完成 |
| Phase 2 | `lesson.mjs` 纯函数 + `generate-lesson.mjs` + `lesson.md` + PT-011/PT-012 集成测试 | ✅ 已完成 |
| Phase 3 | `profile.md` 学习画像（30 天统计 + 趋势 + 错误模式）| ✅ 已完成 |
| Phase 4 | `export.md` Markdown 导出（按 space / 月份范围）| ✅ 已完成 |

### v0.4 实现阶段（Stop hook + Claude 回复捕获）

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | `stop.mjs`（transcript 尾读 + 提取 assistant text）+ `responses` 存储 + SessionEnd 引入回复上下文 | ✅ 已完成 |

### v0.5 实现阶段（SQLite 存储迁移）

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | `package.json` `engines.node>=22.13.0`（`node:sqlite` 免 flag 起点）| ✅ 已完成 |
| Phase 1 | `paths.mjs` + `db.mjs`（WAL/单例/initSchema）+ `storage.mjs` 全面 SQL 化 + `srs.computeIntervalDays` + 测试重写 | ✅ 已完成 |
| Phase 2 | `session-end.mjs` 幂等单事务 + `review.md`（按 id）+ `purge.md`（操作 DB）+ 集成测试 DB 化 | ✅ 已完成 |
| Phase 2.5 | 只读命令 SQLite 化（`status`/`recent`/`last`/`errors`/`space`/`spaces` 由内联 JSONL 读改为 import `storage.mjs`）+ `countTurnsForSpace`/`countCorrectionsForSpace` + 单元测试 | ✅ 已完成 |
| Phase 3 | 文档更新（`00-decisions.md` D3 / `07-storage.md` / `INDEX.md`）| ✅ 已完成 |

### v0.6 实现阶段（分析触发保障机制）

> 详细设计见 [`./development/IMPLEMENTATION_PLAN_V0.6_ANALYSIS_TRIGGER.md`](./development/IMPLEMENTATION_PLAN_V0.6_ANALYSIS_TRIGGER.md)

**背景**：生产诊断发现 Claude Code daemon 长期运行时 SessionEnd 不触发，导致学习数据永远积压（44 turns、10 sessions、analyzed=0）。

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | 新增 `scripts/session-start.mjs` + `hooks/hooks.json` SessionStart 条目 + `session-end.mjs` 的 `analysis.lock` 写/清 | ✅ 已落地（配套 PT-014 / session-start 单测**待补**） |
| Phase 2 | `config.mjs` 新增阈值配置项 + `user-prompt-submit.mjs` 阈值兜底触发 + 补充测试 | ⬜ 待实施 |

### MVP 必须实现的功能（10 项）

1. 插件骨架（`plugin.json`、`hooks/hooks.json`、Node.js hook 脚本）
2. 语言检测（本地 ASCII 比率算法）
3. 同步 Prompt 优化（调用外部 API，超时 8s，fallback）
4. JSONL 存储（turns 按日期分片写入）
5. `additionalContext` + `systemMessage` 注入（结构化指令）
6. `/my-lingo:info`（配置和今日统计）
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
├── analysis.lock                # 分析进程互斥锁（v0.6+，内含 PID，5 分钟超时）
├── debug.log                    # MY_LINGO_DEBUG=1 时的调试日志（写前脱敏 + 1MB 轮转）
├── learning/<space>/            # /my-lingo:lesson 生成的课程：lessons-YYYY-MM-DD.md
└── data.db                      # SQLite 单库（WAL）：turns / responses /
                                 #   corrections / learning_items / sessions 五张表
                                 #   （运行时伴随 data.db-wal / data.db-shm）
```

> 另：env-blind slash 命令的定位指针写在固定路径
> `~/.claude/plugins/data/my-lingo/install.json`（由 hook 的 `writeInstallPointer()` 维护，见 dev_docs/14）。

> v0.5 起所有记录统一存入 `data.db`；配置仍为 JSON 文件。读写经 `scripts/lib/storage.mjs` →
> `scripts/lib/db.mjs`（`getDb()` 单例 + WAL）。

**注意**：`api_key` 不存储在任何文件中。凭证按优先级解析：**plugin.json userConfig（Claude Code 注入为 `CLAUDE_PLUGIN_OPTION_*` 环境变量）优先，`MY_LINGO_*` 环境变量兜底**（见 `config.mjs` Layer 0 / `credValue()`）。

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
