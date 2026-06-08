---
name: review
description: Review vocabulary items due today using spaced repetition.
allowed-tools: Bash, Read
---

## Workflow

Start a spaced repetition review session for items that are due today.

### Step 1: Load items due for review

```bash
node --input-type=module << 'EOF'
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { loadSpaces } = await import(ROOT + '/scripts/lib/config.mjs')
const { readItemsDue } = await import(ROOT + '/scripts/lib/storage.mjs')

const spaces = loadSpaces()
const spaceKey = spaces.active || 'english'

const dueItems = readItemsDue(spaceKey)

if (dueItems.length === 0) {
  console.log('\n✅ All caught up! No items due for review.\n')
  console.log('Great work keeping up with your reviews. Check back tomorrow!')
  process.exit(0)
}

console.log(`\n🔄 Review Session — ${dueItems.length} item(s) due\n`)
console.log('I will show you each item\'s meaning and ask you to recall the target language expression.')
console.log('After each answer, I\'ll give you feedback and update your progress.\n')

// Output items as JSON for Claude to process interactively
const output = {
  space: spaceKey,
  items: dueItems.map(item => ({
    id: item.id,
    type: item.type,
    target_text: item.target_text,
    native_explanation: item.native_explanation,
    review_count: item.review_count || 0,
    next_review: item.next_review,
  }))
}
console.log('REVIEW_DATA:' + JSON.stringify(output))
EOF
```

### Step 2: Conduct the review

Look at the REVIEW_DATA output above. For each item in the list:

1. Show the user this prompt:
   - "**Item [N]/[total]**: [native_explanation]"
   - "What is the [target language] expression for this?"

2. Wait for the user's answer.

3. Compare their answer to `target_text`:
   - If correct or close: "✅ Correct! The expression is: **[target_text]**"
   - If wrong: "❌ The correct expression is: **[target_text]**. [brief explanation if helpful]"

4. After each answer, update the SRS state:

```bash
node --input-type=module << 'EOF'
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) { try { ROOT = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json'), 'utf8')).plugin_root; } catch {} }
ROOT = ROOT || process.cwd();
const { updateLearningItemReview } = await import(ROOT + '/scripts/lib/storage.mjs')

// Replace these with actual values from the current item being reviewed.
// ITEM_ID comes from the `id` field in REVIEW_DATA.
const ITEM_ID = 0          // REPLACE_WITH_ITEM_ID
const NEW_REVIEW_COUNT = 0 // REPLACE_WITH_NEW_COUNT (current review_count + 1 if recalled correctly)

updateLearningItemReview(ITEM_ID, NEW_REVIEW_COUNT)
console.log('Review state updated.')
EOF
```

5. Continue to the next item.

### Step 3: Show session summary

After all items have been reviewed, display:
- Total items reviewed
- How many were answered correctly
- When each item is next due (based on updated SRS schedule)
