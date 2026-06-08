---
name: last
description: Show the most recent prompt optimization — original input and execution prompt.
allowed-tools: Bash, Read, Glob
---

## Workflow

Show the most recent non-skipped prompt optimization from today (or yesterday if today is empty).

### Step 1: Read recent turns

```bash
node --input-type=module --eval "
import { readRecentTurns } from './scripts/lib/storage.mjs';

// Newest turns first (DESC by id); a window of 20 comfortably spans the most
// recent activity regardless of day boundary.
const turns = readRecentTurns(20);

if (!turns.length) {
  console.log('[my-lingo] No turns recorded yet. Start using Claude Code to build history.');
  process.exit(0);
}

// get most recent non-raw, non-original record (turns already newest-first)
const record = turns.find(r => r.mode !== 'raw' && r.mode !== 'original') || turns[0];

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
