---
name: use
description: Switch active language space.
argument-hint: "<space-key>"
allowed-tools: Bash, Read
---

## Workflow

Switch the active language space to the specified key.

### Step 1: Normalize the argument

Take `$ARGUMENTS`, lowercase it, trim whitespace.

### Step 2: Switch space

```bash
# Replace SPACE_KEY_HERE with the normalized lowercase space key from $ARGUMENTS
SPACE_KEY="SPACE_KEY_HERE"

node --input-type=module --eval "
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { loadSpaces, setActiveSpace } = await import(ROOT + '/scripts/lib/config.mjs');

const key = process.argv[1];
const spaces = loadSpaces();
if (!spaces.spaces[key]) {
  console.error('[my-lingo] Space not found: ' + key);
  console.error('Available spaces: ' + Object.keys(spaces.spaces).join(', '));
  console.error('Create a new space first by adding it to spaces.json.');
  process.exit(1);
}

setActiveSpace(key);
console.log('[my-lingo] Switched active space to: ' + key);
console.log('  Name: ' + (spaces.spaces[key].display_name || key));
console.log('  Target language: ' + (spaces.spaces[key].target_language || 'en'));
" "$SPACE_KEY"
```

If the space is not found, show the available spaces and suggest the user create a new one.
