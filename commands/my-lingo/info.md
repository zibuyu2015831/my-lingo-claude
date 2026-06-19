---
name: info
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
import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { readTurnsForDay, countTotalTurns, getDataDir } = await import(ROOT + '/scripts/lib/storage.mjs');

const dataDir = getDataDir();

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')); } catch {}

let spaces = { active: 'english' };
try { spaces = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8')); } catch {}

// API credentials: plugin config (CLAUDE_PLUGIN_OPTION_*) wins over MY_LINGO_* env,
// matching loadConfig()'s Layer 0 precedence. Returns [value, source].
function pick(opt, env) {
  const o = process.env[opt];
  if (o && o.trim()) return [o, 'plugin config'];
  const e = process.env[env];
  if (e && e.trim()) return [e, 'env'];
  return [undefined, null];
}
const [apiKey,     keySrc] = pick('CLAUDE_PLUGIN_OPTION_API_KEY',      'MY_LINGO_API_KEY');
const [apiBaseUrl, urlSrc] = pick('CLAUDE_PLUGIN_OPTION_API_BASE_URL', 'MY_LINGO_API_BASE_URL');
const [modelFast,  fastSrc] = pick('CLAUDE_PLUGIN_OPTION_MODEL_FAST',  'MY_LINGO_MODEL_FAST');

function fmt(val, src) {
  return val ? val + '  (' + src + ')' : '(not set) — run /my-lingo:setup';
}

const today = new Date().toISOString().slice(0, 10);
const turns = readTurnsForDay(today);

const optimized = turns.filter(r => r.execution_prompt && !r.fallback);
const translated = turns.filter(r => r.detected_language !== 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original');
const corrected  = turns.filter(r => r.detected_language === 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original');
const fallbacks  = turns.filter(r => r.fallback);

const total = countTotalTurns();

const apiKeyDisplay = apiKey ? '****' + apiKey.slice(-4) + '  (' + keySrc + ')' : '(not set) — run /my-lingo:setup';

console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║         My Lingo — Status            ║');
console.log('╚══════════════════════════════════════╝');
console.log('');
console.log('Configuration:');
console.log('  Mode:        ' + (cfg.execution_mode || 'english_optimized'));
console.log('  Language:    ' + (cfg.native_language || 'zh-CN'));
console.log('  Space:       ' + (spaces.active || 'english'));
console.log('  Model:       ' + fmt(modelFast, fastSrc));
console.log('  API URL:     ' + fmt(apiBaseUrl, urlSrc));
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
