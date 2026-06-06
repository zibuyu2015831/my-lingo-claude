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
      "description": "API key for the external optimization model.",
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

## 5. 环境变量参考

| 变量 | 说明 | 来源 |
|------|------|------|
| `CLAUDE_PLUGIN_ROOT` | 插件根目录路径 | Claude Code 提供 |
| `CLAUDE_PLUGIN_DATA` | 插件数据目录路径 | Claude Code 提供 |
| `CLAUDE_SESSION_ID` | 当前会话 ID | Claude Code 提供 |
| `MY_LINGO_API_KEY` | API key 覆盖 | 用户手动设置 |
| `CLAUDE_CODE_USE_BEDROCK` | 是否运行在 Bedrock | Claude Code 提供 |
