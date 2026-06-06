# MVP 范围与实现路线图

版本：v0.2

---

## 1. MVP 核心原则

MVP（v0.1）的目标是**打通一个完整的最小闭环**，验证：
1. 插件能被 Claude Code 正确加载
2. UserPromptSubmit hook 能触发并注入 additionalContext
3. 外部 API 调用正常工作（含超时和 fallback）
4. JSONL 数据存储可靠
5. 基础命令可用

**不追求**：学习功能完整性、多语言支持、复杂分析——这些是 v0.2+ 的内容。

---

## 2. MVP 功能列表（v0.1）

### 必须实现

| # | 功能 | 说明 |
|---|------|------|
| 1 | 插件骨架 | `.claude-plugin/plugin.json`，能被 Claude Code 加载 |
| 2 | hooks/hooks.json | UserPromptSubmit + SessionEnd 配置 |
| 3 | 语言检测 | 本地 ASCII 比率算法，无 API 调用 |
| 4 | 跳过逻辑 | slash 命令、过短、代码块等跳过 |
| 5 | 同步 Prompt 优化 | 调用外部 API，json 输出，超时 8s |
| 6 | Fallback 机制 | API 失败时发送原始 prompt + systemMessage 提示 |
| 7 | 熔断器 | 连续 3 次失败后暂停 API 调用 |
| 8 | additionalContext 注入 | 结构化 CANONICAL REQUEST 指令 |
| 9 | systemMessage 展示 | 终端显示优化摘要（compact mode）|
| 10 | JSONL 存储 | 每次 turn 写入按日期分片的 JSONL |
| 11 | SessionEnd hook | 输出会话统计到 stderr |
| 12 | `/my-lingo:setup` | 首次配置向导，验证 API 连通性 |
| 13 | `/my-lingo:status` | 显示配置 + 今日统计 |
| 14 | `/my-lingo:last` | 显示上一次 original → execution_prompt |
| 15 | `/my-lingo:mode` | 查看/切换执行模式 |
| 16 | 基础脱敏 | API key、密码、用户名路径 |
| 17 | 单语言空间 | 默认 English，配置写入 spaces.json |

### 暂不实现（推迟到 v0.2+）

| 功能 | 理由 |
|------|------|
| 多语言空间切换 | 增加配置复杂度，v0.1 验证单空间先 |
| 异步学习文本生成 | 依赖 SessionEnd 批量分析，v0.2 实现 |
| 错误分析（`/my-lingo:errors`）| 需要 AI prompt 工程设计完善后 |
| 课程生成（`/my-lingo:lesson`）| 需要 learning items 积累 |
| 用户画像（`/my-lingo:profile`）| 需要足够历史数据 |
| SRS 复习系统 | v0.3 |
| Wrapper 模式 | v1.0 |

---

## 3. 实现路线图

### 阶段 0：插件骨架（Phase 0）

**目标**：能被 Claude Code 加载，hook 能触发，JSONL 能写入。

**任务**：
1. 创建 `plugin.json`
2. 创建 `hooks/hooks.json`（UserPromptSubmit + SessionEnd）
3. 创建 `scripts/user-prompt-submit.mjs`（只做 stdin 读取 + 固定 stdout 输出）
4. 创建 `scripts/session-end.mjs`（只做 stderr 输出）
5. 创建 `scripts/lib/storage.mjs`（writeTurn 写 JSONL）
6. 创建 `commands/my-lingo/status.md`（读 JSONL 统计）

**验收标准**：
- 安装插件后 `/my-lingo:status` 能显示（哪怕数据为空）
- 用户输入任意 prompt 后，`turns/YYYY-MM-DD.jsonl` 有新记录
- SessionEnd 后 stderr 显示会话统计

---

### 阶段 1：语言检测与跳过逻辑

**目标**：hook 能正确识别需要处理和跳过的 prompt。

**任务**：
1. 实现 `scripts/lib/detect.mjs`（ASCII 比率检测 + shouldSkip）
2. 集成到 `user-prompt-submit.mjs`
3. 添加特殊前缀处理（`::` 和 `!raw`）

**验收标准**：
- slash 命令不触发 hook
- 中文 prompt 被检测为 `non-english`
- 英文 prompt 被检测为 `english`
- 混合 prompt 被检测为 `mixed`
- 纯代码块、URL 被跳过

---

### 阶段 2：外部 API 集成

**目标**：调用外部 API 生成 execution_prompt，注入 Claude。

**任务**：
1. 实现 `scripts/lib/api.mjs`（curl 调用 + JSON 解析）
2. 实现 `scripts/lib/prompts.mjs`（Prompt 构建）
3. 实现熔断器逻辑（circuit.json 读写）
4. 实现 fallback 流程
5. 实现 `additionalContext` + `systemMessage` 构建

**验收标准**：
- 中文 prompt 能生成英文执行 Prompt
- API 超时时走 fallback，systemMessage 提示用户
- turns JSONL 记录包含 `execution_prompt` 字段
- 连续 3 次失败后不再调用 API

---

### 阶段 3：配置系统

**目标**：完整的配置加载和 `/my-lingo:setup` 命令。

**任务**：
1. 实现 `scripts/lib/config.mjs`（config.json + spaces.json 读取）
2. 实现 4 层配置合并（项目级 → 语言空间 → 全局 → 默认）
3. 实现 `commands/my-lingo/setup.md`
4. 实现 `commands/my-lingo/mode.md`

