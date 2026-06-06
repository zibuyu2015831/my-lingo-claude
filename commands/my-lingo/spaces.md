---
name: spaces
description: List all configured language spaces with stats.
allowed-tools: Bash, Read, Glob
---

## Workflow

List all configured language spaces with their turns and corrections statistics.

### Step 1: Read all spaces and stats

```bash
node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data');
const dataDir = path.join(base, 'my-lingo');

// Load spaces
let spaces = { active: 'english', spaces: { english: { key: 'english', display_name: 'English', target_language: 'en', native_language: 'zh-CN', level: 'intermediate' } } };
try { const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8')); if (raw.active && raw.spaces) spaces = raw; } catch {}

// Count turns per space
const turnCounts = {};
try {
  const turnsDir = path.join(dataDir, 'turns');
  if (fs.existsSync(turnsDir)) {
    fs.readdirSync(turnsDir).filter(f => f.endsWith('.jsonl')).forEach(f => {
      try {
        const lines = fs.readFileSync(path.join(turnsDir, f), 'utf8').split('\n').filter(Boolean);
        lines.forEach(l => { try { const r = JSON.parse(l); const sp = r.language_space || 'english'; turnCounts[sp] = (turnCounts[sp] || 0) + 1; } catch {} });
      } catch {}
    });
  }
} catch {}

// Count corrections per space
const corrCounts = {};
try {
  const learnDir = path.join(dataDir, 'learning');
  if (fs.existsSync(learnDir)) {
    fs.readdirSync(learnDir).forEach(sp => {
      const spDir = path.join(learnDir, sp);
      if (!fs.statSync(spDir).isDirectory()) return;
      let count = 0;
      fs.readdirSync(spDir).filter(f => f.startsWith('corrections-') && f.endsWith('.jsonl')).forEach(f => {
        try { count += fs.readFileSync(path.join(spDir, f), 'utf8').split('\n').filter(Boolean).length; } catch {}
      });
      corrCounts[sp] = count;
    });
  }
} catch {}

const active = spaces.active;
const spaceKeys = Object.keys(spaces.spaces);
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
