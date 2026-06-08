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

node --input-type=module --eval "
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { readRecentTurns } = await import(ROOT + '/scripts/lib/storage.mjs');
const n = parseInt(process.argv[1]) || 5;

// Most recent n turns, newest first (storage returns DESC by id).
const turns = readRecentTurns(n);

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