**验收标准**：
- `/my-lingo:setup` 能引导用户配置 API
- `/my-lingo:mode raw` 能切换到 original 模式
- 项目级 `.claude-my-lingo.json` 能覆盖全局配置

---

### 阶段 4：脱敏与安全（可与阶段 2/3 并行）

**任务**：
1. 实现 `scripts/lib/privacy.mjs`（REDACTION_RULES）
2. 集成到 API 调用前
3. 文件权限设置（0o600）

**验收标准**：
- 包含 `sk-xxx` 的 prompt 在发给 API 时被脱敏
- 本地 JSONL 存原始内容（standard 模式）
- strict 模式下本地也脱敏

---

### 阶段 5：完善命令（v0.1 收尾）

**任务**：
1. 完善 `commands/my-lingo/status.md`（含今日统计）
2. 实现 `commands/my-lingo/last.md`
3. 添加单元测试（detect、privacy、config、storage）

**验收标准**：
- `/my-lingo:status` 显示正确的今日统计数字
- `/my-lingo:last` 显示上一条记录的 original 和 execution_prompt
- 所有单元测试通过

---

### v0.2 里程碑：学习功能

**新增功能**：
- 多语言空间（`/my-lingo:spaces`、`/my-lingo:use`）
- SessionEnd 批量分析（写入 corrections JSONL）
- `/my-lingo:errors`（常见错误报告）
- `/my-lingo:recent`
- `/my-lingo:purge`

**验收标准**：
- 切换语言空间后，新 turns 记录到正确的空间
- 会话结束后 corrections JSONL 有新记录
- `/my-lingo:errors` 显示最近 30 天高频错误

---

### v0.3 里程碑：课程与画像

**新增功能**：
- `/my-lingo:lesson`（deep model 按需课程）
- `/my-lingo:vocab`、`/my-lingo:sentences`
- `/my-lingo:profile`
- 简化 SRS（`next_review` 字段）
- `/my-lingo:review`

---

### v1.0 里程碑：SQLite 与 Wrapper

**新增功能**：
- SQLite 迁移（从 JSONL 迁移）
- Wrapper 模式（`my-lingo claude` / `mlingo`）
- 完整导出（`/my-lingo:export`）

---

## 4. 风险与应对

### R1：Hook 注入效果不理想

**风险**：Claude 同时看到原始语言和英文版，仍然以原始语言回应。

**症状**：用户反馈 Claude 用中文回答了英文优化版本描述的任务。

**应对**：
1. 调整 additionalContext 指令强度（测试不同措辞）
2. 添加 `preview` 模式让用户验证
3. 长期方案：Wrapper 模式（v1.0）

---

### R2：API 延迟过高

**风险**：Fast Model 平均响应时间超过 3s，用户感知明显延迟。

**症状**：用户每次输入后等待 3-8 秒才开始看到 Claude 响应。

**应对**：
1. 切换到更快的模型（DeepSeek V3 比 GPT-4o-mini 快）
2. 降低 max_tokens（从 512 降到 256）
3. 缩短 System Prompt
4. 允许用户临时切换到 `raw` 模式

---

### R3：Prompt 被过度改写

**风险**：API 改变了用户的原意（如把"分析"变成"实现"）。

**症状**：Claude 执行了用户不想做的操作。

**应对**：
1. 严格的 System Prompt 规则（"Do not change the user's intent" 必须放在首位）
2. `preview` 模式让用户先看再确认
3. `/my-lingo:last` 让用户事后核查
4. 支持 `!raw` 前缀跳过本次优化

---

### R4：API Key 暴露

**风险**：API key 意外被存储在日志或提交到 git。

**应对**：
1. API key 只从环境变量或 Claude Code userConfig 读取
2. `.gitignore` 排除所有可能包含 key 的文件
3. 脱敏规则覆盖常见 API key 格式
4. `plugin.json` 中 `"sensitive": true` 标记

---

## 5. 验收测试清单（v0.1 发布前）

### 功能测试

- [ ] 安装插件，`/my-lingo:setup` 成功配置 API
- [ ] 输入中文 prompt，`systemMessage` 显示优化结果
- [ ] 输入英文 prompt（有语法错误），`systemMessage` 显示纠正
- [ ] 输入 slash 命令，hook 跳过，无 systemMessage
- [ ] API 超时（配置错误的 URL），走 fallback，systemMessage 提示
- [ ] `/my-lingo:status` 显示正确的今日统计
- [ ] `/my-lingo:last` 显示上一条记录
- [ ] `/my-lingo:mode raw` 切换到 original 模式
- [ ] 会话结束后 stderr 显示会话统计
- [ ] turns JSONL 文件正确创建并追加记录

### 边界测试

- [ ] 极短 prompt（3字）→ 跳过
- [ ] 纯代码块 prompt → 跳过
- [ ] 包含 API key 的 prompt → 发给 API 时被脱敏
- [ ] API 连续失败 → 熔断器触发，后续请求走 fallback
- [ ] 冷却期后熔断器自动恢复

### 性能测试

- [ ] Fast model 平均响应时间 < 3s（使用 DeepSeek V3 或 GPT-4o-mini）
- [ ] hook 进程在 8s 内必定退出（即使 API 挂起）
