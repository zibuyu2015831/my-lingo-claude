---
name: status
description: Show current My Lingo status, configuration, and today's stats.
allowed-tools: Bash, Read, Glob
---

## Workflow

Display the current My Lingo configuration and today's optimization statistics.

### Step 1: Load configuration and display status

```bash
node --input-type=module --eval "
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();
const { readTurnsForDay, countTotalTurns, getDataDir } = await import(ROOT + '/scripts/lib/storage.mjs');

const dataDir = getDataDir();

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')); } catch {}

let spaces = { active: 'english' };
try { spaces = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8')); } catch {}

// API credentials come exclusively from environment variables
const apiKey     = process.env.MY_LINGO_API_KEY;
const apiBaseUrl = process.env.MY_LINGO_API_BASE_URL;
const modelFast  = process.env.MY_LINGO_MODEL_FAST;

function fmt(val) {
  return val ? val + '  (env)' : '(not set) — run /my-lingo:setup';
}

const today = new Date().toISOString().slice(0, 10);
const turns = readTurnsForDay(today);

const optimized = turns.filter(r => r.execution_prompt && !r.fallback);
const translated = turns.filter(r => r.detected_language !== 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original');
const corrected  = turns.filter(r => r.detected_language === 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original');
const fallbacks  = turns.filter(r => r.fallback);

const total = countTotalTurns();

const apiKeyDisplay = apiKey ? '****' + apiKey.slice(-4) + '  (env)' : '(not set) — run /my-lingo:setup';

console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║         My Lingo — Status            ║');
console.log('╚══════════════════════════════════════╝');
console.log('');
console.log('Configuration:');
console.log('  Mode:        ' + (cfg.execution_mode || 'english_optimized'));
console.log('  Language:    ' + (cfg.native_language || 'zh-CN'));
console.log('  Space:       ' + (spaces.active || 'english'));
console.log('  Model:       ' + fmt(modelFast));
console.log('  API URL:     ' + fmt(apiBaseUrl));
console.log('  API Key:     ' + apiKeyDisplay);
console.log('  Privacy:     ' + (cfg.privacy_mode || 'standard'));
console.log('');
console.log('Today (' + today + '):');
console.log('  Total turns:  ' + turns.length);
console.log('  Optimized:    ' + optimized.length);
console.log('  Translated:   ' + translated.length);
console.log('  Corrected:    ' + corrected.length);
console.log('  Fallbacks:    ' + fallbacks.length);
console.log('');
console.log('All time:');
console.log('  Total turns:  ' + total);
"
```
