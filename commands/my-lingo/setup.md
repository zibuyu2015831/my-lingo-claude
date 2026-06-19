---
name: setup
description: First-time setup wizard for My Lingo — configure API, model, and language space.
allowed-tools: Bash, Read
---

## Workflow

Check My Lingo configuration status and verify API connectivity. API credentials come from the plugin's userConfig (set in the plugin install UI) or, as a fallback, from `MY_LINGO_*` environment variables — they are never collected through this conversation.

### Step 1: Check required credentials

Credentials resolve with **plugin config (userConfig) taking precedence over environment variables**. Claude Code exposes each userConfig field to this process as `CLAUDE_PLUGIN_OPTION_<FIELD>`; when that is empty we fall back to the matching `MY_LINGO_*` export.

```bash
node -e "
const vars = [
  { opt: 'CLAUDE_PLUGIN_OPTION_API_KEY',      env: 'MY_LINGO_API_KEY',      label: 'API Key',      required: true,  sensitive: true },
  { opt: 'CLAUDE_PLUGIN_OPTION_API_BASE_URL', env: 'MY_LINGO_API_BASE_URL', label: 'API Base URL', required: true  },
  { opt: 'CLAUDE_PLUGIN_OPTION_MODEL_FAST',   env: 'MY_LINGO_MODEL_FAST',   label: 'Fast Model',   required: true  },
  { opt: 'CLAUDE_PLUGIN_OPTION_MODEL_DEEP',   env: 'MY_LINGO_MODEL_DEEP',   label: 'Deep Model',   required: false },
];

// plugin config (CLAUDE_PLUGIN_OPTION_*) wins; empty/whitespace counts as unset.
function resolve(v) {
  const o = process.env[v.opt];
  if (o && o.trim()) return { val: o, source: 'plugin config' };
  const e = process.env[v.env];
  if (e && e.trim()) return { val: e, source: 'env' };
  return { val: undefined, source: null };
}

let allRequired = true;
console.log('Credential status (plugin config > env):');
for (const v of vars) {
  const { val, source } = resolve(v);
  if (val) {
    const display = v.sensitive ? '****' + val.slice(-4) : val;
    console.log('  [OK] ' + v.label + ' = ' + display + '  (' + source + ')');
  } else if (v.required) {
    console.log('  [MISSING] ' + v.label + ' (required)');
    allRequired = false;
  } else {
    console.log('  [optional, not set] ' + v.label + ' (defaults to Fast Model)');
  }
}

if (!allRequired) {
  console.log('');
  console.log('Some required credentials are not set. Configure them either way:');
  console.log('');
  console.log('  A) Plugin config (recommended): set API Key / API Base URL / Fast Model');
  console.log('     in the plugin install screen (userConfig). These take precedence.');
  console.log('');
  console.log('  B) Environment variables (fallback):');
  console.log('     macOS / Linux (add to ~/.zshrc or ~/.bashrc):');
  console.log('       export MY_LINGO_API_KEY=\"your-api-key\"');
  console.log('       export MY_LINGO_API_BASE_URL=\"https://api.openai.com/v1\"');
  console.log('       export MY_LINGO_MODEL_FAST=\"gpt-4o-mini\"');
  console.log('       export MY_LINGO_MODEL_DEEP=\"gpt-4o\"  # optional');
  console.log('     Windows: System Properties → Advanced → Environment Variables');
  console.log('');
  console.log('After configuring, restart your terminal/session and re-run /my-lingo:setup.');
  process.exit(1);
}
"
```

If the script exits with code 1, stop here and do not continue to the next steps.

### Step 2: (no disk initialization)

`setup` intentionally writes **nothing** to disk. The plugin's data directory can
only be resolved reliably by the hook process (which alone sees `CLAUDE_PLUGIN_DATA`),
and the hook does not run until the user sends their first message. Until then,
`getDataDir()` has no pointer to read and would fail. So:

