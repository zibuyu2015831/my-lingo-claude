import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { computeNextReview, getItemsDue } from './srs.mjs'

const FALLBACK_DIR = path.join(os.homedir(), '.claude', 'plugins', 'data')

// NOTE: read env at call-time (not module load) for test isolation (D6)
export function getDataDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || FALLBACK_DIR
  return path.join(base, 'my-lingo')
}

function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode })
}

export function writeTurn(input, config) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const turnsDir = path.join(getDataDir(), 'turns')
    ensureDir(turnsDir)
    const file = path.join(turnsDir, `${today}.jsonl`)

    // Map camelCase input to canonical snake_case schema
    const record = {
      ts: new Date().toISOString(),
      session_id: input.sessionId ?? null,
      cwd: config.cwd ?? input.cwd ?? process.cwd(),
      language_space: config.language_space ?? 'english',
      mode: input.mode ?? null,
      detected_language: input.detectedLanguage
        ?? (input.detection?.lang ?? 'en'),
      original_prompt: input.prompt ?? null,
      execution_prompt: input.executionPrompt ?? null,
      rewrite_type: input.rewriteType ?? null,
      latency_ms: input.latencyMs ?? null,
      fallback: Boolean(input.fallback),
      fallback_reason: input.fallbackReason ?? null,
    }

    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8')
  } catch {
    // write failure must not propagate (D3)
  }
}

export function readTurnsForDay(date) {
  try {
    const file = path.join(getDataDir(), 'turns', `${date}.jsonl`)
    if (!fs.existsSync(file)) return []
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean)
  } catch {
    return []
  }
}

export function readTurnsForRange(startDate, endDate) {
  const records = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    records.push(...readTurnsForDay(d.toISOString().slice(0, 10)))
  }
  return records
}

export function readTurnsLastNDays(n) {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - (n - 1))
  return readTurnsForRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
}

export function listTurnDates() {
  try {
    const dir = path.join(getDataDir(), 'turns')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''))
      .sort()
  } catch {
    return []
  }
}

export function countTotalTurns() {
  try {
    return listTurnDates().reduce((sum, date) => sum + readTurnsForDay(date).length, 0)
  } catch {
    return 0
  }
}

// v0.2+ stubs — conform to schema but not wired into v0.1 hot path (D7)
export function writeCorrection(record, space) {
  try {
    const month = new Date().toISOString().slice(0, 7)
    const dir = path.join(getDataDir(), 'learning', space)
    ensureDir(dir)
    const file = path.join(dir, `corrections-${month}.jsonl`)
    const line = JSON.stringify({ ...record, ts: record.ts || new Date().toISOString() })
    fs.appendFileSync(file, line + '\n', 'utf8')
  } catch {}
}

export function writeLearningItem(record, space) {
  try {
    const month = new Date().toISOString().slice(0, 7)
    const dir = path.join(getDataDir(), 'learning', space)
    ensureDir(dir)
    const file = path.join(dir, `items-${month}.jsonl`)
    const line = JSON.stringify({ ...record, ts: record.ts || new Date().toISOString() })
    fs.appendFileSync(file, line + '\n', 'utf8')
  } catch {}
}

export function writeSession(record) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const sessionsDir = path.join(getDataDir(), 'sessions')
    ensureDir(sessionsDir)
    const file = path.join(sessionsDir, `${today}.jsonl`)
    const line = JSON.stringify({ ...record, ts: new Date().toISOString() })
    fs.appendFileSync(file, line + '\n', 'utf8')
  } catch {}
}

export function readCorrections(space, monthKeys) {
  if (!monthKeys || monthKeys.length === 0) return []
  const results = []
  for (const month of monthKeys) {
    try {
      const file = path.join(getDataDir(), 'learning', space, `corrections-${month}.jsonl`)
      if (!fs.existsSync(file)) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try { results.push(JSON.parse(line)) } catch {}
      }
    } catch {}
  }
  return results
}

export function readLearningItems(space, monthKeys) {
  if (!monthKeys || monthKeys.length === 0) return []
  const results = []
  for (const month of monthKeys) {
    try {
      const file = path.join(getDataDir(), 'learning', space, `items-${month}.jsonl`)
      if (!fs.existsSync(file)) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try { results.push(JSON.parse(line)) } catch {}
      }
    } catch {}
  }
  return results
}

export function listCorrectionMonths(space) {
  try {
    const dir = path.join(getDataDir(), 'learning', space)
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir)
    const months = []
    for (const file of files) {
      const m = file.match(/^corrections-(\d{4}-\d{2})\.jsonl$/)
      if (m) months.push(m[1])
    }
    return months.sort()
  } catch {
    return []
  }
}

export function listItemMonths(space) {
  try {
    const dir = path.join(getDataDir(), 'learning', space)
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir)
    const months = []
    for (const file of files) {
      const m = file.match(/^items-(\d{4}-\d{2})\.jsonl$/)
      if (m) months.push(m[1])
    }
    return months.sort()
  } catch {
    return []
  }
}

export function updateLearningItemReview(space, monthKey, itemTs, reviewCount) {
  try {
    const file = path.join(getDataDir(), 'learning', space, `items-${monthKey}.jsonl`)
    if (!fs.existsSync(file)) return
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const updated = lines.map(line => {
      try {
        const item = JSON.parse(line)
        if (item.ts !== itemTs) return line
        item.review_count = reviewCount
        item.next_review = computeNextReview(reviewCount).toISOString()
        return JSON.stringify(item)
      } catch {
        return line
      }
    })
    fs.writeFileSync(file, updated.join('\n') + '\n', 'utf8')
  } catch {}
}

export function readItemsDue(space) {
  try {
    const months = listItemMonths(space)
    const allItems = []
    for (const month of months) {
      const file = path.join(getDataDir(), 'learning', space, `items-${month}.jsonl`)
      try {
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          try { allItems.push(JSON.parse(line)) } catch {}
        }
      } catch {}
    }
    return getItemsDue(allItems, Date.now())
  } catch {
    return []
  }
}

export function writeResponseRecord(record) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const dir = path.join(getDataDir(), 'responses')
    ensureDir(dir)
    const file = path.join(dir, `${today}.jsonl`)
    const line = JSON.stringify({ ...record, ts: record.ts || new Date().toISOString() })
    fs.appendFileSync(file, line + '\n', { encoding: 'utf8', mode: 0o600 })
  } catch {}
}

export function readResponsesForSession(sessionId, date) {
  try {
    const file = path.join(getDataDir(), 'responses', `${date}.jsonl`)
    if (!fs.existsSync(file)) return []
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const results = []
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (!sessionId || r.session_id === sessionId) results.push(r)
      } catch {}
    }
    return results
  } catch {
    return []
  }
}

export function readRecentTurns(n) {
  if (n <= 0) return []
  try {
    const dates = listTurnDates().slice().reverse()
    const result = []
    for (const date of dates) {
      const turns = readTurnsForDay(date).slice().reverse()
      for (const turn of turns) {
        result.push(turn)
        if (result.length >= n) return result
      }
    }
    return result
  } catch {
    return []
  }
}
