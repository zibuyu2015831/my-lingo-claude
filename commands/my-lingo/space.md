---
name: space
description: Show current language space configuration and learning stats.
allowed-tools: Bash, Read
---

## Workflow

Show the current language space configuration, including turns and corrections statistics.

### Step 1: Read current active space

```bash
node --input-type=module --eval "
const ROOT = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();
const { loadSpaces } = await import(ROOT + '/scripts/lib/config.mjs');
const { countTurnsForSpace, countCorrectionsForSpace } = await import(ROOT + '/scripts/lib/storage.mjs');

// Load spaces
let spaces = { active: 'english', spaces: { english: { key: 'english', display_name: 'English', target_language: 'en', native_language: 'zh-CN', level: 'intermediate', display_mode: 'compact', auto_generate_learning: true } } };
try { const raw = loadSpaces(); if (raw.active && raw.spaces) spaces = raw; } catch {}

const active = spaces.active || 'english';
const space = spaces.spaces[active] || {};

// Count turns and corrections for this space
const turnCount = countTurnsForSpace(active);
const corrCount = countCorrectionsForSpace(active);

console.log('[my-lingo] Current Language Space');
console.log('');
console.log('  Key:             ' + active);
console.log('  Name:            ' + (space.display_name || active));
console.log('  Target language: ' + (space.target_language || 'en'));
console.log('  Native language: ' + (space.native_language || 'zh-CN'));
console.log('  Level:           ' + (space.level || 'intermediate'));
console.log('  Display mode:    ' + (space.display_mode || 'compact'));
console.log('  Auto learning:   ' + (space.auto_generate_learning !== false ? 'enabled' : 'disabled'));
console.log('');
console.log('  Turns recorded:  ' + turnCount);
console.log('  Corrections:     ' + corrCount);
"
```
