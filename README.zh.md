# My Lingo

> 一个 Claude Code 插件，实时将你的 Prompt 优化为英文，并把日常编程对话沉淀为个性化的语言学习材料。

[English](./README.md)

---

## 背景

母语非英文的开发者在使用 Claude Code 时，同时面对两个摩擦点：

1. **Prompt 质量** — 用中文（或日文、韩文等）描述技术需求，往往不如结构清晰的英文 Prompt 更容易让 Claude 准确理解。
2. **语言学习** — 你最需要的技术英语，恰恰就藏在真实的编程对话里，而不是在教材课本中。

My Lingo 同时解决这两件事。

它拦截你提交的每一条 Prompt，通过外部 LLM API 将其改写为结构化英文，再将结果透明地注入给 Claude。

你的原始消息永远不会被阻断——如果 API 不可用，Prompt 原样发出。每次会话结束后，My Lingo 自动分析改写记录，提取纠错和词汇，从真实交互中建立个人语言学习库。

**优化示例：**

| 你的输入 | 普通翻译 | My Lingo 优化后 |
|---------|---------|----------------|
| 检查这个项目有没有架构问题，先不要修改代码。 | Check whether this project has architecture problems. Do not modify the code first. | Review this project for potential architectural issues. Do not modify any files yet. First provide a structured analysis covering module boundaries, data flow, maintainability, scalability, and potential risks. |

---

## 功能

### Prompt 优化（对每条 Prompt 自动运行）

- 翻译并结构化改善非英文 Prompt
- 纠正不自然或语法错误的英文
- 纯英文、代码块、命令行、URL 原样保留，不做处理
- API 不可用时静默 fallback（内置熔断器）
- 输入前缀 `--` → 本条跳过优化
- 输入前缀 `::` → refine 模式：将当前输入视为粗糙想法，精炼后发出

### 学习命令

| 命令 | 作用 |
|------|------|
| `/my-lingo:setup` | 检查环境变量状态并验证 API 连通性 |
| `/my-lingo:info` | 查看当前配置、活跃语言空间、今日统计 |
| `/my-lingo:last` | 显示上一条 Prompt 的原文 → 优化版对比 |
| `/my-lingo:mode` | 切换执行模式（optimized / raw / off / …） |
| `/my-lingo:space` | 查看当前语言空间的配置和学习统计 |
| `/my-lingo:spaces` | 列出所有已配置的语言空间及统计信息 |
| `/my-lingo:use` | 切换活跃语言空间 |
| `/my-lingo:addspace` | 创建新的语言空间并切换过去 |
| `/my-lingo:rmspace` | 删除某个语言空间（默认的 `english` 空间不可删除） |
| `/my-lingo:vocab` | 从近期交互中提取的高频词汇 |
| `/my-lingo:sentences` | 近期交互中出现的句式模式 |
| `/my-lingo:errors` | 你最常犯的英文错误类型 |
| `/my-lingo:recent` | 近期纠错记录及解释 |
| `/my-lingo:review` | SRS 间隔复习：抽认卡形式复习学习材料 |
| `/my-lingo:lesson` | 根据近期会话生成 AI 个性化课程 |
| `/my-lingo:profile` | 30 天学习画像：趋势、错误模式、SRS 统计 |
| `/my-lingo:export` | 将全部学习材料导出为 Markdown |
| `/my-lingo:purge` | 删除旧数据文件 |

---

## 环境要求

- **Claude Code**（需支持插件功能）
- **Node.js ≥ 22.13.0**（使用内置 `node:sqlite` 等模块，无需任何 npm 包；`node:sqlite` 从 22.13.0 起才无需 flag）
- **`curl`** 在系统 PATH 中可用
- 一个 **OpenAI 兼容的 API Key** — 任意服务商均可：OpenAI、DeepSeek、Groq、本地 Ollama 等

---

## 安装

### 方式 A —— 从插件市场安装（推荐）

在任意 Claude Code 会话中，执行这两条斜杠命令：

