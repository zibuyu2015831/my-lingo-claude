---
name: rmspace
description: Remove a language space (the default 'english' space cannot be removed).
argument-hint: "<key>"
allowed-tools: Bash, Read
---

## Workflow

Remove a language space from the configuration. This only deletes the space's
config entry; any learning data already recorded under that space is left in the
database (clear it separately with `/my-lingo:purge` if desired). The default
`english` space cannot be removed so there is always a valid fallback.

### Step 1: Remove the space

```bash
# Replace KEY_HERE with the space key from $ARGUMENTS (lowercased).
KEY="KEY_HERE"

node --input-type=module --eval "
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { loadSpaces, removeSpace, setActiveSpace } = await import(ROOT + '/scripts/lib/config.mjs');

const key = (process.argv[1] || '').trim().toLowerCase();
if (!key) { console.error('Usage: /my-lingo:rmspace <key>'); process.exit(1); }
if (key === 'english') { console.error('[my-lingo] The default \'english\' space cannot be removed.'); process.exit(1); }

const data = loadSpaces();
if (!data.spaces[key]) {
  console.error('[my-lingo] Space not found: ' + key);
  console.error('Available spaces: ' + Object.keys(data.spaces).join(', '));
  process.exit(1);
}

const wasActive = data.active === key;
removeSpace(key);
if (wasActive) setActiveSpace('english'); // active dangled — fall back to default
console.log('[my-lingo] Removed space: ' + key + (wasActive ? ' (active space reset to english)' : ''));
" "$KEY"
```
