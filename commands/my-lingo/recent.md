---
name: recent
description: Show the most recent N prompt optimization turns (default 5).
argument-hint: "[n]"
allowed-tools: Bash, Read
---

## Workflow

Show the most recent prompt optimization turns recorded by My Lingo.

### Step 1: Determine N

Parse `$ARGUMENTS` — take the first integer, clamp to 1–50, default to 5 if not provided.

### Step 2: Read and display recent turns

```bash
# Replace N_VALUE with the parsed integer (default 5)
N_VALUE=5

node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data');
const dataDir = path.join(base, 'my-lingo');
const n = parseInt(process.argv[1]) || 5;

// Read turn dates in descending order
let dates = [];
try {
  const turnsDir = path.join(dataDir, 'turns');
  if (fs.existsSync(turnsDir)) {
    dates = fs.readdirSync(turnsDir).filter(f => f.endsWith('.jsonl')).map(f => f.replace('.jsonl', '')).sort().reverse();
  }
} catch {}

// Collect most recent n turns
const turns = [];
for (const date of dates) {
  try {
    const file = path.join(dataDir, 'turns', date + '.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const dayTurns = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    for (const t of dayTurns) {
      turns.push(t);
      if (turns.length >= n) break;
    }
  } catch {}
  if (turns.length >= n) break;
}

if (turns.length === 0) {
  console.log('[my-lingo] No turns recorded yet.');
  console.log('Turns are recorded automatically when My Lingo optimizes your prompts.');
  process.exit(0);
}

console.log('[my-lingo] Recent Turns (most recent first)');
console.log('');
turns.forEach((t, i) => {
  const ts = t.ts ? new Date(t.ts).toLocaleString() : 'unknown';
  const mode = t.mode || 'unknown';
  const lang = t.detected_language || '?';
  const orig = (t.original_prompt || '').slice(0, 80) + ((t.original_prompt || '').length > 80 ? '…' : '');
  const exec = t.execution_prompt ? (t.execution_prompt.slice(0, 80) + (t.execution_prompt.length > 80 ? '…' : '')) : '(none)';
  console.log((i + 1) + '. [' + ts + '] mode=' + mode + ' lang=' + lang);
  console.log('   Original:  ' + orig);
  console.log('   Optimized: ' + exec);
  console.log('');
});
" "$N_VALUE"
```