```
/plugin marketplace add zibuyu2015831/my-lingo-claude
/plugin install my-lingo@zane-plugins
```

第一条命令把本仓库注册为一个插件市场，第二条命令从中安装插件。就这么简单——无需克隆，也无需编辑配置文件。随时运行 `/plugin` 可打开交互式插件管理界面。

全程无需执行 `npm install`，插件没有任何 npm 依赖。

### 方式 B —— 本地克隆（用于开发）

```bash
git clone https://github.com/zibuyu2015831/my-lingo-claude.git
cd my-lingo-claude
```

然后将本地目录注册为市场并安装：

```
/plugin marketplace add /my-lingo-claude 的绝对路径
/plugin install my-lingo@zane-plugins
```

插件通过仓库根目录下的 `.claude-plugin/plugin.json` 识别。

### 配置 API 凭证

My Lingo 不会通过对话收集你的 API Key。有两种配置方式 —— **插件配置优先于环境变量**：

- **插件配置（推荐）** —— 在插件安装界面填写 API Key / API Base URL / Fast Model（`userConfig`）。Claude Code 会安全存储敏感值并在运行时注入插件。
- **环境变量（兜底）** —— 在运行 `/my-lingo:setup` 之前自行设置。

**macOS / Linux** — 写入 `~/.zshrc` 或 `~/.bashrc`，然后 `source` 该文件：

```bash
export MY_LINGO_API_KEY="your-api-key"
export MY_LINGO_API_BASE_URL="https://api.openai.com/v1"   # 或你的服务商地址
export MY_LINGO_MODEL_FAST="gpt-4o-mini"                   # 如 deepseek-chat、llama3-8b
export MY_LINGO_MODEL_DEEP="gpt-4o"                        # 可选，默认与 MODEL_FAST 相同
```

任意 OpenAI 兼容服务商均可使用：OpenAI、DeepSeek、Groq、本地 Ollama 等。

**Windows** — 通过"系统属性 → 高级 → 环境变量"图形界面设置。

### 验证配置

打开 Claude Code 会话，运行：

```
/my-lingo:setup
```

此命令会检查所有必填变量是否已设置，并测试 API 连通性。完成后 My Lingo 即时生效，无需重启。

---

## 使用方法

### 日常使用

像平时一样使用 Claude Code 即可。My Lingo 在后台静默运行。每次提交 Prompt 后，你会在 Claude UI 中看到一行简短的状态提示：

```
[my-lingo] zh-CN→en (312ms): Review the authentication flow for security issues ...
```

仅此而已——Claude 收到的是优化后的英文版本，你的输入框中显示的仍是你的原始内容。

### 特殊前缀

在 Prompt 前加前缀，可临时改变本条消息的处理方式：

```
-- 用 Python 实现这个功能          ← 跳过优化，原样发出
:: 让测试不那么慢                  ← refine 模式：视为粗略想法，精炼后发出
```

### 学习流程

会话结束后，My Lingo 自动分析改写记录并保存纠错与词汇。建议定期使用学习命令：

```
/my-lingo:errors     ← 查看最常犯的错误
/my-lingo:vocab      ← 复习近期 Prompt 中出现的词汇
/my-lingo:lesson     ← 获取根据你的错误定制的 AI 课程
/my-lingo:review     ← SRS 间隔复习到期的学习材料
/my-lingo:profile    ← 查看 30 天统计与进步趋势
```

### 多语言空间

如果你同时学习多种语言，每种语言有独立的空间，词汇、错误记录、课程互不干扰：

```
/my-lingo:use japanese    ← 切换到日语空间
/my-lingo:info            ← 确认当前活跃空间
```

---

## 数据存储

所有数据存储在本地 `$CLAUDE_PLUGIN_DATA/my-lingo/`（无云同步，无第三方存储）：

