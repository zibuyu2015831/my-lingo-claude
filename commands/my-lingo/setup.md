---
name: setup
description: First-time setup wizard for My Lingo — configure API, model, and language space.
allowed-tools: Bash, Read
---

## Workflow

Run the My Lingo setup wizard to configure your API key, model, and preferences.

### Step 1: Check existing configuration

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data}"
CONFIG_FILE="$CLAUDE_PLUGIN_DATA/my-lingo/config.json"
if [ -f "$CONFIG_FILE" ]; then
  echo "Existing config found:"
  cat "$CONFIG_FILE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const s={...d}; if(s.api_key) s.api_key='****'+s.api_key.slice(-4); console.log(JSON.stringify(s,null,2))"
  echo ""
  echo "Proceed to overwrite? (yes/no)"
fi
```

If the user says no, stop here.

### Step 2: Collect configuration

Ask the user for the following values (one at a time):

1. **API Base URL** — e.g. `https://api.openai.com/v1` or `https://api.deepseek.com/v1`
2. **API Key** — the secret key for that provider
3. **Fast Model** — e.g. `gpt-4o-mini`, `deepseek-chat`, `claude-haiku-4-5-20251001`
4. **Deep Model** (optional, press Enter to skip — defaults to fast model)
5. **Native Language** — your native language code, e.g. `zh-CN`, `ja`, `ko` (default: `zh-CN`)
6. **Execution Mode** — one of `english_optimized`, `original`, `off` (default: `english_optimized`)

### Step 3: Write configuration securely

Write the config via stdin (never pass api_key as a CLI argument):

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data}"
CONFIG_DIR="$CLAUDE_PLUGIN_DATA/my-lingo"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# Write config from stdin to avoid exposing api_key in process list
node -e "
const fs = require('fs');
const raw = fs.readFileSync(0, 'utf8');
const cfg = JSON.parse(raw);
const dest = process.argv[1];
fs.mkdirSync(require('path').dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(cfg, null, 2), { mode: 0o600 });
console.log('Config written to: ' + dest);
" "$CONFIG_DIR/config.json" <<'CONFIG_EOF'
{
  "api_base_url": "USER_PROVIDED_URL",
  "api_key": "USER_PROVIDED_KEY",
  "model_fast": "USER_PROVIDED_MODEL",
  "native_language": "zh-CN",
  "execution_mode": "english_optimized",
  "timeout_seconds": 8,
  "fallback_policy": "send_original",
  "privacy_mode": "standard",
  "max_prompt_length": 4000
}
CONFIG_EOF
```

Replace placeholders with actual user-provided values. **Never** pass the API key as a command-line argument.

### Step 4: Initialize spaces.json

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data}"
SPACES_FILE="$CLAUDE_PLUGIN_DATA/my-lingo/spaces.json"
if [ ! -f "$SPACES_FILE" ]; then
  cat > "$SPACES_FILE" << 'SPACES_EOF'
{
  "active": "english",
  "spaces": {
    "english": {
      "key": "english",
      "display_name": "English",
      "target_language": "en",
      "native_language": "zh-CN",
      "level": "intermediate",
      "display_mode": "compact",
      "auto_generate_learning": true
    }
  }
}
SPACES_EOF
  echo "Initialized spaces.json"
fi
```

### Step 5: Verify API connectivity

Test the API with a minimal request:

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data}"
API_URL=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CLAUDE_PLUGIN_DATA/my-lingo/config.json','utf8')); console.log(c.api_base_url)")
MODEL=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CLAUDE_PLUGIN_DATA/my-lingo/config.json','utf8')); console.log(c.model_fast)")
API_KEY=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CLAUDE_PLUGIN_DATA/my-lingo/config.json','utf8')); console.log(c.api_key||'')")

RESPONSE=$(curl -s --max-time 10 "$API_URL/chat/completions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_KEY" \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}]}")

echo "$RESPONSE" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
if(d.error) { console.error('API error: '+d.error.message); process.exit(1); }
if(d.choices?.[0]?.message?.content) console.log('API connection OK!');
else { console.error('Unexpected response'); process.exit(1); }
"
```

If the test fails, show the error and advise the user to re-run setup. **Do not** write the config if the API test fails (but if the user skipped the test, write it anyway).

### Step 6: Display configuration summary

Show a summary of the saved configuration. **Never** display the full API key — show only the last 4 characters:

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data}"
node -e "
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('$CLAUDE_PLUGIN_DATA/my-lingo/config.json', 'utf8'));
console.log('[my-lingo] Setup complete!');
console.log('  API URL:   ' + c.api_base_url);
console.log('  API Key:   ****' + (c.api_key||'').slice(-4));
console.log('  Model:     ' + c.model_fast);
console.log('  Mode:      ' + c.execution_mode);
console.log('  Language:  ' + c.native_language);
console.log('');
console.log('Run /my-lingo:status to verify, or start using Claude Code normally.');
"
```
