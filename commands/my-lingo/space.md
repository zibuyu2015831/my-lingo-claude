---
name: space
description: Show current language space configuration and learning stats.
allowed-tools: Bash, Read
---

## Workflow

Show the current language space configuration, including turns and corrections statistics.

### Step 1: Read current active space

```bash
node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data');
const dataDir = path.join(base, 'my-lingo');

// Load spaces
let spaces = { active: 'english', spaces: { english: { key: 'english', display_name: 'English', target_language: 'en', native_language: 'zh-CN', level: 'intermediate', display_mode: 'compact', auto_generate_learning: true } } };
try { const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8')); if (raw.active && raw.spaces) spaces = raw; } catch {}

const active = spaces.active || 'english';
const space = spaces.spaces[active] || {};

// Count turns for this space
let turnCount = 0;
try {
  const turnsDir = path.join(dataDir, 'turns');
  if (fs.existsSync(turnsDir)) {
    fs.readdirSync(turnsDir).filter(f => f.endsWith('.jsonl')).forEach(f => {
      try {
        const lines = fs.readFileSync(path.join(turnsDir, f), 'utf8').split('\n').filter(Boolean);
        lines.forEach(l => { try { const r = JSON.parse(l); if (r.language_space === active) turnCount++; } catch {} });
      } catch {}
    });
  }
} catch {}

// Count corrections for this space (current month)
let corrCount = 0;
try {
  const learnDir = path.join(dataDir, 'learning', active);
  if (fs.existsSync(learnDir)) {
    fs.readdirSync(learnDir).filter(f => f.startsWith('corrections-') && f.endsWith('.jsonl')).forEach(f => {
      try {
        const lines = fs.readFileSync(path.join(learnDir, f), 'utf8').split('\n').filter(Boolean);
        corrCount += lines.length;
      } catch {}
    });
  }
} catch {}

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