```
$CLAUDE_PLUGIN_DATA/my-lingo/
├── config.json      # 全局配置（权限 0600）
├── spaces.json      # 语言空间配置
├── circuit.json     # 熔断器状态（自动管理）
├── analysis.lock    # 会话分析互斥锁（自动管理）
└── data.db          # SQLite 数据库（WAL 模式）
    ├── turns        # 每次 Prompt 记录
    ├── responses    # Claude 的回复（由 Stop hook 采集）
    ├── corrections  # 语言纠错记录
    ├── learning_items  # 词汇 + SRS 状态
    └── sessions     # 会话摘要
```

API 密钥仅存储在 `config.json` 中，不会写入 git，也不会传输到除你所选 API 服务商以外的任何地方。

---

## 执行模式

| 模式　　　　　　　　　　　　　　| 行为　　　　　　　　　　　　　　　　　　　　　 |
| ---------------------------------| ------------------------------------------------|
| `english_optimized`　　　　　　 | 默认。改写为英文，Claude 收到优化版本。　　　　|
| `original`　　　　　　　　　　　| 不改写，但 Prompt 仍被记录，供会话结束后分析。 |
| `original_with_english_context` | 同时发送原文和英文参考版，Claude 可看到两者。　|
| `preview`　　　　　　　　　　　 | `english_optimized` 的别名。　　　　　　　　　 |
| `off`　　　　　　　　　　　　　 | 完全关闭，不处理也不记录。　　　　　　　　　　 |

通过 `/my-lingo:mode` 切换，或直接编辑 `config.json`。

---

## 回复语言控制

在 `config.json` 中设置 `response_language_mode`，可控制 Claude 用什么语言回复：

| 值 | 行为 |
|----|------|
| `off` | 默认。Claude 自行选择回复语言。 |
| `target` | 注入指令，要求 Claude 用当前活跃空间的目标语言回复。 |

适合沉浸式练习场景：你的 Prompt 被优化为英文发出，Claude 的回复则以目标语言（如日语）返回。

### 母语摘要

如果你希望 Claude 仍用英文回复，但同时附上一段母语小结，可在 `config.json` 中设置 `summary_language_mode`：

| 值 | 行为 |
|----|------|
| `off` | 默认。不追加摘要。 |
| `native` | 要求 Claude 在每条回复末尾追加一段 2~3 句的母语摘要，便于快速抓住要点。 |

摘要语言默认取 `native_language`，也可用 `summary_language` 单独覆盖。

---

## 深度模型调优（会话分析与课程生成）

会话结束分析与课程生成使用 **deep** 模型（`MY_LINGO_MODEL_DEEP`）。`config.json` 中两个选项控制它的预算：

| 配置项 | 默认值 | 作用 |
|--------|--------|------|
| `deep_timeout_seconds` | `55` | 单次 deep 模型调用的最长等待秒数，超时即放弃。 |
| `deep_max_tokens` | `4096` | deep 模型的生成 token 预算。 |

默认值是为**慢速推理模型**（如 `gemini-2.5-pro`、o 系列）设定的——这类模型会把大量预算花在隐藏的推理 token 上，预算过小会把 JSON 截断，导致分析"静默"地一无所获。注意：

- `deep_timeout_seconds` **必须小于** `hooks/hooks.json` 中 `SessionEnd` 的 `timeout`（默认 `60`）。否则分析在提交前就被 hook 杀掉，而那些 turn 仍会被标记为已分析，学习数据就此丢失。
- 若希望会话结束几乎即时完成，建议把 deep 模型换成**快速的非推理模型**（如 `deepseek-chat`），再把这两个值调小。
- Prompt 优化（**fast** 模型）链路会自动计算自己的 token 预算，不受影响。

---

## 隐私说明

- Prompt 发送给外部 API 前会**自动脱敏**：API 密钥、数据库密码、私有 IP、连接字符串中的凭证、用户名路径均会被过滤。
- **原始 Prompt 仅存储在本地** SQLite 数据库中，不会发送给除你所选 API 服务商以外的任何第三方。
- `config.json`（包含 API 密钥）以 `0600` 权限写入，并已加入 `.gitignore`。

---

## License

MIT
