import fs from 'node:fs'
import process from 'node:process'
import { shouldSkip, detectLanguage } from './lib/detect.mjs'
import { loadConfig } from './lib/config.mjs'
import { writeTurn } from './lib/storage.mjs'
import {
  callFastModel,
  checkCircuitBreaker,
  recordApiFailure,
  recordApiSuccess,
  drainWarning,
} from './lib/api.mjs'
import { redact } from './lib/privacy.mjs'
import { buildOptimizationMessages, buildRefineMessages } from './lib/prompts.mjs'

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// emit: drain pending auth warning, then write JSON to stdout (D3: never throw)
function emit(obj) {
  try {
    const out = drainWarning(obj)
    process.stdout.write(JSON.stringify(out) + '\n')
  } catch {}
}

function buildAdditionalContext(result, detection, config) {
  const lang = detection.lang
  const execPrompt = result.execution_prompt_en
  if (config.execution_mode === 'english_optimized' || config.execution_mode === 'preview') {
    return (
      `CANONICAL REQUEST: The user's message is in ${lang}. ` +
      `They have configured My Lingo to optimize prompts to English. ` +
      `Treat the following as their actual request and ignore the language of their original message:\n\n` +
      execPrompt
    )
  }
  if (config.execution_mode === 'original_with_english_context') {
    return (
      `[My Lingo English Reference]\n` +
      `The user's original message may be in ${lang}. ` +
      `Here is an English version for reference:\n\n` +
      execPrompt
    )
  }
  return execPrompt
}

function buildSystemMessage(result, detection, latencyMs) {
  const langLabel = detection.lang === 'en' ? 'refined' : `${detection.lang}→en`
  const execPrompt = result.execution_prompt_en
  const truncated = execPrompt.length > 150 ? execPrompt.slice(0, 150) + '...' : execPrompt
  return `[my-lingo] ${langLabel} (${latencyMs}ms): ${truncated}`
}

function main() {
  const input = readStdin()
  const rawPrompt = (input.prompt || '').trim()
  const cwd = input.cwd || process.cwd()
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || null

  if (!rawPrompt) return

  // ① !raw prefix — MUST be before shouldSkip (D: !raw starts with '!', would be skipped)
  if (rawPrompt.startsWith('!raw')) {
    const text = rawPrompt.slice(4).trimStart()
    const config = loadConfig(cwd)
    if (config.execution_mode === 'off') return
    try {
      writeTurn({
        prompt: text || rawPrompt,
        detection: detectLanguage(text || rawPrompt),
        sessionId,
        mode: 'raw',
        fallback: false,
      }, config)
    } catch {}
    emit({ systemMessage: `[my-lingo] !raw: optimization skipped. Prompt: ${(text || rawPrompt).slice(0, 80)}` })
    return
  }

  // ② :: prefix — MUST be before shouldSkip (detect before skip check)
  const isRefine = rawPrompt.startsWith('::')

  // ③ shouldSkip check — bypass for :: refine so short commands like ":: fix" still work
  if (!isRefine && shouldSkip(rawPrompt)) return

  // ④ Load config
  const config = loadConfig(cwd)

  // execution_mode off → pass through silently
  if (config.execution_mode === 'off') return

  const text = isRefine ? rawPrompt.slice(2).trimStart() : rawPrompt

  // Prompt length guard
  if (!isRefine && [...text].length > (config.max_prompt_length || 4000)) {
    try {
      writeTurn({
        prompt: text,
        detection: detectLanguage(text),
        sessionId,
        mode: config.execution_mode,
        fallback: true,
        fallbackReason: 'too_long',
      }, config)
    } catch {}
    emit({ systemMessage: '[my-lingo] Prompt too long — optimization skipped, sending original.' })
    return
  }

  // original mode: record and pass through without API call
  if (!isRefine && config.execution_mode === 'original') {
    try {
      writeTurn({
        prompt: text,
        detection: detectLanguage(text),
        sessionId,
        mode: 'original',
        fallback: false,
      }, config)
    } catch {}
    return
  }

  // ⑤ Refine path (:: prefix)
  if (isRefine) {
    if (!text) {
      emit({ decision: 'block', reason: 'Nothing to refine. Provide text after ::.' })
      return
    }
    const redacted = redact(text, config.privacy_mode)
    const result = callFastModel(buildRefineMessages(redacted, config), config)
    if (!result) {
      recordApiFailure()
      emit({ decision: 'block', reason: '[my-lingo] Refinement failed — API unavailable.' })
      return
    }
    recordApiSuccess()
    try {
      writeTurn({
        prompt: text,
        detection: detectLanguage(text),
        sessionId,
        mode: 'refine',
        executionPrompt: result.execution_prompt_en,
        fallback: false,
      }, config)
    } catch {}
    const ctx = `IMPORTANT: The user used :: to request prompt refinement. Their refined intent is: ${result.execution_prompt_en}. Follow this refined prompt as the user's actual request.`
    emit({ additionalContext: ctx, systemMessage: `[my-lingo] Refined: ${(result.execution_prompt_en || '').slice(0, 150)}` })
    return
  }

  // ⑥ Main optimization path
  const detection = detectLanguage(text)

  // Circuit breaker check
  if (checkCircuitBreaker()) {
    try {
      writeTurn({
        prompt: text,
        detection,
        sessionId,
        mode: config.execution_mode,
        fallback: true,
        fallbackReason: 'circuit_open',
      }, config)
    } catch {}
    if (config.fallback_policy === 'send_original') {
      emit({ systemMessage: '[my-lingo] Circuit breaker open — API paused, sending original.' })
    }
    return
  }

  const redacted = redact(text, config.privacy_mode)
  const startTime = Date.now()
  const result = callFastModel(buildOptimizationMessages(redacted, detection, config), config)
  const latencyMs = Date.now() - startTime

  if (!result) {
    const tripped = recordApiFailure()
    try {
      writeTurn({
        prompt: text,
        detection,
        sessionId,
        mode: config.execution_mode,
        latencyMs,
        fallback: true,
        fallbackReason: 'api_error',
      }, config)
    } catch {}
    if (config.fallback_policy === 'send_original') {
      const msg = tripped
        ? '[my-lingo] Circuit breaker tripped — API paused for 5 min.'
        : '[my-lingo] API unavailable, sending original prompt.'
      emit({ systemMessage: msg })
    }
    return
  }

  recordApiSuccess()

  // Use API's detected_input_language if available, else fall back to detection.lang (D4)
  const detectedLanguage = result.detected_input_language || detection.lang

  try {
    writeTurn({
      prompt: text,
      detection,
      detectedLanguage,
      sessionId,
      mode: config.execution_mode,
      executionPrompt: result.execution_prompt_en,
      rewriteType: result.rewrite_type,
      latencyMs,
      fallback: false,
    }, config)
  } catch {}

  const additionalContext = buildAdditionalContext(result, detection, config)
  const systemMessage = buildSystemMessage(result, detection, latencyMs)
  emit({ additionalContext, systemMessage })
}

main()
