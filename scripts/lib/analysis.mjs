import { spawnSync } from 'node:child_process'
import { getApiKey } from './api.mjs'

export function buildAnalysisMessages(turns, config) {
  if (!turns || turns.length === 0) return null

  const nativeLang = (config && config.native_language) || 'zh-CN'
  const targetLang = (config && config.target_language) || 'English'

  const systemContent = `You are a language learning assistant for a developer learning ${targetLang}.
The developer's native language is ${nativeLang}.

Analyze the difference between the user's original prompt and the optimized version.
Generate learning content that helps them improve their ${targetLang} expression
in technical, AI-coding contexts.

Rules:
1. Only flag REAL language errors, not stylistic preferences.
2. NEVER flag technical terms (code, variable names, tool names, error messages) as errors.
3. Explain errors in the user's native language (${nativeLang}).
4. Focus on patterns the user can remember and reuse.
5. Be conservative — 3 corrections maximum, pick the most valuable ones.
6. Output valid JSON only with this exact structure:
{"corrections":[{"type":"grammar|word_choice|structure","original":"...","corrected":"...","explanation":"...","pattern":"..."}],"learning_points":[{"type":"phrase|sentence_pattern","target_text":"...","native_explanation":"..."}]}`

  const userLines = turns.map((t, i) => {
    const lang = t.detected_language || 'unknown'
    return `Turn ${i + 1} (detected: ${lang}):\nOriginal: ${t.original_prompt || ''}\nOptimized: ${t.execution_prompt || ''}`
  })
  const userContent = userLines.join('\n\n')

  return {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
  }
}

export function parseAnalysisResponse(stdout) {
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
    if (!content) return null
  } catch {
    return null
  }
  let result
  try {
    result = JSON.parse(content)
  } catch {
    return null
  }
  if (!Array.isArray(result.corrections)) return null
  const learning_points = Array.isArray(result.learning_points) ? result.learning_points : []
  return { corrections: result.corrections, learning_points }
}

export function callDeepModel(payload, config, opts = {}) {
  const jsonMode = opts.jsonMode !== false
  const maxTimeSec = opts.maxTimeSeconds ?? 30
  const apiKey = getApiKey(config)
  if (!apiKey) return null
  if (!config || !config.api_base_url) return null

  const model = config.model_deep || config.model_fast
  if (!model) return null

  const bodyObj = {
    model,
    max_tokens: 1024,
    messages: payload.messages,
  }
  if (jsonMode) {
    bodyObj.response_format = { type: 'json_object' }
  }

  const result = spawnSync('curl', [
    '-s',
    '--max-time', String(maxTimeSec),
    `${config.api_base_url}/chat/completions`,
    '-H', 'content-type: application/json',
    '-H', `authorization: Bearer ${apiKey}`,
    '-d', JSON.stringify(bodyObj),
  ], {
    encoding: 'utf8',
    timeout: (maxTimeSec + 2) * 1000,
  })

  if (result.error || result.status !== 0) return null

  if (!jsonMode) {
    try {
      const response = JSON.parse(result.stdout)
      return response.choices?.[0]?.message?.content ?? null
    } catch {
      return null
    }
  }

  return parseAnalysisResponse(result.stdout)
}
