import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './paths.mjs'
import { redact } from './privacy.mjs'

const MAX_LOG_BYTES = 1024 * 1024  // 1 MB
const KEEP_LINES_ON_ROTATE = 500

// Read env at call-time for test isolation (D6)
export function isDebugEnabled(config) {
  return process.env.MY_LINGO_DEBUG === '1' || Boolean(config?.debug)
}

function debugLogFile() {
  return path.join(getDataDir(), 'debug.log')
}

function rotateIfNeeded(file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size < MAX_LOG_BYTES) return
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const kept = lines.slice(-KEEP_LINES_ON_ROTATE)
    fs.writeFileSync(file, kept.join('\n') + '\n', 'utf8')
  } catch {}
}

// Recursively redact all string values before writing to disk
function sanitize(data) {
  if (typeof data === 'string') return redact(data)
  if (!data || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(sanitize)
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = sanitize(v)
  }
  return out
}

// debugLog: append a structured line to debug.log when debug mode is active (D3: never throws)
export function debugLog(event, data, config) {
  if (!isDebugEnabled(config)) return
  try {
    const file = debugLogFile()
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    rotateIfNeeded(file)
    const line = `[${new Date().toISOString()}] [${event}] ${JSON.stringify(sanitize(data))}\n`
    fs.appendFileSync(file, line, 'utf8')
  } catch {}
}
