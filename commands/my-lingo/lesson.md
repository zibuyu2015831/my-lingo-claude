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
# Resolve the plugin root: prefer the env var (set in dev/test), else read the
# install pointer the hook writes (dev_docs/14 §六-F), else fall back to cwd.
ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$ROOT" ]; then
  ROOT="$(node -e "try{const fs=require('fs'),p=require('path'),os=require('os');process.stdout.write(JSON.parse(fs.readFileSync(p.join(os.homedir(),'.claude','plugins','data','my-lingo','install.json'),'utf8')).plugin_root||'')}catch{}")"
fi
ROOT="${ROOT:-$PWD}"
node "$ROOT/scripts/generate-lesson.mjs" $ARGUMENTS
```

### Step 2: Display the lesson

Present the lesson content from Step 1 to the user in a clear, readable format.

If the lesson was already generated today, the existing lesson is shown with a note that it was generated earlier today.

If generation failed (API not configured or unreachable), inform the user to check their configuration with `/my-lingo:setup`.
