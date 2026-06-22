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
  drainFailure,
} from './lib/api.mjs'
import { buildOptimizationMessages, buildRefineMessages, buildSummaryLanguageCtx, buildResponseLanguageCtx } from './lib/prompts.mjs'
import { debugLog } from './lib/debug.mjs'
import { writeInstallPointer } from './lib/paths.mjs'

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
  const lang = result.detected_input_language || detection.lang
  const execPrompt = result.execution_prompt_en
  const summaryCtx = buildSummaryLanguageCtx(config)
  const responseLangCtx = buildResponseLanguageCtx(config)
  if (config.execution_mode === 'english_optimized' || config.execution_mode === 'preview') {
    return (
      `CANONICAL REQUEST: The user's message is in ${lang}. ` +
      `They have configured My Lingo to optimize prompts to English. ` +
      `Treat the following as their actual request. Disregard only the text language of their original message — still process any attached images, files, or other non-text content:\n\n` +
      execPrompt +
      summaryCtx +
      responseLangCtx
    )
  }
  if (config.execution_mode === 'original_with_english_context') {
    return (
      `[My Lingo English Reference]\n` +
      `The user's original message text may be in ${lang}. ` +
      `Here is an English version for reference. Process any attached images, files, or other non-text content from the original message as normal:\n\n` +
      execPrompt +
      summaryCtx +
      responseLangCtx
    )
  }
  return execPrompt + summaryCtx + responseLangCtx
}

// Translate a callFastModel() failure into the stored fallback_reason and the
// short cause phrase shown to the user. Distinguishing these is the whole point:
// a slow model timing out (raise timeout_seconds) is a different problem from a
// dead endpoint, a bad key, or a garbled response — all of which previously read
// as the same "API unavailable".
const FAILURE_INFO = {
  timeout:          (t) => ({ fallbackReason: 'api_timeout',     cause: `timed out (>${t}s)`,        hint: ' Raise timeout_seconds if this keeps happening.' }),
  unreachable:      () => ({ fallbackReason: 'api_unreachable',  cause: 'API unreachable',           hint: '' }),
  tls_error:        () => ({ fallbackReason: 'api_tls_error',    cause: 'TLS handshake failed',      hint: '' }),
  auth:             () => ({ fallbackReason: 'api_auth',         cause: 'authentication failed',     hint: '' }),
  invalid_response: () => ({ fallbackReason: 'api_bad_response', cause: 'unexpected API response',   hint: '' }),
  no_api_key:       () => ({ fallbackReason: 'no_api_key',       cause: 'API key not set',           hint: ' Run /my-lingo:setup.' }),
  not_configured:   () => ({ fallbackReason: 'not_configured',   cause: 'API not configured',        hint: ' Run /my-lingo:setup.' }),
  api_error:        () => ({ fallbackReason: 'api_error',        cause: 'API unavailable',           hint: '' }),
}

