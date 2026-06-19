# My Lingo

> A Claude Code plugin that optimizes your prompts to English in real time, and turns your daily coding conversations into personalized language learning materials.

[中文文档](./README.zh.md)

---

## Background

Non-native English speakers using Claude Code face two friction points simultaneously:

1. **Prompt quality** — The same request, written in your native language (Chinese, Japanese, etc.), often gets a less precise response from Claude than a well-formed English prompt would.
2. **Language learning** — The technical English you need most is exactly the kind you'd find in real coding discussions, not in textbooks.

My Lingo solves both at once.

Every time you submit a prompt, it rewrites your text into clear, structured English through an external LLM API and hands that version to Claude transparently — you barely notice it happening. Your original message is never blocked: if the API is unavailable, your prompt goes through as-is.

And at the end of each session, My Lingo analyses those rewrites, extracts corrections and vocabulary, and turns your everyday interactions into a personal language-learning library.

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
- `--` prefix → skip optimization for this prompt
- `::` prefix → refine mode: treat the prompt as a rough idea and polish it

### Learning commands

| Command | What it does |
|---------|-------------|
| `/my-lingo:setup` | Check env var status and verify API connectivity |
| `/my-lingo:info` | Current config, active language space, today's stats |
| `/my-lingo:last` | Show the original → optimized diff for your last prompt |
| `/my-lingo:mode` | Switch execution mode (optimized / raw / off / …) |
| `/my-lingo:space` | Show current language space config and learning stats |
| `/my-lingo:spaces` | List all configured language spaces with stats |
| `/my-lingo:use` | Switch active language space |
| `/my-lingo:addspace` | Create a new language space and switch to it |
| `/my-lingo:rmspace` | Remove a language space (the default `english` space cannot be removed) |
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
- **Node.js ≥ 22.13.0** (uses built-in `node:sqlite`, `node:test`, etc. — no npm packages required; `node:sqlite` only became flag-free in 22.13.0)
- **`curl`** available in your PATH
- An **OpenAI-compatible API key** — any provider works: OpenAI, DeepSeek, Groq, a local Ollama instance, etc.

---

## Installation

### Option A — Install from the marketplace (recommended)

Inside any Claude Code session, run these two slash commands:

```
/plugin marketplace add zibuyu2015831/my-lingo-claude
/plugin install my-lingo@zane-plugins
```

The first command registers this repository as a plugin marketplace; the second installs the plugin from it. That's it — no cloning, no editing config files. Run `/plugin` anytime to open the interactive plugin manager.

No `npm install` is ever needed — the plugin has zero npm dependencies.

### Option B — Local clone (for development)

```bash
git clone https://github.com/zibuyu2015831/my-lingo-claude.git
cd my-lingo-claude
```

Then register the local directory as a marketplace and install from it:

```
/plugin marketplace add /absolute/path/to/my-lingo-claude
/plugin install my-lingo@zane-plugins
```

The plugin is identified by `.claude-plugin/plugin.json` in the repository root.

### Set API credentials

My Lingo never collects your API key through conversation. You can configure credentials two ways — **plugin config takes precedence over environment variables**:

- **Plugin config (recommended)** — fill in API Key / API Base URL / Fast Model in the plugin install screen (`userConfig`). Claude Code stores sensitive values securely and injects them into the plugin at runtime.
- **Environment variables (fallback)** — set them yourself before running `/my-lingo:setup`.

**macOS / Linux** — add to `~/.zshrc` or `~/.bashrc`, then `source` the file:

```bash
export MY_LINGO_API_KEY="your-api-key"
export MY_LINGO_API_BASE_URL="https://api.openai.com/v1"   # or your provider's endpoint
export MY_LINGO_MODEL_FAST="gpt-4o-mini"                   # e.g. deepseek-chat, llama3-8b
export MY_LINGO_MODEL_DEEP="gpt-4o"                        # optional; defaults to MY_LINGO_MODEL_FAST
```

Any OpenAI-compatible provider works: OpenAI, DeepSeek, Groq, a local Ollama instance, etc.

