---
name: spaces
description: List all configured language spaces with stats.
allowed-tools: Bash, Read, Glob
---

## Workflow

List all configured language spaces with their turns and corrections statistics.

### Step 1: Read all spaces and stats

```bash
node --input-type=module --eval "
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { loadSpaces } = await import(ROOT + '/scripts/lib/config.mjs');
const { countTurnsForSpace, countCorrectionsForSpace } = await import(ROOT + '/scripts/lib/storage.mjs');

// Load spaces
let spaces = { active: 'english', spaces: { english: { key: 'english', display_name: 'English', target_language: 'en', native_language: 'zh-CN', level: 'intermediate' } } };
try { const raw = loadSpaces(); if (raw.active && raw.spaces) spaces = raw; } catch {}

const active = spaces.active;
const spaceKeys = Object.keys(spaces.spaces);

// Count turns and corrections per configured space
const turnCounts = {};
const corrCounts = {};
for (const key of spaceKeys) {
  turnCounts[key] = countTurnsForSpace(key);
  corrCounts[key] = countCorrectionsForSpace(key);
}
console.log('[my-lingo] Language Spaces (' + spaceKeys.length + ' configured)');
console.log('');
spaceKeys.forEach(key => {
  const s = spaces.spaces[key];
  const marker = key === active ? ' ← active' : '';
  console.log('  ' + key + marker);
  console.log('    Name: ' + (s.display_name || key) + ' | Target: ' + (s.target_language || 'en') + ' | Level: ' + (s.level || 'intermediate'));
  console.log('    Turns: ' + (turnCounts[key] || 0) + ' | Corrections: ' + (corrCounts[key] || 0));
  console.log('');
});
console.log('Create a space with: /my-lingo:addspace <key> [target_language]');
console.log('Switch spaces with:  /my-lingo:use <space-key>');
console.log('Remove a space with: /my-lingo:rmspace <key>');
"
```
