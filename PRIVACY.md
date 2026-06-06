# My Lingo — Privacy Disclosure

## What My Lingo does with your prompts

Every message you send to Claude Code passes through the My Lingo `UserPromptSubmit` hook **before** reaching Claude. Depending on your configured mode:

| Mode | External API call? | What is sent? |
|------|--------------------|---------------|
| `english_optimized` (default) | Yes | Your prompt text (after redaction) |
| `original_with_english_context` | Yes | Your prompt text (after redaction) |
| `original` | No | Nothing — only logged locally |
| `off` | No | Nothing — hook exits immediately |

## Which external API receives your prompts?

You configure the API yourself during `/my-lingo:setup`. My Lingo supports any OpenAI-compatible API endpoint. Common choices:

- OpenAI (`api.openai.com`) — governed by [OpenAI's privacy policy](https://openai.com/policies/privacy-policy)
- DeepSeek (`api.deepseek.com`) — governed by DeepSeek's privacy policy
- Any self-hosted endpoint you control

**My Lingo itself does not transmit data to Anthropic or any fixed third-party server.** The destination is solely what you configure.

## Automatic redaction before sending

Before your prompt is sent to the external API, My Lingo's `privacy.mjs` applies 7 redaction rules:

| Rule | Example input | Sent as |
|------|---------------|---------|
| API keys / tokens | `sk-abc123...`, `ghp_...` | `[API_KEY]` |
| DB connection strings | `postgres://user:pass@host` | `postgres://user:[PASS]@host` |
| Generic secrets | `password=hunter2` | `password=[REDACTED]` |
| PEM private keys | `-----BEGIN PRIVATE KEY-----` | `[PRIVATE_KEY]` |
| Home directory paths | `/home/alice/projects/` | `/home/[USER]/projects/` |
| Private IP addresses | `192.168.1.1`, `10.0.0.5` | `[PRIVATE_IP]` |
| AWS access keys | `AKIAIOSFODNN7EXAMPLE` | `[AWS_ACCESS_KEY]` |

Redaction is always active (`privacy_mode: standard`). You can disable it with `privacy_mode: off` in your config, but this is not recommended.

## What is stored locally

Every processed prompt is logged as a JSONL record in:

```
$CLAUDE_PLUGIN_DATA/my-lingo/turns/YYYY-MM-DD.jsonl
```

Default location: `~/.claude/plugins/data/my-lingo/turns/`

Each record contains: timestamp, session ID, working directory, original prompt text, optimized prompt text, detected language, latency, mode, and fallback status. **The API key is never stored in turn records.**

## API key storage

Your API key is stored in:

```
$CLAUDE_PLUGIN_DATA/my-lingo/config.json   (permissions: 0600 — readable only by you)
```

It is never written to shell history, process arguments, or log files.

## What is NOT collected

- My Lingo does not send analytics to any central server.
- My Lingo does not store your API key outside of `config.json`.
- My Lingo does not share data between users or machines.

## How to disable data collection

Set `execution_mode: off` via `/my-lingo:mode off` to stop all prompt processing. No API calls will be made and no turns will be logged.

To delete all stored turn data:

```bash
rm -rf "$CLAUDE_PLUGIN_DATA/my-lingo/turns/"
```
