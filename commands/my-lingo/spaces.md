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
import { loadSpaces } from './scripts/lib/config.mjs';
import { countTurnsForSpace, countCorrectionsForSpace } from './scripts/lib/storage.mjs';

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
console.log('Switch spaces with: /my-lingo:use <space-key>');
"
```
