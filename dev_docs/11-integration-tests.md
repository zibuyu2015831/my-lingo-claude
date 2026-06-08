# 集成测试说明

版本：v0.3

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
# 单元测试（182 个）
npm test

# 集成测试（11 个）
npm run test:integration

# 全量运行
npm test && npm run test:integration
```

**前置条件**：Node.js ≥ 18（使用内置 `node:test`、`node:http`），无需安装任何 npm 包。

---

## 3. 文件结构

```
tests/
├── integration/
│   ├── mock-server.mjs      # 本地 HTTP mock server（success / authError / markdown 三种模式）
│   ├── helpers.mjs          # 临时目录、config 写入、hook 调用封装
│   └── integration.test.mjs # 11 个集成测试用例（PT-001 ~ PT-012）
├── detect.test.mjs
├── config.test.mjs
├── storage.test.mjs
├── privacy.test.mjs
├── prompts.test.mjs
├── srs.test.mjs
└── lesson.test.mjs
```

---

## 4. 各用例说明

### PT-004 — `--` 前缀跳过优化

- **场景**：prompt 以 `--` 开头
- **不需要 mock server**：hook 在读取 config 后立即返回，从不调用 API
- **验证**：`systemMessage` 含 `[my-lingo] --:`，无 `additionalContext`，turn 写入 `mode: "raw"`

### PT-002 — 熔断器开启

- **场景**：API 端点不可达（指向 `http://127.0.0.1:1`，立即 connection refused）
- **不需要 mock server**：curl 因 connection refused 立即退出
- **验证**：
  - 第 1 次调用 → `systemMessage` 含 `API unavailable`，`circuit.json` 创建，`failure_count=1`
  - 第 2 次调用 → `systemMessage` 含 `Circuit breaker open`（熔断器已开启，不再调用 API）

> **注意**：熔断器在第 **1 次失败后**即对后续请求开启（5 分钟冷却期内），并非等待 3 次失败。`PENDING_TESTS.md` 中原先描述的"3次失败后开启"是对实现的误判，已在此修正。

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

### PT-007 — `/my-lingo:setup` 首次配置

**原因**：`setup.md` 是 Claude Code markdown workflow 命令，依赖交互式 Claude Code 会话，无法在独立进程中驱动。

**手动步骤**：
1. 在 Claude Code 会话中运行 `/my-lingo:setup`
2. 按提示输入 API Base URL 和 Key
3. 验证：
   ```bash
   stat -c %a $CLAUDE_PLUGIN_DATA/my-lingo/config.json  # 应输出 600
   ```

### PT-013 — `/my-lingo:lesson` 交互式课程生成

**原因**：调用 deep model，依赖真实 API + 交互式 Claude Code 会话。

### PT-014 — `/my-lingo:review` SRS 复习流程

**原因**：需要用户交互（查看提示、输入答案），无法自动化。

### PT-015 — `/my-lingo:export` 导出格式验证

**原因**：依赖真实存储数据，需在有记录的会话环境中手动验证输出格式。

---

## 8. 已知行为与 PENDING_TESTS.md 的差异

`PENDING_TESTS.md` 中 PT-002 的原始描述："Attempts 1–3 return API unavailable; attempt 4 returns Circuit breaker open"。

**实际行为**（由集成测试验证）：
- 第 1 次失败 → `API unavailable`，写入 `circuit.json`
- 第 2 次及之后（5 分钟内）→ `Circuit breaker open`（circuit 已开启，跳过 API）

原因：`checkCircuitBreaker()` 仅检查 `last_failure_at` 是否在冷却期内，不检查 `failure_count` 是否达到阈值。
