---
name: export
description: Export learning materials for current language space as Markdown.
argument-hint: "[--space <key>] [--months 3]"
allowed-tools: Bash, Read, Glob
---

## Workflow

Export all learning materials for the selected language space as Markdown to stdout.

### Step 1: Export learning materials

```bash
node --input-type=module << 'EOF'
import fs from 'node:fs'
import path from 'node:path'
const ROOT = process.env.CLAUDE_PLUGIN_ROOT || process.cwd()
const { loadConfig, loadSpaces, getActiveSpace } = await import(ROOT + '/scripts/lib/config.mjs')
const {
  listCorrectionMonths, readCorrections,
  listItemMonths, readLearningItems,
  getDataDir,
} = await import(ROOT + '/scripts/lib/storage.mjs')

const args = process.argv.slice(2)
const spaceIdx = args.indexOf('--space')
const monthsIdx = args.indexOf('--months')
const monthsCount = monthsIdx >= 0 ? parseInt(args[monthsIdx + 1]) || 3 : 3

const spaces = loadSpaces()
const requestedSpace = spaceIdx >= 0 ? args[spaceIdx + 1] : null
const spaceKey = requestedSpace || spaces.active || 'english'
const spaceData = (spaces.spaces || {})[spaceKey] || {}
const spaceName = spaceData.display_name || spaceKey.charAt(0).toUpperCase() + spaceKey.slice(1)

// Compute date range
const now = new Date()
const startDate = new Date(now)
startDate.setMonth(startDate.getMonth() - monthsCount)
const startMonth = startDate.toISOString().slice(0, 7)
const endMonth = now.toISOString().slice(0, 7)
const dateRange = `${startMonth} to ${endMonth}`

// Read corrections
const allCorrMonths = listCorrectionMonths(spaceKey).filter(m => m >= startMonth)
const corrections = readCorrections(spaceKey, allCorrMonths)

// Group corrections by pattern
const byPattern = new Map()
for (const c of corrections) {
  const key = c.pattern || c.type || 'general'
  if (!byPattern.has(key)) byPattern.set(key, [])
  byPattern.get(key).push(c)
}
const sortedPatterns = [...byPattern.entries()].sort((a, b) => b[1].length - a[1].length)

// Read learning items
const allItemMonths = listItemMonths(spaceKey).filter(m => m >= startMonth)
const allItems = readLearningItems(spaceKey, allItemMonths)
const phrases = allItems.filter(i => i.type === 'phrase')
const sentencePatterns = allItems.filter(i => i.type === 'sentence_pattern')

// Collect lesson files
const lessonDir = path.join(getDataDir(), 'learning', spaceKey)
let lessonFiles = []
try {
  if (fs.existsSync(lessonDir)) {
    lessonFiles = fs.readdirSync(lessonDir)
      .filter(f => f.match(/^lessons-\d{4}-\d{2}-\d{2}\.md$/))
      .filter(f => f >= `lessons-${startMonth}`)
      .sort()
  }
} catch {}

// Build Markdown output
const lines = []
lines.push(`# My Lingo Export — ${spaceName} Space (${dateRange})`)
lines.push('')

// Common Errors section
lines.push('## Common Errors')
lines.push('')
if (sortedPatterns.length === 0) {
  lines.push('_No corrections recorded in this period._')
  lines.push('')
} else {
  for (const [pattern, items] of sortedPatterns) {
    lines.push(`### ${pattern} (${items.length} occurrence${items.length !== 1 ? 's' : ''})`)
    lines.push('')
    for (const item of items.slice(0, 5)) {
      lines.push(`- Original: \`${item.original}\``)
      lines.push(`- Corrected: \`${item.corrected}\``)
      if (item.explanation) lines.push(`- Explanation: ${item.explanation}`)
      lines.push('')
    }
  }
}

// Vocabulary section
lines.push('## Vocabulary')
lines.push('')
if (phrases.length === 0) {
  lines.push('_No vocabulary recorded in this period._')
  lines.push('')
} else {
  const seen = new Set()
  for (const item of phrases) {
    if (seen.has(item.target_text)) continue
    seen.add(item.target_text)
    const explanation = item.native_explanation ? ` — ${item.native_explanation}` : ''
    lines.push(`- **${item.target_text}**${explanation}`)
  }
  lines.push('')
}

// Sentence Patterns section
lines.push('## Sentence Patterns')
lines.push('')
if (sentencePatterns.length === 0) {
  lines.push('_No sentence patterns recorded in this period._')
  lines.push('')
} else {
  const seen = new Set()
  for (const item of sentencePatterns) {
    if (seen.has(item.target_text)) continue
    seen.add(item.target_text)
    const explanation = item.native_explanation ? ` — ${item.native_explanation}` : ''
    lines.push(`- **${item.target_text}**${explanation}`)
  }
  lines.push('')
}

// Lessons section
lines.push('## Lessons')
lines.push('')
if (lessonFiles.length === 0) {
  lines.push('_No lessons recorded in this period._')
  lines.push('')
} else {
  for (const lessonFile of lessonFiles) {
    const date = lessonFile.replace('lessons-', '').replace('.md', '')
    lines.push(`### Lesson — ${date}`)
    lines.push('')
    try {
      const content = fs.readFileSync(path.join(lessonDir, lessonFile), 'utf8')
      lines.push(content.trim())
    } catch {
      lines.push('_Could not read lesson file._')
    }
    lines.push('')
  }
}

process.stdout.write(lines.join('\n') + '\n')
EOF
```

### Step 2: Present the export

The output above is valid Markdown. Present it directly to the user. They can copy it or redirect it to a file with:
```
/my-lingo:export > my-lingo-export.md
```
