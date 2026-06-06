---
name: profile
description: Show your language learning profile and improvement trends.
allowed-tools: Bash, Read, Glob
---

## Workflow

Display a comprehensive language learning profile with statistics and improvement trends.

### Step 1: Gather statistics

```bash
node --input-type=module << 'EOF'
import { loadConfig, loadSpaces, getActiveSpace } from './scripts/lib/config.mjs'
import {
  listCorrectionMonths, readCorrections, readTurnsLastNDays,
  listItemMonths, readLearningItems, readItemsDue,
} from './scripts/lib/storage.mjs'

const config = loadConfig(process.cwd())
const spaces = loadSpaces()
const space = getActiveSpace(spaces)
const spaceKey = spaces.active || 'english'

// Last 30 days corrections
const now = new Date()
const cutoff30 = new Date(now)
cutoff30.setDate(cutoff30.getDate() - 30)
const cutoff7 = new Date(now)
cutoff7.setDate(cutoff7.getDate() - 7)
const cutoff14 = new Date(now)
cutoff14.setDate(cutoff14.getDate() - 14)

const cutoff30Month = cutoff30.toISOString().slice(0, 7)
const allCorrMonths = listCorrectionMonths(spaceKey)
const relevantMonths = allCorrMonths.filter(m => m >= cutoff30Month)
const corrections30 = readCorrections(spaceKey, relevantMonths)

// Pattern frequency analysis
const patternCount = new Map()
for (const c of corrections30) {
  const pattern = c.pattern || c.type || 'unknown'
  patternCount.set(pattern, (patternCount.get(pattern) || 0) + 1)
}
const topPatterns = [...patternCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

// Recent 7 days vs prior 7 days
const turns30 = readTurnsLastNDays(30)
const turns7 = turns30.filter(t => new Date(t.ts) >= cutoff7)
const turns14to7 = turns30.filter(t => {
  const d = new Date(t.ts)
  return d >= cutoff14 && d < cutoff7
})
const corr7 = corrections30.filter(c => new Date(c.ts) >= cutoff7)
const corr14to7 = corrections30.filter(c => {
  const d = new Date(c.ts)
  return d >= cutoff14 && d < cutoff7
})

const rate7 = turns7.length > 0 ? (corr7.length / turns7.length * 100).toFixed(1) : '0.0'
const rate14to7 = turns14to7.length > 0 ? (corr14to7.length / turns14to7.length * 100).toFixed(1) : '0.0'
const trend = parseFloat(rate7) < parseFloat(rate14to7) ? '↓ Improving' :
              parseFloat(rate7) > parseFloat(rate14to7) ? '↑ More errors' : '→ Stable'

// Learning items statistics
const itemMonths = listItemMonths(spaceKey)
const relevantItemMonths = itemMonths.filter(m => m >= cutoff30Month)
const allItems = readLearningItems(spaceKey, relevantItemMonths)
const dueItems = readItemsDue(spaceKey)
const reviewedItems = allItems.filter(i => i.review_count && i.review_count > 0)

// Turns statistics
const optimized30 = turns30.filter(t => t.execution_prompt && !t.fallback)
const fallback30 = turns30.filter(t => t.fallback)
const optimizeRate = turns30.length > 0 ? (optimized30.length / turns30.length * 100).toFixed(1) : '0.0'
const fallbackRate = turns30.length > 0 ? (fallback30.length / turns30.length * 100).toFixed(1) : '0.0'

const today = now.toISOString().slice(0, 10)
console.log('')
console.log('╔══════════════════════════════════════════╗')
console.log('║      My Lingo — Language Profile         ║')
console.log('╚══════════════════════════════════════════╝')
console.log('')
console.log(`Space: ${space.display_name || spaceKey}  |  Level: ${space.level || 'intermediate'}`)
console.log(`Report date: ${today}  |  Window: last 30 days`)
console.log('')
console.log('── Activity ─────────────────────────────────')
console.log(`  Total turns:     ${turns30.length}`)
console.log(`  Optimized:       ${optimized30.length} (${optimizeRate}%)`)
console.log(`  Fallback rate:   ${fallbackRate}%`)
console.log(`  Corrections:     ${corrections30.length}`)
console.log('')
console.log('── Error Trend (7-day comparison) ───────────')
console.log(`  Last 7 days:     ${corr7.length} corrections in ${turns7.length} turns (${rate7}%)`)
console.log(`  Prior 7 days:    ${corr14to7.length} corrections in ${turns14to7.length} turns (${rate14to7}%)`)
console.log(`  Trend:           ${trend}`)
console.log('')
console.log('── Top Error Patterns ───────────────────────')
if (topPatterns.length === 0) {
  console.log('  No errors recorded yet. Keep up the good work!')
} else {
  for (const [pattern, count] of topPatterns) {
    console.log(`  ${count}x  ${pattern}`)
  }
}
console.log('')
console.log('── Learning Items ───────────────────────────')
console.log(`  Total items:     ${allItems.length}`)
console.log(`  Reviewed:        ${reviewedItems.length}`)
console.log(`  Due now:         ${dueItems.length}`)
console.log('')
EOF
```

### Step 2: Present the profile

Display the statistics from Step 1. If the error trend shows improvement, congratulate the user. If items are due for review, suggest running `/my-lingo:review`.
