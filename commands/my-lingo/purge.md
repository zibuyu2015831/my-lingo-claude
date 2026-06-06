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

node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data');
const dataDir = path.join(base, 'my-lingo');
const allFlag = process.argv[1] === '--all';
const keepConfig = process.argv[2] === '--keep-config';

let activeSpace = 'english';
try {
  const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8'));
  if (s.active) activeSpace = s.active;
} catch {}

console.log('[my-lingo] Purge — data to be deleted:');
console.log('');
if (allFlag) {
  console.log('  learning/ (ALL spaces)');
  console.log('  turns/ (all turn records)');
  if (!keepConfig) {
    console.log('  sessions/ (all session records)');
  }
} else {
  console.log('  learning/' + activeSpace + '/ (corrections and learning items)');
}
if (!keepConfig) {
  // Config and spaces.json preserved by default unless --all without --keep-config
  // (in default mode, config is always preserved)
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

node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data');
const dataDir = path.join(base, 'my-lingo');
const allFlag = process.argv[1] === '--all';
const keepConfig = process.argv[2] === '--keep-config';

let activeSpace = 'english';
try {
  const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8'));
  if (s.active) activeSpace = s.active;
} catch {}

let deleted = [];

if (allFlag) {
  // Delete all learning data
  const learningDir = path.join(dataDir, 'learning');
  if (fs.existsSync(learningDir)) {
    fs.rmSync(learningDir, { recursive: true, force: true });
    deleted.push('learning/ (all spaces)');
  }
  // Delete turns
  const turnsDir = path.join(dataDir, 'turns');
  if (fs.existsSync(turnsDir)) {
    fs.rmSync(turnsDir, { recursive: true, force: true });
    deleted.push('turns/');
  }
  // Delete sessions unless --keep-config
  if (!keepConfig) {
    const sessionsDir = path.join(dataDir, 'sessions');
    if (fs.existsSync(sessionsDir)) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
      deleted.push('sessions/');
    }
  }
} else {
  // Delete active space learning data only
  const spaceDir = path.join(dataDir, 'learning', activeSpace);
  if (fs.existsSync(spaceDir)) {
    fs.rmSync(spaceDir, { recursive: true, force: true });
    deleted.push('learning/' + activeSpace + '/');
  }
}

if (deleted.length === 0) {
  console.log('[my-lingo] Nothing to delete — directories did not exist.');
} else {
  console.log('[my-lingo] Deleted: ' + deleted.join(', '));
  console.log('Data cleared. Config and spaces configuration preserved.');
}
" "$ALL_FLAG" "$KEEP_CONFIG"
```
