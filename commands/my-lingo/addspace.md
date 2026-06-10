---
name: addspace
description: Create a new language space and switch to it.
argument-hint: "<key> [target_language] [native_language]"
allowed-tools: Bash, Read
---

## Workflow

Create a new language space (e.g. a Japanese-learning track separate from English)
and make it the active space. The default `english` space always exists; this adds
additional target-language tracks.

### Step 1: Parse the arguments

From `$ARGUMENTS`, take the first token as the space key (lowercase it), the
optional second token as the target language code (e.g. `ja`, `de`, `fr`; default
`en`), and the optional third token as the native language code (default `zh-CN`).

### Step 2: Create and switch

```bash
# Replace the three values below from $ARGUMENTS (KEY is required).
KEY="KEY_HERE"
TARGET_LANG="en"      # e.g. ja, de, fr
NATIVE_LANG="zh-CN"

node --input-type=module --eval "
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { addSpace, setActiveSpace } = await import(ROOT + '/scripts/lib/config.mjs');

const key = (process.argv[1] || '').trim().toLowerCase();
const targetLang = (process.argv[2] || 'en').trim();
const nativeLang = (process.argv[3] || 'zh-CN').trim();
if (!key) {
  console.error('Usage: /my-lingo:addspace <key> [target_language] [native_language]');
  process.exit(1);
}

const space = addSpace(key, { target_language: targetLang, native_language: nativeLang });
setActiveSpace(key);
console.log('[my-lingo] Created and switched to space: ' + key);
console.log('  Name:            ' + (space.display_name || key));
console.log('  Target language: ' + space.target_language);
console.log('  Native language: ' + space.native_language);
console.log('');
console.log('List spaces with /my-lingo:spaces, switch with /my-lingo:use <key>.');
" "$KEY" "$TARGET_LANG" "$NATIVE_LANG"
```

If the data directory cannot be resolved (the plugin has never recorded a turn
yet), the command fails loudly — send one message to Claude first so the hook
writes the install pointer, then retry.
