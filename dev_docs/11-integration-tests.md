# 集成测试说明

版本：v0.6

---

## 1. 概述

My Lingo 的测试分两层：

| 层次 | 命令 | 场景 |
|------|------|------|
| **单元测试** | `npm test` | 纯逻辑函数，无 I/O（detect / privacy / config / storage / prompts / srs / lesson） |
| **集成测试** | `npm run test:integration` | hook 脚本端到端行为，含 API 调用路径 |

集成测试**无需**真实 API Key。需要 API 的场景由本地 mock HTTP server（`tests/integration/mock-server.mjs`）替代，mock server 使用 OS 随机分配端口，支持并发运行互不干扰。

---

## 2. 运行方式

```bash
# 单元测试（256 个）
npm test

# 集成测试（14 个）
npm run test:integration

# e2e（5 个，默认 skip，需真实 API 时手动启用）
npm run test:e2e

# 全量运行
npm test && npm run test:integration
```

**前置条件**：Node.js ≥ 22.13（`storage.mjs` 依赖 `node:sqlite`，该模块自 22.13 起免 flag 可用；测试还用到内置 `node:test`、`node:http`），无需安装任何 npm 包。

---

## 3. 文件结构

```
tests/
├── integration/
│   ├── mock-server.mjs      # 本地 HTTP mock server（success / authError / markdown 三种模式）
│   ├── helpers.mjs          # 临时目录、config 写入、hook 调用封装
│   └── integration.test.mjs # 14 个集成测试用例（PT-001 ~ PT-016，PT-007/014 为手动）
├── e2e/
│   └── e2e.test.mjs         # 5 个端到端用例（默认 skip）
├── analysis.test.mjs
├── api.test.mjs
├── config.test.mjs
├── debug.test.mjs
├── detect.test.mjs
├── lesson.test.mjs
├── paths.test.mjs
├── privacy.test.mjs
├── prompts.test.mjs
├── spaces.test.mjs
├── srs.test.mjs
├── stop.test.mjs
└── storage.test.mjs
```

---

## 4. 各用例说明

### PT-004 — `--` 前缀跳过优化

- **场景**：prompt 以 `--` 开头
- **不需要 mock server**：hook 在读取 config 后立即返回，从不调用 API
- **验证**：`systemMessage` 含 `[my-lingo] --:`，无 `additionalContext`，turn 写入 `mode: "raw"`

### PT-002 — 熔断器在连续 3 次失败后开启（D4）

- **场景**：API 端点不可达（指向 `http://127.0.0.1:1`，立即 connection refused）
- **不需要 mock server**：curl 因 connection refused 立即退出
- **验证**：
  - 第 1~3 次调用 → 每次仍尝试调用 API，`systemMessage` 含按失败类型区分的提示（connection refused → `API unreachable`，超时 → `Timed out`，等），`circuit.json` 的 `failure_count` 依次为 1 / 2 / 3
  - 第 4 次调用 → `systemMessage` 含 `Circuit breaker open`（熔断器已开启，跳过 API 调用）

> **实现**：`checkCircuitBreaker(config)`（`api.mjs:129-147`）在冷却窗内返回 `failure_count >= CIRCUIT_THRESHOLD(3)` 才算开启——**单次瞬时失败只回退发原文、不熔断**。冷却时长读 `config.circuit_breaker_cooldown_minutes`（默认 5 分钟），到期自动删除 `circuit.json` 复位。此语义与 `00-decisions.md` D4 一致（这是 `15-architecture-review-v0.5.md` 的 F4 修复结果）。

### PT-006 — SessionEnd 会话统计

- **场景**：预写 turns JSONL，调用 `session-end.mjs`
- **不需要 mock server**：纯文件读写
- **验证**：stderr 包含 `[my-lingo] Session: 3 prompts | 2 optimized (1 translated, 1 corrected) | 1 --`，stdout 为空

### PT-001 — API 成功路径

- **mock 行为**：返回 `{ execution_prompt_en: "...", rewrite_type: "translate", detected_input_language: "zh-CN" }`
- **验证**：`additionalContext` 以 `CANONICAL REQUEST:` 开头，包含 `execution_prompt_en`；`systemMessage` 包含 `[my-lingo]`

### PT-003 — 熔断器自动重置

- **场景**：预写 `circuit.json`（`last_failure_at: 1000`，即 1970 年，冷却期早已过期）
- **mock 行为**：返回成功响应
- **验证**：`checkCircuitBreaker()` 自动删除过期的 `circuit.json` 并返回 false；API 调用成功后 `circuit.json` 不存在

### PT-005 — `::` refine 路径

- **场景**：prompt 以 `::` 开头
- **mock 行为**：返回 `{ execution_prompt_en: "...", rewrite_type: "refine" }`
- **验证**：`additionalContext` 包含 `:: to request prompt refinement`；`systemMessage` 含 `[my-lingo] Refined:`

### PT-008 — 认证错误警告

- **mock 行为**：返回 `{ error: { type: "authentication_error", ... } }`，HTTP 401
- **验证**：`systemMessage` 包含 `Authentication failed`（由 `drainWarning()` 前置到消息头部）

### PT-009 — SessionEnd 学习分析（含 mock server）

- **场景**：预写含纠错内容的 turns JSONL，mock server 返回分析结果（corrections 数组）
- **mock 行为**：返回 `{ corrections: [...], learning_items: [...] }`（JSON 模式）
- **验证**：`session-end.mjs` 退出 0；`corrections-YYYY-MM.jsonl` 文件创建并包含正确条目