- API credentials come exclusively from plugin userConfig or environment variables (verified in Step 1) — never written to disk.
- The default language space (`english`) and default execution mode
  (`english_optimized`) are built into the code — no `spaces.json` / `config.json`
  needs to exist for the plugin to work.
- Anything that must persist (a non-default mode via `/my-lingo:mode`, a space
  switch via `/my-lingo:use`) is written **after** the first message, once the hook
  has written the install pointer.

See dev_docs/14 §10.4-A.

### Step 3: Verify API connectivity

```bash
node -e "
const { spawnSync } = require('child_process');
// plugin config (CLAUDE_PLUGIN_OPTION_*) wins over MY_LINGO_* env, matching loadConfig().
const pick = (o, e) => { const v = process.env[o]; return (v && v.trim()) ? v : process.env[e]; };
const apiUrl  = pick('CLAUDE_PLUGIN_OPTION_API_BASE_URL', 'MY_LINGO_API_BASE_URL');
const model   = pick('CLAUDE_PLUGIN_OPTION_MODEL_FAST',   'MY_LINGO_MODEL_FAST');
const apiKey  = pick('CLAUDE_PLUGIN_OPTION_API_KEY',      'MY_LINGO_API_KEY');

const body = JSON.stringify({
  model,
  max_tokens: 10,
  messages: [{ role: 'user', content: 'Say OK' }],
});

const result = spawnSync('curl', [
  '-s', '--max-time', '10',
  apiUrl + '/chat/completions',
  '-H', 'content-type: application/json',
  '-H', 'authorization: Bearer ' + apiKey,
  '-d', body,
], { encoding: 'utf8', timeout: 15000 });

if (result.error || result.status !== 0) {
  console.error('Connection failed: ' + (result.error?.message || 'curl error'));
  process.exit(1);
}

let resp;
try { resp = JSON.parse(result.stdout); } catch {
  console.error('Invalid response from API');
  process.exit(1);
}

if (resp.error) {
  console.error('API error: ' + resp.error.message);
  console.error('Check your API Key and API Base URL (plugin config or MY_LINGO_* env).');
  process.exit(1);
}

if (resp.choices?.[0]?.message?.content) {
  console.log('API connection OK!');
} else {
  console.error('Unexpected response shape — verify the Fast Model is a valid model name.');
  process.exit(1);
}
"
```

If the connectivity test fails, stop here and advise the user to check their environment variables.

### Step 4: Display configuration summary

```bash
node -e "
const pick = (o, e) => { const v = process.env[o]; if (v && v.trim()) return [v, 'plugin config']; const f = process.env[e]; return f ? [f, 'env'] : ['', null]; };
const [apiUrl, urlSrc]   = pick('CLAUDE_PLUGIN_OPTION_API_BASE_URL', 'MY_LINGO_API_BASE_URL');
const [apiKey, keySrc]   = pick('CLAUDE_PLUGIN_OPTION_API_KEY',      'MY_LINGO_API_KEY');
const [model,  modelSrc] = pick('CLAUDE_PLUGIN_OPTION_MODEL_FAST',   'MY_LINGO_MODEL_FAST');
console.log('');
console.log('[my-lingo] Setup complete!');
console.log('  API URL:   ' + apiUrl + '  (' + urlSrc + ')');
console.log('  API Key:   ****' + apiKey.slice(-4) + '  (' + keySrc + ')');
console.log('  Model:     ' + model + '  (' + modelSrc + ')');
console.log('  Mode:      english_optimized  (default)');
console.log('  Language:  zh-CN  (default)');
console.log('  Space:     english  (default)');
console.log('');
console.log('Send any message to Claude to activate the plugin (the hook records');
console.log('your first turn and writes the install pointer). After that:');
console.log('  • /my-lingo:info  — verify configuration and stats');
console.log('  • /my-lingo:mode    — change execution mode (persists)');
console.log('  • /my-lingo:use     — switch language space (persists)');
"
```
