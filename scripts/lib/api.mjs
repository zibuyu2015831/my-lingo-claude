import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './storage.mjs'
import { debugLog } from './debug.mjs'
import { redactMessages } from './privacy.mjs'

const CIRCUIT_THRESHOLD = 3
const COOLDOWN_MINUTES = 5

// pending auth warning — drained on next emit()
let _pendingWarning = null

export function getApiKey(config) {
  return config?.api_key ?? null
}

export function parseModelResponse(stdout) {
  if (!stdout || typeof stdout !== 'string') return null
  let response
  try {
    response = JSON.parse(stdout)
  } catch {
    return null
  }
  if (response.error) {
    if (response.error.type === 'authentication_error') {
      _pendingWarning = '[my-lingo] Authentication failed. Check your API key with /my-lingo:setup.'
    }
    return null
  }
  const content = response.choices?.[0]?.message?.content
  if (!content) return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

export function callFastModel(payload, config) {
  const apiKey = getApiKey(config)
  if (!apiKey) {
    process.stderr.write('[my-lingo] No API key configured. Run /my-lingo:setup\n')
    return null
  }
  if (!config.api_base_url || !config.model_fast) {
    process.stderr.write('[my-lingo] API not configured. Run /my-lingo:setup\n')
    return null
  }

  const timeoutSec = config.timeout_seconds || 8
  // Single outbound chokepoint: scrub secrets from every message before they
  // leave the machine (ARCHITECTURE_REVIEW F2 / D-A).
  const messages = redactMessages(payload.messages, config.privacy_mode)
  const body = JSON.stringify({
    model: config.model_fast,
    max_tokens: 512,
    response_format: { type: 'json_object' },
    messages,
  })

  debugLog('API_REQUEST', {
    url: `${config.api_base_url}/chat/completions`,
    model: config.model_fast,
    messages,
  }, config)

  const result = spawnSync('curl', [
    '-s',
    '--max-time', String(timeoutSec),
    `${config.api_base_url}/chat/completions`,
    '-H', 'content-type: application/json',
    '-H', `authorization: Bearer ${apiKey}`,
    '-d', body,
  ], {
    encoding: 'utf8',
    timeout: (timeoutSec + 2) * 1000,
  })

  debugLog('API_RESPONSE', {
    status: result.status,
    error: result.error?.message ?? null,
    stdout_preview: (result.stdout || '').slice(0, 2000),
    stderr_preview: (result.stderr || '').slice(0, 500),
  }, config)

  if (result.error || result.status !== 0) return null

  const parsed = parseModelResponse(result.stdout)
  if (!parsed) {
    debugLog('PARSE_ERROR', { stdout_preview: (result.stdout || '').slice(0, 500) }, config)
  }
  return parsed
}

function circuitFile() {
  return path.join(getDataDir(), 'circuit.json')
}

export function checkCircuitBreaker() {
  const file = circuitFile()
  let circuit
  try {
    if (!fs.existsSync(file)) return false
    circuit = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return false
  }
  const cooldownMs = COOLDOWN_MINUTES * 60 * 1000
  if (Date.now() - circuit.last_failure_at < cooldownMs) return true
  // cooldown expired — auto-reset
  try { fs.unlinkSync(file) } catch {}
  return false
}

export function recordApiFailure(config) {
  const file = circuitFile()
  let circuit = { failure_count: 0, last_failure_at: 0 }
  try {
    if (fs.existsSync(file)) {
      circuit = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch {}
  circuit.failure_count = (circuit.failure_count || 0) + 1
  circuit.last_failure_at = Date.now()
  try {
    const dir = path.dirname(file)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, JSON.stringify(circuit))
  } catch {}
  const tripped = circuit.failure_count >= CIRCUIT_THRESHOLD
  debugLog('CIRCUIT', { event: 'failure', failure_count: circuit.failure_count, tripped }, config)
  return tripped
}

export function recordApiSuccess(config) {
  const file = circuitFile()
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {}
  debugLog('CIRCUIT', { event: 'success', state: 'reset' }, config)
}

// drainWarning: merge pending auth warning into an emit object before writing stdout
export function drainWarning(obj) {
  if (!_pendingWarning) return obj
  const msg = _pendingWarning
  _pendingWarning = null
  return { ...obj, systemMessage: obj.systemMessage ? `${msg}\n${obj.systemMessage}` : msg }
}