### PT-010 — SessionEnd 跳过纯 raw 会话分析

- **场景**：turns JSONL 中全部为 `mode: "raw"` 的记录
- **不需要 mock server**：分析逻辑在识别到无可分析内容时提前退出
- **验证**：不创建 corrections 文件；不调用 API（无 mock server 需求）

### PT-011 — generate-lesson.mjs 通过 mock server 生成课程文件

- **场景**：`node scripts/generate-lesson.mjs --days 7`，API 返回 Markdown 内容
- **mock 行为**：`makeMarkdownHandler()` 返回原始 Markdown 字符串（非 JSON 编码）
- **验证**：退出 0；`learning/{space}/lessons-YYYY-MM-DD.md` 创建；stdout 包含 `# My Lingo Lesson`

### PT-012 — SRS readItemsDue 按到期时间过滤

- **场景**：预写 3 条学习记录（过期 / null next_review / 未来到期），调用 `readItemsDue`
- **不需要 mock server**：纯文件 + SRS 逻辑
- **验证**：返回过期条目和 null 条目（均到期），不返回未来条目；null 条目排在过期条目之前

### PT-013 — 只读命令从异目录解析模块并渲染数据

- **场景**：在与插件源码无关的 cwd 下运行 data 命令（携带 `CLAUDE_PLUGIN_DATA`），读取预置数据
- **不需要 mock server**：纯文件
- **验证**：命令成功解析 `scripts/lib/*` 模块并渲染 seeded 数据，不因相对 import 崩溃（dev_docs/14 module-resolution 回归护栏）

### PT-015 — 生产形态（env-blind）经 install.json 指针定位

- **场景**：**不注入任何 `CLAUDE_PLUGIN_*` 环境变量**，仅靠 hook 写入的 `install.json` 指针定位数据目录
- **不需要 mock server**：纯文件
- **验证**：data 命令仍能解析 plugin root + data dir 并渲染数据（dev_docs/14 §六-F 指针机制的回归护栏）

### PT-016 — 无指针 + 无环境变量时响亮失败（非静默 0）

- **场景**：plugin root 可解析，但数据目录无法解析（无指针、无 env）
- **不需要 mock server**：纯文件
- **验证**：命令以非零退出 + 可读错误信息失败，而非静默显示"0 turns"（dev_docs/15 F5/D-D 失败响亮哲学）

---

## 5. 测试隔离机制

每个测试用例：
1. 调用 `makeTmpDir()` 创建独立临时目录
2. 将该目录作为 `CLAUDE_PLUGIN_DATA` 传给 hook 子进程
3. 在 `finally` 块中调用 `cleanup(dataDir)` 删除临时目录

异步测试（需要 mock server）使用 `spawn`（异步）而非 `spawnSync`，避免阻塞事件循环导致 mock server 无法响应。

PT-012 使用独立 `spawnSync` 子进程调用 `readItemsDue`，确保 `CLAUDE_PLUGIN_DATA` 环境变量隔离正确。

---

## 6. Mock Server 模式

`tests/integration/mock-server.mjs` 提供三种 handler：

| 函数 | 用途 |
|------|------|
| `makeSuccessHandler(responseJson)` | 将 responseJson 序列化为字符串后包装在 `choices[0].message.content` 中（JSON 模式 API） |
| `makeMarkdownHandler(markdownContent)` | 直接将 Markdown 字符串放入 `choices[0].message.content`（非 JSON 模式，用于 lesson 生成） |
| `makeAuthErrorHandler()` | 返回 HTTP 401 + `authentication_error` 结构（测试认证失败路径）|

---

## 7. 仍需手动验证的测试

> PT-011 已自动覆盖 `generate-lesson.mjs` 的非交互生成路径；`/my-lingo:export` 的核心读路径由 PT-013/PT-015 间接覆盖。下列两项依赖交互式 Claude Code 会话，无法在独立进程中驱动。

### PT-007 — `/my-lingo:setup` 首次配置

**原因**：`setup.md` 是 Claude Code markdown workflow 命令，依赖交互式 Claude Code 会话。

**手动步骤**：
1. 在 Claude Code 会话中运行 `/my-lingo:setup`
2. 凭证改走环境变量后，`setup` 不再收集 Key，只检查 4 个变量状态并做连通性测试（见 `12-env-var-config.md`）
3. 验证 spaces.json 已初始化、连通性测试通过

### PT-014 — `/my-lingo:review` SRS 复习流程

**原因**：需要用户交互（查看提示、输入答案），无法自动化。（SRS 纯函数与 `readItemsDue` 已由 PT-012 + 单元测试覆盖。）

---

## 8. 熔断器语义（与 PENDING_TESTS.md 一致）

`PENDING_TESTS.md` 中 PT-002 的描述："Attempts 1–3 return API unavailable; attempt 4 returns Circuit breaker open"，**与当前实现一致**。

**实际行为**（由集成测试 PT-002 验证）：
- 第 1~3 次失败 → 每次仍调用 API，报按失败类型区分的提示（connection refused → `API unreachable`），`circuit.json` 的 `failure_count` 累加到 3
- 第 4 次（5 分钟冷却窗内）→ `Circuit breaker open`，跳过 API 调用

原因：`checkCircuitBreaker(config)` 在冷却期内返回 `failure_count >= CIRCUIT_THRESHOLD(3)`；冷却到期则删除 `circuit.json` 并复位。

> 历史注记：早期实现一度只看冷却窗、不看阈值（单次失败即熔断），曾被记录为"已知差异"。该缺陷已在 v0.5 架构审查（F4）修复，本节描述为修复后的现状。
