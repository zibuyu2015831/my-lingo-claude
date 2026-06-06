---
name: last
description: Show the most recent prompt optimization — original input and execution prompt.
allowed-tools: Bash, Read, Glob
---

## Workflow

Show the most recent non-skipped prompt optimization from today (or yesterday if today is empty).

### Step 1: Read recent turns

```bash
node -e "
const fs = require('fs');
const path = require('path');

const dataDir = process.env.CLAUDE_PLUGIN_DATA
  ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'my-lingo')
  : path.join(require('os').homedir(), '.claude', 'plugins', 'data', 'my-lingo');

function readDay(date) {
  try {
    const file = path.join(dataDir, 'turns', date + '.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

const today = new Date().toISOString().slice(0, 10);
let turns = readDay(today);

if (!turns.length) {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  turns = readDay(yesterday);
}

if (!turns.length) {
  console.log('[my-lingo] No turns recorded yet. Start using Claude Code to build history.');
  process.exit(0);
}

// get last non-raw, non-original record
const record = turns.slice().reverse().find(r => r.mode !== 'raw' && r.mode !== 'original') || turns[turns.length - 1];

console.log('');
console.log('── My Lingo: Last Optimization ──────────────────────');
console.log('Time:       ' + record.ts);
console.log('Mode:       ' + record.mode);
console.log('Language:   ' + record.detected_language);
console.log('Fallback:   ' + record.fallback);
if (record.latency_ms) console.log('Latency:    ' + record.latency_ms + 'ms');
console.log('');
console.log('Original:');
console.log('  ' + (record.original_prompt || '(none)'));
console.log('');
if (record.execution_prompt) {
  console.log('Optimized:');
  console.log('  ' + record.execution_prompt);
  if (record.rewrite_type) console.log('');
  if (record.rewrite_type) console.log('Rewrite type: ' + record.rewrite_type);
} else {
  console.log('(No optimized prompt — fallback or original mode)');
}
console.log('──────────────────────────────────────────────────────');
"
```
