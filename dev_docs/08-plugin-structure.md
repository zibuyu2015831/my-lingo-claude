# 插件目录结构与 plugin.json

版本：v0.6

---

## 1. 目录结构

```
my-lingo-claude/
│
├── .claude-plugin/
│   ├── plugin.json                  # 插件元数据
│   └── marketplace.json             # marketplace 条目（zane-plugins）
│
├── commands/
│   └── my-lingo/                    # 命令 namespace（18 个）
│       ├── setup.md  info.md  last.md  mode.md
│       ├── space.md  spaces.md  use.md  addspace.md  rmspace.md   # 语言空间
│       ├── recent.md  errors.md  purge.md
│       └── lesson.md  vocab.md  sentences.md  profile.md  review.md  export.md
│
├── hooks/
│   └── hooks.json                   # Hook 配置：SessionStart/UserPromptSubmit/Stop/SessionEnd（详见 05-hooks.md）
│
├── scripts/                         # Node.js hook 脚本
│   ├── user-prompt-submit.mjs       # UserPromptSubmit hook 入口
│   ├── stop.mjs                     # Stop hook 入口（回复捕获）
│   ├── session-end.mjs              # SessionEnd hook 入口
│   ├── session-start.mjs            # SessionStart hook 入口（v0.6 补偿触发）
│   ├── generate-lesson.mjs          # 课程生成（被 lesson.md 调用）
│   ├── validate-manifests.mjs       # CI：元数据一致性校验
│   └── lib/
│       ├── detect.mjs   config.mjs   paths.mjs   db.mjs   storage.mjs
│       ├── api.mjs      prompts.mjs  privacy.mjs analysis.mjs
│       └── srs.mjs      lesson.mjs   debug.mjs
│
├── tests/                           # 单元测试（256）+ integration（14）+ e2e（5, skip）
│   ├── *.test.mjs
│   ├── integration/{mock-server,helpers,integration.test}.mjs
│   └── e2e/e2e.test.mjs
│
├── dev_docs/                        # 开发文档体系
│   ├── 00-decisions.md  01-overview.md  …  15-architecture-review-v0.5.md
│   ├── INDEX.md
│   └── development/IMPLEMENTATION_PLAN_V0.*.md
│
├── package.json
├── .gitignore
└── README.md / README.zh.md
```

**关键原则**：
- `.claude-plugin/` 目录内放 `plugin.json`（必需）与 `marketplace.json`（发布用）
- `commands/`、`hooks/`、`scripts/` 都在根目录
- 不使用旧版 `skills/SKILL.md` 格式，使用 `commands/` 新格式

---

## 2. plugin.json

**重要**：`commands/` 和 `hooks/hooks.json` 均由 Claude Code **自动发现**，不得在 `plugin.json` 中重复声明。若同时声明 `"hooks": "./hooks/hooks.json"`，Claude Code 会检测到"重复 hooks 文件"并报错（`failed to load · 1 error`）。只有当 hooks 文件位于非标准路径时才需要在此声明。

```json
{
  "name": "my-lingo",
  "version": "0.6.0",
  "description": "A personal Claude Code language-learning and prompt-enhancement plugin. Optimizes your prompts to English and builds personalized language learning materials from your real coding interactions.",
  "author": { "name": "Zane", "email": "zane.wu.dev@gmail.com" },
  "license": "MIT",
  "keywords": ["language-learning", "prompt-optimization", "non-native", "chinese", "translation", "developer-tools"],
  "category": "developer-tools",
  "userConfig": {
    "api_base_url": {
      "type": "string",
      "title": "API Base URL",
      "description": "OpenAI-compatible API base URL (e.g., https://api.openai.com/v1). Enter it here, or leave blank to use the MY_LINGO_API_BASE_URL env var. This field takes precedence over the env var.",
      "required": false
    },
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "API key for the external optimization model. Enter it here (stored securely), or leave blank to use the MY_LINGO_API_KEY env var. This field takes precedence over the env var.",
      "sensitive": true,
      "required": false
    },
    "model_fast": {
      "type": "string",
      "title": "Fast Model",
      "description": "Model for synchronous prompt optimization (e.g., gpt-4o-mini, deepseek-chat). … This field takes precedence over the env var.",
      "required": false
    },
    "model_deep": {
      "type": "string",
      "title": "Deep Model",
      "description": "Model for lesson and profile generation (e.g., gpt-4o). … Defaults to the Fast Model if not set.",
      "required": false
    },
    "native_language": {
      "type": "string",
      "title": "Native Language",
      "description": "Your native language code for explanations (e.g., zh-CN, ja, ko).",
      "default": "zh-CN"
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

> 与早期草稿的差异：所有凭证字段 `required: false`（凭证可改走环境变量，不强制在安装界面填）；`api_key` 由 Claude Code 注入为 `CLAUDE_PLUGIN_OPTION_API_KEY`，hook 直接读环境变量、**绝不写入 config.json**；`author` 是对象；无 `default_target_language` 字段（目标语言由语言空间的 `target_language` 决定）。

**关于 `userConfig` 的重要说明**：

Claude Code 会把 plugin.json `userConfig` 的每个字段以 `CLAUDE_PLUGIN_OPTION_<字段大写>` 环境变量注入**插件子进程**（hook 进程即属此类）。因此凭证的运行时解析在 `config.mjs` 的 Layer 0（`credValue()`）完成：

**凭证解析流程（运行时关键路径）**：
1. hook 进程启动 → `loadConfig()` 读取 `CLAUDE_PLUGIN_OPTION_API_KEY` 等（userConfig 注入值）
2. 该值为空时回退到用户自行 export 的 `MY_LINGO_API_KEY` 等
3. 凭证**绝不写入 config.json**（`CREDENTIAL_FIELDS` 在读写时强制过滤）；`/my-lingo:setup` 不收集、不落盘任何凭证

> ⚠️ **slash command 的边界**：`/my-lingo:setup`、`/my-lingo:info` 的内联 bash 块是 `Bash` 工具子进程，**不一定**能像 hook 那样收到 `CLAUDE_PLUGIN_OPTION_*`（参见 [`14-data-dir-split-investigation.md`](./14-data-dir-split-investigation.md) 对 `CLAUDE_PLUGIN_DATA`/`ROOT` 的实测）。因此这两个命令在展示凭证状态时会优先尝试 `CLAUDE_PLUGIN_OPTION_*`、再回退 `MY_LINGO_*`：若用户仅通过 userConfig 配置且该变量未注入到 slash command，状态可能显示为来自 env 或未设置，但**不影响 hook 的真实运行**。

---

## 3. 命令文件格式（commands/my-lingo/*.md）

命令文件使用 YAML frontmatter + markdown workflow 格式：

```markdown
---
name: info
description: |
  Show current My Lingo status, configuration, and today's stats.
  <example>
  Context: User wants to check what language space is active and how many prompts were optimized today.
  user: "/my-lingo:info"
  assistant: "Reading My Lingo configuration and today's data to display status."
  </example>
