# 插件目录结构与 plugin.json

版本：v0.2

---

## 1. 目录结构

```
my-lingo-claude/
│
├── .claude-plugin/
│   └── plugin.json                  # 插件元数据（唯一放在此目录的文件）
│
├── commands/
│   └── my-lingo/                    # 命令 namespace
│       ├── setup.md                 # /my-lingo:setup
│       ├── status.md                # /my-lingo:status
│       ├── last.md                  # /my-lingo:last
│       ├── mode.md                  # /my-lingo:mode
│       ├── space.md                 # /my-lingo:space (v0.2)
│       ├── spaces.md                # /my-lingo:spaces (v0.2)
│       ├── use.md                   # /my-lingo:use (v0.2)
│       ├── recent.md                # /my-lingo:recent (v0.2)
│       ├── errors.md                # /my-lingo:errors (v0.2)
│       ├── lesson.md                # /my-lingo:lesson (v0.3)
│       ├── vocab.md                 # /my-lingo:vocab (v0.3)
│       ├── profile.md               # /my-lingo:profile (v0.3)
│       ├── review.md                # /my-lingo:review (v0.3)
│       ├── export.md                # /my-lingo:export (v0.3)
│       └── purge.md                 # /my-lingo:purge (v0.2)
│
├── hooks/
│   └── hooks.json                   # Hook 配置（详见 05-hooks.md）
│
├── scripts/                         # Node.js hook 脚本
│   ├── user-prompt-submit.mjs       # UserPromptSubmit hook 入口
│   ├── session-end.mjs              # SessionEnd hook 入口
│   └── lib/
│       ├── detect.mjs               # 语言检测
│       ├── config.mjs               # 配置加载
│       ├── storage.mjs              # JSONL 读写
│       ├── api.mjs                  # 外部 API 调用
│       ├── prompts.mjs              # Prompt 构建
│       └── privacy.mjs              # 脱敏处理
│
├── tests/                           # 单元测试
│   ├── detect.test.mjs
│   ├── privacy.test.mjs
│   ├── config.test.mjs
│   └── storage.test.mjs
│
├── dev_docs/                        # 开发文档体系
│   ├── 00-decisions.md
│   ├── 01-overview.md
│   └── ...
│
├── package.json
├── .gitignore
└── README.md
```

**关键原则**：
- `.claude-plugin/` 目录内**只放** `plugin.json`
- `commands/`、`hooks/`、`scripts/` 都在根目录
- 不使用旧版 `skills/SKILL.md` 格式，使用 `commands/` 新格式

---

## 2. plugin.json

```json
{
  "name": "my-lingo",
  "version": "0.1.0",
  "description": "A personal Claude Code language-learning and prompt-enhancement plugin. Optimizes your prompts to English and builds personalized language learning materials from your real coding interactions.",
  "author": "Zane",
  "commands": "./commands",
  "hooks": "./hooks/hooks.json",
  "userConfig": {
    "api_base_url": {
      "type": "string",
      "title": "API Base URL",
      "description": "OpenAI-compatible API base URL (e.g., https://api.openai.com/v1).",
      "required": true
    },
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "API key for the external optimization model. Displayed in Claude Code UI only — the hook script reads it from config.json written by /my-lingo:setup.",
      "sensitive": true,
      "required": true
    },
    "model_fast": {
      "type": "string",
      "title": "Fast Model",
      "description": "Model for synchronous prompt optimization (e.g., gpt-4o-mini, deepseek-chat).",
      "required": true
    },
    "model_deep": {
      "type": "string",
      "title": "Deep Model",
      "description": "Model for lesson and profile generation. Defaults to model_fast if not set.",
      "required": false
    },
    "native_language": {
      "type": "string",
      "title": "Native Language",
      "description": "Your native language code for explanations (e.g., zh-CN, ja, ko).",
      "default": "zh-CN"
    },
    "default_target_language": {
      "type": "string",
      "title": "Default Target Language",
      "description": "Target language for your first language space (e.g., en, ja, de).",
      "default": "en"
    },
    "execution_mode": {
      "type": "string",
      "title": "Default Execution Mode",
      "description": "english_optimized, original, original_with_english_context, or off.",
      "default": "english_optimized"
    },
    "timeout_seconds": {
      "type": "number",
      "title": "API Timeout (seconds)",
      "description": "Maximum time to wait for API response before falling back.",
      "default": 8
    }
  }
}
```

