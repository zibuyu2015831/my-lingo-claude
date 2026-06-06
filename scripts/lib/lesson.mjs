export function buildLessonMessages(data, config) {
  const targetLang = (data && data.space_name) || 'English'
  const nativeLang = (config && config.native_language) || 'zh-CN'
  const level = (data && data.level) || 'intermediate'

  const systemContent = `You are a language teacher for a developer learning ${targetLang}.
Native language: ${nativeLang}.
Learning level: ${level}.
Focus: technical English used in AI-coding workflows.

Based on the provided learning history (turns, corrections, patterns),
generate a personalized lesson. The lesson should:
1. Focus on the user's actual mistakes and patterns from their real work
2. Use examples directly from their coding sessions
3. Be practical and immediately applicable
4. Not exceed 500 words
5. Follow the lesson structure below:

# My Lingo Lesson — {date}

## Summary
{1-2 sentence overview of this lesson's focus}

## Common Errors This Period
### {Error Pattern Name}
- Your expression: \`{original}\`
- Better: \`{corrected}\`
- Pattern: \`{abstract_pattern}\`

## Key Expressions to Remember
1. **{expression}** — {native_explanation}
   Example: \`{example_sentence}\`

## Prompt Patterns
{Coding-specific prompt patterns the user should adopt}

## Next Focus
{1-2 things to work on next session}`

  const corrections = (data && data.corrections) || []
  const turns = (data && data.turns) || []

  let userContent = ''
  if (corrections.length > 0) {
    userContent += 'Recent corrections:\n'
    for (const c of corrections) {
      userContent += `- Original: "${c.original}" → Corrected: "${c.corrected}" (${c.pattern || c.type || 'grammar'})\n`
    }
    userContent += '\n'
  } else {
    userContent += 'No corrections recorded in this period.\n\n'
  }

  if (turns.length > 0) {
    userContent += 'Recent turns (original → optimized):\n'
    for (const t of turns.slice(-5)) {
      if (t.original_prompt && t.execution_prompt) {
        userContent += `- Original: "${t.original_prompt}"\n  Optimized: "${t.execution_prompt}"\n`
      }
    }
  }

  return {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
  }
}

export function parseLessonResponse(stdout) {
  if (!stdout || typeof stdout !== 'string') return null
  let response
  try {
    response = JSON.parse(stdout)
  } catch {
    return null
  }
  if (response.error) return null
  let content
  try {
    content = response.choices?.[0]?.message?.content
  } catch {
    return null
  }
  if (!content || typeof content !== 'string' || content.trim() === '') return null
  return content
}
