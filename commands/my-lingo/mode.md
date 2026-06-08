---
name: mode
description: View or switch execution mode (english_optimized / original / off).
argument-hint: "[mode]"
allowed-tools: Bash, Read
---

## Workflow

View the current execution mode, or switch to a new one.

### Mode aliases

| Alias | Stored value |
|-------|-------------|
| `english`, `english_optimized` | `english_optimized` |
| `raw`, `original` | `original` |
| `mixed` | `original_with_english_context` |
| `preview` | `preview` |
| `off` | `off` |

### Step 1: Determine the requested mode

If the user provided an argument, map it to the canonical value. If no argument, show the current mode.

### Step 2: Show current mode (no argument)

```bash
node --input-type=module --eval "
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { getDataDir } = await import(ROOT + '/scripts/lib/paths.mjs');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(getDataDir(), 'config.json'), 'utf8')); } catch {}
console.log('[my-lingo] Current mode: ' + (cfg.execution_mode || 'english_optimized (default)'));
console.log('');
console.log('Available modes:');
console.log('  english_optimized          — translate + optimize prompt to English (default)');
console.log('  original_with_english_context — keep original, add English reference');
console.log('  original                   — record only, no optimization');
console.log('  preview                    — show optimization preview (alias for english_optimized in v0.1)');
console.log('  off                        — disable My Lingo completely');
"
```

### Step 3: Switch mode (with argument)

Map the user's input to a canonical mode, then write it:

```bash
# Example: switching to 'off'
# Replace 'english_optimized' below with the canonical mode value

NEW_MODE="english_optimized"  # set from user argument

node --input-type=module --eval "
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { getDataDir } = await import(ROOT + '/scripts/lib/paths.mjs');

const ALIASES = {
  english: 'english_optimized',
  english_optimized: 'english_optimized',
  raw: 'original',
  original: 'original',
  mixed: 'original_with_english_context',
  preview: 'preview',
  off: 'off',
};

const requested = process.argv[1];
const canonical = ALIASES[requested];
if (!canonical) {
  console.error('Unknown mode: ' + requested);
  console.error('Valid modes: ' + Object.keys(ALIASES).join(', '));
  process.exit(1);
}

const dataDir = getDataDir();
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')); } catch {}
cfg.execution_mode = canonical;

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const tmp = path.join(dataDir, 'config.json.tmp');
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
fs.renameSync(tmp, path.join(dataDir, 'config.json'));
console.log('[my-lingo] Mode switched to: ' + canonical);
" "$NEW_MODE"
```