**Windows** — set via System Properties → Advanced → Environment Variables.

### Verify setup

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

That's it — Claude works from the optimized English version, while your input box still shows exactly what you typed.

### Special prefixes

Prefix your prompt to change behavior for that message only:

```
-- implement this in Python         ← send as-is, skip optimization
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
/my-lingo:use japanese    ← switch to Japanese space
/my-lingo:info            ← confirm active space
```

---

## Data storage

All data is stored locally under `$CLAUDE_PLUGIN_DATA/my-lingo/` (no cloud sync, no third-party storage):

```
$CLAUDE_PLUGIN_DATA/my-lingo/
├── config.json      # Global settings (mode 0600)
├── spaces.json      # Language space configuration
├── circuit.json     # Circuit breaker state (auto-managed)
├── analysis.lock    # Mutex for session analysis (auto-managed)
└── data.db          # SQLite database (WAL mode)
    ├── turns        # Prompt records per session
    ├── responses    # Claude's replies (captured by Stop hook)
    ├── corrections  # Language corrections
    ├── learning_items  # Vocabulary + SRS state
    └── sessions     # Session summaries
```

Your API key is stored only in `config.json` and is never written to git or transmitted anywhere other than your chosen API endpoint.

---

## Execution modes

| Mode | Behaviour |
|------|-----------|
| `english_optimized` | Default. Rewrites to English; Claude receives the optimized version. |
| `original` | No rewrite; prompts still recorded for later analysis. |
| `original_with_english_context` | Sends both; Claude can see both the original and English reference. |
| `preview` | Alias for `english_optimized`. |
| `off` | Completely disabled; no recording. |

Switch with `/my-lingo:mode` or by editing `config.json`.

---

## Response language

Set `response_language_mode` in `config.json` to control the language Claude replies in:

| Value | Behaviour |
|-------|-----------|
| `off` | Default. Claude replies in whatever language it chooses. |
| `target` | Injects an instruction asking Claude to respond in the active space's target language. |

This is useful when you want immersive practice: your prompts are optimized to English while Claude's replies come back in (say) Japanese.

### Native-language summary

If you'd rather keep Claude replying in English but still get a quick recap in your own language, set `summary_language_mode` in `config.json`:

| Value | Behaviour |
|-------|-----------|
| `off` | Default. No summary appended. |
| `native` | Asks Claude to append a brief 2–3 sentence summary in your native language after each reply. |

The summary language defaults to `native_language`; override it with `summary_language` if needed.

---

## Deep model tuning (session analysis & lessons)

Session-end analysis and lesson generation use the **deep** model (`MY_LINGO_MODEL_DEEP`). Two `config.json` settings control its budget:

| Key | Default | What it does |
|-----|---------|-------------|
| `deep_timeout_seconds` | `55` | Max seconds for a deep-model call before it's abandoned. |
| `deep_max_tokens` | `4096` | Completion token budget for the deep model. |

These defaults are sized for **slow reasoning models** (e.g. `gemini-2.5-pro`, the o-series): such models spend much of their token budget on hidden reasoning, so too small a budget truncates the JSON output and the analysis silently yields nothing. A few notes:

- `deep_timeout_seconds` **must stay below** the `SessionEnd` hook `timeout` in `hooks/hooks.json` (default `60`). If the hook kills the analysis before it commits, those turns are still marked as analyzed — and their learning data is lost for good.
- If you'd rather keep session-end near-instant, switch the deep model to a **fast, non-reasoning** one (e.g. `deepseek-chat`) and lower both values.
- The prompt-optimization (**fast** model) path sizes its own token budget automatically, so these two settings don't affect it.

---

## Privacy

- Prompts are **redacted** before being sent to the external API: API keys, passwords, private IPs, connection string credentials, and username-based paths are stripped.
- Your **raw prompts are stored locally** in a SQLite database (never sent to any third party other than your chosen API).
- `config.json` (containing your API key) is written with permission `0600` and is `.gitignore`d.

---

## License

MIT
