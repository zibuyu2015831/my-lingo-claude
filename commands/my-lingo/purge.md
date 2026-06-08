---
name: purge
description: Clear learning data for current language space (requires confirmation).
argument-hint: "[--all] [--keep-config]"
allowed-tools: Bash, Read
---

## Workflow

Clear My Lingo learning data. Requires explicit "yes" confirmation before deleting anything.

### Step 1: Determine scope from arguments

Parse `$ARGUMENTS`:
- `--all` → delete all spaces' learning data + turns directory
- `--keep-config` → preserve config.json and spaces.json
- Default (no flags) → delete learning data for the active space only

### Step 2: Show what will be deleted

```bash
# Set flags based on parsed arguments (replace placeholders below)
ALL_FLAG=""      # set to "--all" if --all was in $ARGUMENTS
KEEP_CONFIG=""   # set to "--keep-config" if --keep-config was in $ARGUMENTS

node --input-type=module --eval "
import { loadSpaces } from './scripts/lib/config.mjs';
const allFlag = process.argv[1] === '--all';
const keepConfig = process.argv[2] === '--keep-config';

let activeSpace = 'english';
try { const s = loadSpaces(); if (s.active) activeSpace = s.active; } catch {}

console.log('[my-lingo] Purge — data to be deleted:');
console.log('');
if (allFlag) {
  console.log('  ALL learning data (corrections + items, every space)');
  console.log('  ALL turn records');
  console.log('  ALL Claude response records');
  if (!keepConfig) console.log('  ALL session summaries');
} else {
  console.log('  learning data for space \"' + activeSpace + '\" (corrections + items)');
}
console.log('');
console.log('Config and spaces configuration will be preserved.');
console.log('');
console.log('Type \"yes\" to confirm deletion, or anything else to cancel.');
" "$ALL_FLAG" "$KEEP_CONFIG"
```

### Step 3: Wait for user confirmation

Ask the user to type **"yes"** to confirm. If the user types anything other than "yes", cancel and do nothing.

### Step 4: Execute deletion (only after user confirms "yes")

```bash
# Set based on user's confirmed arguments
ALL_FLAG=""
KEEP_CONFIG=""

node --input-type=module --eval "
import fs from 'node:fs';
import path from 'node:path';
import { loadSpaces } from './scripts/lib/config.mjs';
import { getDataDir } from './scripts/lib/paths.mjs';
import { purgeSpace, purgeAll } from './scripts/lib/storage.mjs';

const allFlag = process.argv[1] === '--all';
const keepConfig = process.argv[2] === '--keep-config';

let activeSpace = 'english';
try { const s = loadSpaces(); if (s.active) activeSpace = s.active; } catch {}

const deleted = [];
if (allFlag) {
  purgeAll({ keepSessions: keepConfig });
  deleted.push('all turns, responses, corrections, items' + (keepConfig ? '' : ', sessions'));
  // Best-effort: remove any leftover legacy JSONL directories from pre-v0.5.
  const dataDir = getDataDir();
  for (const d of ['turns', 'responses', 'learning', 'sessions']) {
    try { fs.rmSync(path.join(dataDir, d), { recursive: true, force: true }); } catch {}
  }
} else {
  purgeSpace(activeSpace);
  deleted.push('learning data for space \"' + activeSpace + '\"');
}

console.log('[my-lingo] Deleted: ' + deleted.join(', '));
console.log('Data cleared. Config and spaces configuration preserved.');
" "$ALL_FLAG" "$KEEP_CONFIG"
```
