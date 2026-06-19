import { spawnSync } from 'node:child_process'
import { getApiKey, extractJsonContent } from './api.mjs'
import { redactMessages } from './privacy.mjs'

// responses: optional array of { text, word_count } from Stop hook (Claude's replies)
export function buildAnalysisMessages(turns, config, responses = []) {
  if (!turns || turns.length === 0) return null

  const nativeLang = (config && config.native_language) || 'zh-CN'
  const targetLang = (config && config.target_language) || 'English'

  const hasResponses = Array.isArray(responses) && responses.length > 0

  const systemContent = `You are a language learning assistant for a developer learning ${targetLang}.
The developer's native language is ${nativeLang}.

Analyze the difference between the user's original prompt and the optimized version.${hasResponses ? "\nAlso use Claude's responses as examples of high-quality target language usage to extract learning points." : ''}
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
  let userContent = userLines.join('\n\n')

  if (hasResponses) {
    userContent += '\n\n--- Claude\'s responses this session ---\n'
    responses.forEach((r, i) => {
      const preview = r.text.length > 300 ? r.text.slice(0, 300) + '...' : r.text
      userContent += `\nResponse ${i + 1} (${r.word_count || '?'} words):\n${preview}\n`
    })
  }

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
  // Tolerate models that wrap the JSON in a ```json fence or surrounding prose,
  // not just those that honour response_format and return bare JSON (shared with
  // api.mjs parseModelResponse).
  const result = extractJsonContent(content)
  if (!result || !Array.isArray(result.corrections)) return null
  const learning_points = Array.isArray(result.learning_points) ? result.learning_points : []
  return { corrections: result.corrections, learning_points }
}

export function callDeepModel(payload, config, opts = {}) {
  const jsonMode = opts.jsonMode !== false
  const maxTimeSec = opts.maxTimeSeconds ?? config?.deep_timeout_seconds ?? 30
  const apiKey = getApiKey(config)
  if (!apiKey) return null
  if (!config || !config.api_base_url) return null

  const model = config.model_deep || config.model_fast
  if (!model) return null

  // Reasoning models (gemini-2.5-pro, o-series, etc.) spend a large share of the
  // completion budget on hidden reasoning tokens — a flat 1024 left only a few
  // dozen tokens for the actual answer, truncating the JSON (finish_reason
  // "length") so analysis silently produced nothing. Budget generously and let
  // config override.
  const maxTokens = opts.maxTokens ?? config.deep_max_tokens ?? 4096
  // SessionEnd analysis & lesson generation read RAW prompts back out of SQLite,
  // so this boundary redaction is what protects them (ARCHITECTURE_REVIEW F2/D-A).
  const bodyObj = {
    model,
    max_tokens: maxTokens,
    messages: redactMessages(payload.messages, config.privacy_mode),
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