**关于 `userConfig` 的重要说明**：

`userConfig` 字段在 Claude Code UI 中展示配置项（让用户了解有哪些选项），但 hook 脚本（独立 Node.js 进程）**不会**自动接收 userConfig 的值作为环境变量。

**实际配置流程**：
1. 用户运行 `/my-lingo:setup` → Claude 通过 `Bash` 工具交互读取用户输入
2. setup 命令将所有配置写入 `$CLAUDE_PLUGIN_DATA/my-lingo/config.json`（权限 0o600）
3. hook 脚本在每次触发时读取 `config.json`（而非 userConfig）

这与参考实现（`claude-english-buddy`）的模式一致：它完全不使用 userConfig，直接读取 `.claude-english-buddy.json` 项目配置文件。

```json
```

---

## 3. 命令文件格式（commands/my-lingo/*.md）

命令文件使用 YAML frontmatter + markdown workflow 格式：

```markdown
---
name: status
description: |
  Show current My Lingo status, configuration, and today's stats.
  <example>
  Context: User wants to check what language space is active and how many prompts were optimized today.
  user: "/my-lingo:status"
  assistant: "Reading My Lingo configuration and today's JSONL data to display status."
  </example>
argument-hint: ""
allowed-tools: Bash, Read
---

## Workflow

Read the configuration and today's turns data, then display a formatted status report.

### Step 1: Load config

Read `$CLAUDE_PLUGIN_DATA/my-lingo/config.json` and `$CLAUDE_PLUGIN_DATA/my-lingo/spaces.json`.
If config.json does not exist, show a setup prompt instead.

### Step 2: Load today's stats

Read today's JSONL file from `$CLAUDE_PLUGIN_DATA/my-lingo/turns/YYYY-MM-DD.jsonl`.
Count: total, optimized (non-fallback), translated, corrected, fallbacks.

### Step 3: Display

Output the status in this format:
...
```

---

## 4. package.json

```json
{
  "name": "my-lingo-claude",
  "version": "0.1.0",
  "description": "My Lingo Claude Code plugin",
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**最小依赖原则**：只使用 Node.js 标准库（`fs`、`path`、`os`、`child_process`）和系统的 `curl`。不引入任何 npm 包，避免 `node_modules` 带来的依赖管理问题。

---

## 5. .gitignore

以下文件必须排除在版本控制之外：

```gitignore
# 包含 API key 的配置文件（由 /my-lingo:setup 写入）
# 注意：config.json 在 $CLAUDE_PLUGIN_DATA 目录下，不在仓库中，
# 但如果用户在项目目录下创建了 .claude-my-lingo.json，也需排除
.claude-my-lingo.json

# 开发时的本地测试数据（不应提交）
.env
.env.local
```

`$CLAUDE_PLUGIN_DATA` 目录本身位于 `~/.claude/plugins/data/` 之下，不在仓库目录中，无需额外 .gitignore。

---

## 6. 环境变量参考

| 变量 | 说明 | 来源 |
|------|------|------|
| `CLAUDE_PLUGIN_ROOT` | 插件根目录路径 | Claude Code 提供 |
| `CLAUDE_PLUGIN_DATA` | 插件数据目录路径（默认 `~/.claude/plugins/data/`）| Claude Code 提供 |
| `CLAUDE_SESSION_ID` | 当前会话 ID（hook 中记录到每条 turn）| Claude Code 提供 |
| `MY_LINGO_API_KEY` | API key 环境变量覆盖（优先级高于 config.json）| 用户手动设置 |

**注意**：`CLAUDE_CODE_USE_BEDROCK` 不适用于 My Lingo——My Lingo 调用的是用户自选的外部 API（OpenAI / DeepSeek 等），不通过 Anthropic Bedrock。