function classifyFailure(failure, config) {
  const make = FAILURE_INFO[failure?.reason] || FAILURE_INFO.api_error
  return make(config.timeout_seconds || 8)
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

function buildSystemMessage(result, detection, latencyMs, config) {
  const effectiveLang = result.detected_input_language || detection.lang
  const langLabel = effectiveLang === 'en' ? 'refined' : `${effectiveLang}→en`
  const execPrompt = result.execution_prompt_en
  const display = config?.display_mode === 'compact'
    ? (execPrompt.length > 150 ? execPrompt.slice(0, 150) + '...' : execPrompt)
    : execPrompt
  return `[my-lingo] ${langLabel} (${latencyMs}ms): ${display}`
}

function main() {
  // Refresh the install pointer so env-blind slash commands can locate the
  // plugin root + data dir (dev_docs/14 §六-F). Atomic + skip-if-unchanged.
  writeInstallPointer()

  const input = readStdin()
  const rawPrompt = (input.prompt || '').trim()
  const cwd = input.cwd || process.cwd()
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || null

  if (!rawPrompt) return

  // ① -- prefix: skip optimization, pass through as-is
  if (rawPrompt.startsWith('--')) {
    const text = rawPrompt.slice(2).trimStart()
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
    emit({ systemMessage: `[my-lingo] --: optimization skipped. Prompt: ${(text || rawPrompt).slice(0, 80)}` })
    return
  }

  // ② :: prefix — MUST be before shouldSkip (detect before skip check)
  const isRefine = rawPrompt.startsWith('::')

  // ③ shouldSkip check — bypass for :: refine so short commands like ":: fix" still work
  // config not yet loaded here; SKIP logging activates via MY_LINGO_DEBUG env only
  if (!isRefine && shouldSkip(rawPrompt)) {
    debugLog('SKIP', { preview: rawPrompt.slice(0, 100) })
    return
  }

  // ④ Load config
  const config = loadConfig(cwd)
  debugLog('CONFIG', {
    execution_mode: config.execution_mode,
    model_fast: config.model_fast,
    api_base_url: config.api_base_url,
    timeout_seconds: config.timeout_seconds,
    privacy_mode: config.privacy_mode,
    native_language: config.native_language,
    api_key: config.api_key ? '[SET]' : '[NOT SET]',
    debug: config.debug,
  }, config)

  // execution_mode off → pass through silently
  if (config.execution_mode === 'off') return

  const text = isRefine ? rawPrompt.slice(2).trimStart() : rawPrompt

  // Prompt length guard
  if (!isRefine && [...text].length > (config.max_prompt_length || 4000)) {
    debugLog('TOO_LONG', { length: [...text].length, max: config.max_prompt_length || 4000 }, config)
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
    debugLog('ORIGINAL_MODE', { preview: text.slice(0, 80) }, config)
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
    // Redaction now happens at the API boundary (callFastModel), so every
    // outbound path is covered uniformly — pass the raw text through.
    const result = callFastModel(buildRefineMessages(text, config), config)
    if (!result) {
      const { cause, hint } = classifyFailure(drainFailure(), config)
      recordApiFailure(config)
      emit({ decision: 'block', reason: `[my-lingo] Refinement failed — ${cause}.${hint}` })
      return
    }
    recordApiSuccess(config)
    debugLog('REFINE_RESULT', { preview: (result.execution_prompt_en || '').slice(0, 200) }, config)
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
    const refinedDisplay = config?.display_mode === 'compact'
      ? (result.execution_prompt_en || '').slice(0, 150)
      : result.execution_prompt_en || ''
    emit({ additionalContext: ctx, systemMessage: `[my-lingo] Refined: ${refinedDisplay}` })
    return
  }

  // ⑥ Main optimization path
  const detection = detectLanguage(text)
  debugLog('DETECT', { lang: detection.lang, ratio: detection.ratio }, config)

  // Circuit breaker check
  if (checkCircuitBreaker(config)) {
    debugLog('CIRCUIT_OPEN', { fallback_policy: config.fallback_policy }, config)
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

  const startTime = Date.now()
  const result = callFastModel(buildOptimizationMessages(text, detection, config), config)
  const latencyMs = Date.now() - startTime

  if (!result) {
    const { fallbackReason, cause, hint } = classifyFailure(drainFailure(), config)
    const tripped = recordApiFailure(config)
    try {
      writeTurn({
        prompt: text,
        detection,
        sessionId,
        mode: config.execution_mode,
        latencyMs,
        fallback: true,
        fallbackReason,
      }, config)
    } catch {}
    if (config.fallback_policy === 'send_original') {
      const msg = tripped
        ? '[my-lingo] Circuit breaker tripped — API paused for 5 min.'
        : `[my-lingo] ${capitalize(cause)} — sending original prompt.${hint}`
      emit({ systemMessage: msg })
    }
    return
  }

  recordApiSuccess(config)

  // Use API's detected_input_language if available, else fall back to local detection result
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
  const systemMessage = buildSystemMessage(result, detection, latencyMs, config)
  debugLog('EMIT', {
    has_additional_context: Boolean(additionalContext),
    system_message: systemMessage,
    latency_ms: latencyMs,
    rewrite_type: result.rewrite_type,
  }, config)
  emit({ additionalContext, systemMessage })
}

main()
