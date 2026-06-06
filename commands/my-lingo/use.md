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

node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data');
const dataDir = path.join(base, 'my-lingo');
const spacesPath = path.join(dataDir, 'spaces.json');

let spaces = { active: 'english', spaces: { english: { key: 'english', display_name: 'English', target_language: 'en', native_language: 'zh-CN', level: 'intermediate', display_mode: 'compact', auto_generate_learning: true } } };
try { const raw = JSON.parse(fs.readFileSync(spacesPath, 'utf8')); if (raw.active && raw.spaces) spaces = raw; } catch {}

const key = process.argv[1];
if (!spaces.spaces[key]) {
  console.error('[my-lingo] Space not found: ' + key);
  console.error('Available spaces: ' + Object.keys(spaces.spaces).join(', '));
  console.error('Create a new space first using /my-lingo:setup or by adding it to spaces.json.');
  process.exit(1);
}

spaces.active = key;
const tmp = spacesPath + '.tmp';
fs.mkdirSync(path.dirname(spacesPath), { recursive: true });
fs.writeFileSync(tmp, JSON.stringify(spaces, null, 2), { mode: 0o600 });
fs.renameSync(tmp, spacesPath);
console.log('[my-lingo] Switched active space to: ' + key);
console.log('  Name: ' + (spaces.spaces[key].display_name || key));
console.log('  Target language: ' + (spaces.spaces[key].target_language || 'en'));
" "$SPACE_KEY"
```

If the space is not found, show the available spaces and suggest the user create a new one.
