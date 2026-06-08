# My Lingo

> A Claude Code plugin that optimizes your prompts to English in real time, and turns your daily coding conversations into personalized language learning materials.

[中文文档](./README.zh.md)

---

## Background

Non-native English speakers using Claude Code face two friction points simultaneously:

1. **Prompt quality** — Expressing technical intent in your native language (Chinese, Japanese, etc.) often produces less precise Claude responses than well-formed English prompts.
2. **Language learning** — The technical English you need most is exactly the kind you'd find in real coding discussions, not in textbooks.

My Lingo solves both at once. It intercepts every prompt you submit, rewrites it into structured English via an external LLM API, and injects the result transparently before Claude sees it. Your original message is never blocked — if the API is unavailable, your prompt goes through as-is. At the end of each session, My Lingo analyses the rewrites, extracts corrections and vocabulary, and builds up a personal language learning library from your actual interactions.

**Before / After example:**

| Your input | Ordinary translation | My Lingo optimized |
|-----------|---------------------|-------------------|
| 检查这个项目有没有架构问题，先不要修改代码。 | Check whether this project has architecture problems. Do not modify the code first. | Review this project for potential architectural issues. Do not modify any files yet. First provide a structured analysis covering module boundaries, data flow, maintainability, scalability, and potential risks. |

---

## Features

### Prompt optimization (runs automatically on every prompt)

- Translates and structurally improves non-English prompts
- Corrects unnatural or grammatically broken English
- Leaves pure English, code blocks, commands, and URLs untouched
- Falls back silently if the API is unavailable (circuit breaker built in)
- `!raw` prefix → skip optimization for this prompt
- `::` prefix → refine mode: treat the prompt as a rough idea and polish it

### Learning commands

| Command | What it does |
|---------|-------------|
| `/my-lingo:setup` | Check env var status and verify API connectivity |
| `/my-lingo:status` | Current config, active language space, today's stats |
| `/my-lingo:last` | Show the original → optimized diff for your last prompt |
| `/my-lingo:mode` | Switch execution mode (optimized / raw / off / …) |
| `/my-lingo:vocab` | Top vocabulary extracted from your recent interactions |
| `/my-lingo:sentences` | Sentence patterns found in recent interactions |
| `/my-lingo:errors` | Most common error patterns in your English |
| `/my-lingo:recent` | Recent corrections with explanations |
| `/my-lingo:review` | SRS flashcard review of your learning items |
| `/my-lingo:lesson` | AI-generated lesson based on your recent sessions |
| `/my-lingo:profile` | 30-day learning profile: trends, error patterns, SRS stats |
| `/my-lingo:export` | Export all learning materials as Markdown |
| `/my-lingo:purge` | Delete old data files |

---

## Requirements

- **Claude Code** (with plugin support)
- **Node.js ≥ 18** (uses built-in `node:test`, `node:http`, etc. — no npm packages required)
- **`curl`** available in your PATH
- An **OpenAI-compatible API key** — any provider works: OpenAI, DeepSeek, Groq, a local Ollama instance, etc.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/zibuyu2015831/my-lingo-claude.git
cd my-lingo-claude
```

No `npm install` needed — the plugin has zero npm dependencies.

### 2. Register the plugin with Claude Code

Add the plugin directory to Claude Code's plugin configuration. In your Claude Code settings (usually `~/.claude/settings.json`), add the path to this repository under the plugins list, or place the directory where Claude Code scans for local plugins.

The plugin is identified by `.claude-plugin/plugin.json` in the repository root.

### 3. Set API credentials as environment variables

My Lingo never collects your API key through conversation. Set these variables using your platform's native method before running `/my-lingo:setup`:

**macOS / Linux** — add to `~/.zshrc` or `~/.bashrc`, then `source` the file:

```bash
export MY_LINGO_API_KEY="your-api-key"
export MY_LINGO_API_BASE_URL="https://api.openai.com/v1"   # or your provider's endpoint
export MY_LINGO_MODEL_FAST="gpt-4o-mini"                   # e.g. deepseek-chat, llama3-8b
export MY_LINGO_MODEL_DEEP="gpt-4o"                        # optional; defaults to MY_LINGO_MODEL_FAST
```

Any OpenAI-compatible provider works: OpenAI, DeepSeek, Groq, a local Ollama instance, etc.

**Windows** — set via System Properties → Advanced → Environment Variables.

### 4. Verify setup

Open a Claude Code session and run:

```
/my-lingo:setup
```

This checks that all required variables are set and tests API connectivity. My Lingo activates automatically after that — no restart needed.

---

## Usage

### Everyday use

Just use Claude Code normally. My Lingo runs silently in the background. After each prompt you submit, you'll see a brief status line in the Claude UI:

```
[my-lingo] zh-CN→en (312ms): Review the authentication flow for security issues ...
```

That's it — Claude receives the optimized English version, you see the original in your input.

### Special prefixes

Prefix your prompt to change behavior for that message only:

```
!raw implement this in Python       ← send as-is, skip optimization
:: make tests less flaky            ← refine mode: treat as rough idea, polish it
```

### Learning workflow

At the end of a session, My Lingo automatically analyses the rewrites and saves corrections and vocabulary. Use the learning commands periodically:

```
/my-lingo:errors     ← see your most frequent mistakes
/my-lingo:vocab      ← review words from your recent prompts
/my-lingo:lesson     ← get an AI lesson tailored to your errors
/my-lingo:review     ← SRS flashcard session for due items
/my-lingo:profile    ← 30-day stats and improvement trend
```

### Multi-language spaces

If you're learning more than one language, each has its own isolated space with separate vocabulary, error records, and lessons:

```
/my-lingo:setlang japanese    ← switch to Japanese space
/my-lingo:status              ← confirm active space
```

---

## Data storage

All data is stored locally under `$CLAUDE_PLUGIN_DATA/my-lingo/` (no cloud sync, no third-party storage):

```
$CLAUDE_PLUGIN_DATA/my-lingo/
├── config.json                   # API key and global settings (mode 0600)
├── spaces.json                   # Language space configuration
├── circuit.json                  # Circuit breaker state (auto-managed)
├── turns/
│   └── YYYY-MM-DD.jsonl          # Daily prompt records
└── learning/
    └── english/
        ├── corrections-YYYY-MM.jsonl   # Grammar corrections
        ├── items-YYYY-MM.jsonl         # Vocabulary and sentence patterns (SRS)
        └── lessons-YYYY-MM-DD.md      # Generated lessons
```

Your API key is stored only in `config.json` and is never written to git or transmitted anywhere other than your chosen API endpoint.

---

## Execution modes

| Mode | Behaviour |
|------|-----------|
| `english_optimized` | Default. Rewrites to English; Claude receives the optimized version. |
| `original` | No rewrite; prompts still recorded for later analysis. |
| `original_with_english_context` | Sends both; Claude can see both the original and English reference. |
| `off` | Completely disabled; no recording. |

Switch with `/my-lingo:mode` or by editing `config.json`.

---

## Privacy

- Prompts are **redacted** before being sent to the external API: API keys, passwords, private IPs, connection string credentials, and username-based paths are stripped.
- Your **raw prompts are stored locally** in JSONL files (never sent to any third party other than your chosen API).
- `config.json` (containing your API key) is written with permission `0600` and is `.gitignore`d.

---

## License

MIT
