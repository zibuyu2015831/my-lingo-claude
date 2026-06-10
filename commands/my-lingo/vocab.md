---
name: vocab
description: Show high-frequency vocabulary from current language space.
argument-hint: "[--days 30] [--top 20]"
allowed-tools: Bash, Read, Glob
---

## Workflow

Display the most frequent vocabulary items recorded from your interactions.

### Step 1: Parse arguments and read vocabulary items

```bash
node --input-type=module << 'EOF'
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { loadConfig, loadSpaces, getActiveSpace } = await import(ROOT + '/scripts/lib/config.mjs')
const { listItemMonths, readLearningItems } = await import(ROOT + '/scripts/lib/storage.mjs')

const args = process.argv.slice(2)
const daysIdx = args.indexOf('--days')
const topIdx = args.indexOf('--top')
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 30 : 30
const topN = topIdx >= 0 ? parseInt(args[topIdx + 1]) || 20 : 20

const config = loadConfig(process.cwd())
const spaces = loadSpaces()
const space = getActiveSpace(spaces)
const spaceKey = spaces.active || 'english'

// Compute months to include
const months = listItemMonths(spaceKey)
const cutoff = new Date()
cutoff.setDate(cutoff.getDate() - days)
const cutoffMonth = cutoff.toISOString().slice(0, 7)
const relevantMonths = months.filter(m => m >= cutoffMonth)

const allItems = readLearningItems(spaceKey, relevantMonths)
const phrases = allItems.filter(item => item.type === 'phrase')

// Deduplicate by target_text, count frequency
const freq = new Map()
for (const item of phrases) {
  const key = item.target_text
  if (!freq.has(key)) {
    freq.set(key, { ...item, count: 0 })
  }
  freq.get(key).count++
}

const sorted = [...freq.values()].sort((a, b) => b.count - a.count).slice(0, topN)

if (sorted.length === 0) {
  console.log('No vocabulary recorded yet. Keep using My Lingo to build your vocabulary list!')
  process.exit(0)
}

console.log(`\n📚 Top ${sorted.length} Vocabulary — ${space.display_name || spaceKey} (last ${days} days)\n`)
for (const item of sorted) {
  const reviews = item.review_count != null ? item.review_count : 0
  const status = item.next_review ? '✓' : '○'
  console.log(`  ${status} ${item.target_text}`)
  if (item.native_explanation) {
    console.log(`    ${item.native_explanation}`)
  }
  console.log(`    Seen: ${item.count}x | Reviews: ${reviews}`)
}
console.log('')
EOF
```
