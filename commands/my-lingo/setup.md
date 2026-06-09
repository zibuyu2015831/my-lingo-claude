---
name: setup
description: First-time setup wizard for My Lingo — configure API, model, and language space.
allowed-tools: Bash, Read
---

## Workflow

Check My Lingo configuration status and verify API connectivity. API credentials must be set as environment variables — they are never collected through this conversation.

### Step 1: Check required environment variables

```bash
node -e "
const vars = [
  { name: 'MY_LINGO_API_KEY',      label: 'API Key',      required: true  },
  { name: 'MY_LINGO_API_BASE_URL', label: 'API Base URL', required: true  },
  { name: 'MY_LINGO_MODEL_FAST',   label: 'Fast Model',   required: true  },
  { name: 'MY_LINGO_MODEL_DEEP',   label: 'Deep Model',   required: false },
];

let allRequired = true;
console.log('Environment variable status:');
for (const v of vars) {
  const val = process.env[v.name];
  if (val) {
    const display = v.name === 'MY_LINGO_API_KEY' ? '****' + val.slice(-4) : val;
    console.log('  [OK] ' + v.name + ' = ' + display);
  } else if (v.required) {
    console.log('  [MISSING] ' + v.name + ' (required)');
    allRequired = false;
  } else {
    console.log('  [optional, not set] ' + v.name + ' (defaults to MY_LINGO_MODEL_FAST)');
  }
}

if (!allRequired) {
  console.log('');
  console.log('Some required variables are not set. Set them using your platform method:');
  console.log('');
  console.log('  macOS / Linux (add to ~/.zshrc or ~/.bashrc):');
  console.log('    export MY_LINGO_API_KEY=\"your-api-key\"');
  console.log('    export MY_LINGO_API_BASE_URL=\"https://api.openai.com/v1\"');
  console.log('    export MY_LINGO_MODEL_FAST=\"gpt-4o-mini\"');
  console.log('    export MY_LINGO_MODEL_DEEP=\"gpt-4o\"  # optional');
  console.log('');
  console.log('  Windows: System Properties → Advanced → Environment Variables');
  console.log('');
  console.log('After setting variables, restart your terminal and re-run /my-lingo:setup.');
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

- API credentials come exclusively from environment variables (verified in Step 1).
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
const apiUrl  = process.env.MY_LINGO_API_BASE_URL;
const model   = process.env.MY_LINGO_MODEL_FAST;
const apiKey  = process.env.MY_LINGO_API_KEY;

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
  console.error('Check your MY_LINGO_API_KEY and MY_LINGO_API_BASE_URL.');
  process.exit(1);
}

if (resp.choices?.[0]?.message?.content) {
  console.log('API connection OK!');
} else {
  console.error('Unexpected response shape — verify MY_LINGO_MODEL_FAST is a valid model name.');
  process.exit(1);
}
"
```

If the connectivity test fails, stop here and advise the user to check their environment variables.

### Step 4: Display configuration summary

```bash
node -e "
console.log('');
console.log('[my-lingo] Setup complete!');
console.log('  API URL:   ' + process.env.MY_LINGO_API_BASE_URL + '  (env)');
console.log('  API Key:   ****' + (process.env.MY_LINGO_API_KEY || '').slice(-4) + '  (env)');
console.log('  Model:     ' + process.env.MY_LINGO_MODEL_FAST + '  (env)');
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
