---
name: errors
description: Show common language errors from the last 30 days in current language space.
allowed-tools: Bash, Read, Glob
---

## Workflow

Show the most common language errors from the current language space, aggregated from the last 30 days.

### Step 1: Read corrections and aggregate by pattern

```bash
node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data');
const dataDir = path.join(base, 'my-lingo');

// Get active space
let activeSpace = 'english';
try {
  const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8'));
  if (s.active) activeSpace = s.active;
} catch {}

// Compute last 30 days of months (YYYY-MM format)
const months = new Set();
const now = new Date();
for (let i = 0; i < 30; i++) {
  const d = new Date(now);
  d.setDate(d.getDate() - i);
  months.add(d.toISOString().slice(0, 7));
}
const monthList = Array.from(months);

// Read all corrections for this space
const corrections = [];
const learnDir = path.join(dataDir, 'learning', activeSpace);
for (const month of monthList) {
  try {
    const file = path.join(learnDir, 'corrections-' + month + '.jsonl');
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      try { corrections.push(JSON.parse(l)); } catch {}
    }
  } catch {}
}

if (corrections.length === 0) {
  console.log('[my-lingo] No corrections recorded yet.');
  console.log('Corrections are written after each session ends (when analysis runs).');
  process.exit(0);
}

// Aggregate by pattern, take top 10
const patternMap = {};
for (const c of corrections) {
  const key = c.pattern || c.type || 'other';
  if (!patternMap[key]) patternMap[key] = { count: 0, examples: [] };
  patternMap[key].count++;
  if (patternMap[key].examples.length < 2) {
    patternMap[key].examples.push({ original: c.original, corrected: c.corrected });
  }
}

const sorted = Object.entries(patternMap).sort((a, b) => b[1].count - a[1].count).slice(0, 10);

console.log('[my-lingo] Common Errors — ' + activeSpace + ' (last 30 days)');
console.log('Total corrections: ' + corrections.length);
console.log('');
sorted.forEach(([pattern, data], i) => {
  console.log((i + 1) + '. ' + pattern + ' ×' + data.count);
  for (const ex of data.examples) {
    console.log('   ' + (ex.original || '?') + ' → ' + (ex.corrected || '?'));
  }
  console.log('');
});
"
```