argument-hint: ""
allowed-tools: Bash, Read
---

## Workflow

Read the configuration and today's turns data, then display a formatted status report.

### Step 1: Load config

通过 `import` 复用 `scripts/lib/*` 读取配置与统计（命令在 env-blind 子进程里运行，需经
`install.json` 指针定位 plugin root + data dir，见 dev_docs/14）。

### Step 2: Load today's stats

经 `storage.mjs` 从 `data.db` 读取（**不再**内联读 JSONL）。
Count: total, optimized (non-fallback), translated, corrected, fallbacks。

### Step 3: Display

Output the status in this format:
...
```

> 命令名是 `info`（早期叫 `status`，v0.5 重命名）。

---

## 4. package.json

```json
{
  "name": "my-lingo-claude",
  "version": "0.6.0",
  "description": "My Lingo Claude Code plugin — prompt optimization and language learning",
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:integration": "node --test tests/integration/integration.test.mjs",
    "test:e2e": "node --test tests/e2e/*.test.mjs",
    "validate": "node scripts/validate-manifests.mjs"
  },
  "engines": {
    "node": ">=22.13.0"
  }
}
```

> `engines.node` 为 **`>=22.13.0`**（不是 18）——`storage.mjs` 依赖 Node 内置 `node:sqlite`；该模块 22.5 起存在但需 `--experimental-sqlite` flag，**自 22.13 起才免 flag 可用**，故 floor 锁定 22.13（见 `00-decisions.md` D3 / `15` F10）。

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
| `CLAUDE_PLUGIN_OPTION_API_KEY` 等 | plugin.json userConfig 值的注入形式（凭证最高优先级）| Claude Code 注入 |
| `MY_LINGO_API_KEY` 等 | 凭证兜底来源（userConfig 未设时生效）| 用户手动 export |

**注意**：`CLAUDE_CODE_USE_BEDROCK` 不适用于 My Lingo——My Lingo 调用的是用户自选的外部 API（OpenAI / DeepSeek 等），不通过 Anthropic Bedrock。

---

## 7. 开发环境配置（本地调试模式）

开发阶段推荐使用**软链接注册**，让 Claude Code 直接读取仓库源码，无需每次修改后重新安装插件。

### 7.1 注册方式

Claude Code 会自动加载 `~/.claude/skills/` 目录下的所有插件。创建软链接将仓库注册到该目录即可：

```bash
mkdir -p ~/.claude/skills
ln -s /path/to/my-lingo-claude ~/.claude/skills/my-lingo
```

注册后重启 Claude Code，插件以 `my-lingo@skills-dir` 身份加载：

```
Skills-directory plugins (.claude/skills/*):
  ❯ my-lingo@skills-dir
    Version: 0.1.0
    Scope: user
    Path: ~/.claude/skills/my-lingo
    Status: ✔ loaded
```

### 7.2 开发工作流

| 操作 | 是否需要重启 Claude |
|------|-------------------|
| 修改 `scripts/` hook 脚本 | 否（hook 每次触发时实时读取） |
| 修改 `commands/my-lingo/*.md` 命令文件 | 是（Claude Code 启动时缓存命令列表） |
| 修改 `.claude-plugin/plugin.json` | 是 |
| 修改 `hooks/hooks.json` | 是 |

### 7.3 验证注册状态

```bash
# 查看插件列表与加载状态
claude plugin list

# 验证 plugin.json 及所有组件
claude plugin validate ~/.claude/skills/my-lingo
```

### 7.4 注意事项

- 软链接指向仓库根目录（含 `.claude-plugin/plugin.json`），**不要**指向 `.claude-plugin/` 子目录
- `hooks/hooks.json` 和 `commands/` 由 Claude Code 自动发现，**不要**在 `plugin.json` 中重复声明（否则触发"重复 hooks 文件"错误）
- 调试 hook 脚本时可设置环境变量 `MY_LINGO_DEBUG=1` 开启详细日志（输出到 stderr）
