---
name: sentences
description: Show common sentence patterns from current language space.
argument-hint: "[--days 30]"
allowed-tools: Bash, Read, Glob
---

## Workflow

Display recorded sentence patterns from your interactions.

### Step 1: Read sentence pattern items

```bash
node --input-type=module << 'EOF'
import { loadConfig, loadSpaces, getActiveSpace } from './scripts/lib/config.mjs'
import { listItemMonths, readLearningItems } from './scripts/lib/storage.mjs'

const args = process.argv.slice(2)
const daysIdx = args.indexOf('--days')
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 30 : 30

const config = loadConfig(process.cwd())
const spaces = loadSpaces()
const space = getActiveSpace(spaces)
const spaceKey = spaces.active || 'english'

const months = listItemMonths(spaceKey)
const cutoff = new Date()
cutoff.setDate(cutoff.getDate() - days)
const cutoffMonth = cutoff.toISOString().slice(0, 7)
const relevantMonths = months.filter(m => m >= cutoffMonth)

const allItems = readLearningItems(spaceKey, relevantMonths)
const patterns = allItems.filter(item => item.type === 'sentence_pattern')

if (patterns.length === 0) {
  console.log('No sentence patterns recorded yet. Keep using My Lingo to build your pattern library!')
  process.exit(0)
}

// Deduplicate by target_text
const seen = new Set()
const unique = patterns.filter(item => {
  if (seen.has(item.target_text)) return false
  seen.add(item.target_text)
  return true
})

console.log(`\n📝 Sentence Patterns — ${space.display_name || spaceKey} (last ${days} days)\n`)
for (const item of unique) {
  const reviews = item.review_count != null ? item.review_count : 0
  const status = item.next_review ? '✓' : '○'
  console.log(`  ${status} ${item.target_text}`)
  if (item.native_explanation) {
    console.log(`    ${item.native_explanation}`)
  }
  console.log(`    Reviews: ${reviews}`)
}
console.log('')
EOF
```
