---
name: lesson
description: Generate a personalized learning lesson based on recent interactions.
argument-hint: "[--days 7] [--type grammar|vocab|prompt]"
allowed-tools: Bash, Read
---

## Workflow

Generate a personalized language lesson based on your recent interactions and learning history.

### Step 1: Generate the lesson

```bash
node "${CLAUDE_PLUGIN_ROOT:-.}/scripts/generate-lesson.mjs" $ARGUMENTS
```

### Step 2: Display the lesson

Present the lesson content from Step 1 to the user in a clear, readable format.

If the lesson was already generated today, the existing lesson is shown with a note that it was generated earlier today.

If generation failed (API not configured or unreachable), inform the user to check their configuration with `/my-lingo:setup`.
