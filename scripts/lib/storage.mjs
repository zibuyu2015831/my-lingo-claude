import { getDb } from './db.mjs'
import { computeNextReview, computeIntervalDays } from './srs.mjs'

// getDataDir is owned by paths.mjs (to avoid a storage<->db circular import),
// but re-exported here so existing callers `import { getDataDir } from './storage.mjs'`.
export { getDataDir } from './paths.mjs'

// ── value coercion (node:sqlite cannot bind booleans, undefined, or objects) ──
const b = (v) => (v ? 1 : 0)                       // boolean -> 0/1
const n = (v) => (v === undefined ? null : v)      // undefined -> null (string/number/null passthrough)

// Integer flag columns read back as 0/1; restore boolean semantics for callers/tests.
function normalizeTurn(row) {
  if (!row) return row
  return { ...row, fallback: row.fallback === 1, analyzed: row.analyzed === 1 }
}

// ── turns ────────────────────────────────────────────────────────────────────

export function writeTurn(input, config) {
  try {
    getDb().prepare(`
      INSERT INTO turns
        (ts, session_id, cwd, language_space, mode, detected_language,
         original_prompt, execution_prompt, rewrite_type, latency_ms,
         fallback, fallback_reason, analyzed)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)
    `).run(
      n(input.ts) ?? new Date().toISOString(),
      n(input.sessionId),
      n(config.cwd ?? input.cwd ?? process.cwd()),
      config.language_space ?? 'english',
      n(input.mode),
      input.detectedLanguage ?? (input.detection?.lang ?? 'en'),
      n(input.prompt),
      n(input.executionPrompt),
      n(input.rewriteType),
      n(input.latencyMs),
      b(input.fallback),
      n(input.fallbackReason),
    )
  } catch {
    // write failure must not propagate (D3)
  }
}

export function readTurnsForDay(date) {
  try {
    return getDb().prepare(
      'SELECT * FROM turns WHERE substr(ts,1,10)=? ORDER BY id'
    ).all(date).map(normalizeTurn)
  } catch {
    return []
  }
}

export function readTurnsForRange(startDate, endDate) {
  try {
    return getDb().prepare(
      'SELECT * FROM turns WHERE substr(ts,1,10) BETWEEN ? AND ? ORDER BY id'
    ).all(startDate, endDate).map(normalizeTurn)
  } catch {
    return []
  }
}

export function readTurnsLastNDays(n) {
  try {
    const cutoff = new Date(Date.now() - (n - 1) * 86400000).toISOString().slice(0, 10)
    return getDb().prepare(
      'SELECT * FROM turns WHERE substr(ts,1,10) >= ? ORDER BY id'
    ).all(cutoff).map(normalizeTurn)
  } catch {
    return []
  }
}

export function listTurnDates() {
  try {
    return getDb().prepare(
      'SELECT DISTINCT substr(ts,1,10) AS d FROM turns ORDER BY d'
    ).all().map(r => r.d)
  } catch {
    return []
  }
}

export function countTotalTurns() {
  try {
    return getDb().prepare('SELECT COUNT(*) AS n FROM turns').get().n
  } catch {
    return 0
  }
}

export function readRecentTurns(count) {
  if (count <= 0) return []
  try {
    return getDb().prepare(
      'SELECT * FROM turns ORDER BY id DESC LIMIT ?'
    ).all(count).map(normalizeTurn)
  } catch {
    return []
  }
}

// SessionEnd idempotency: only turns not yet folded into a committed analysis.
export function readUnanalyzedTurns(sessionId) {
  try {
    const sql = sessionId
      ? 'SELECT * FROM turns WHERE session_id=? AND analyzed=0 ORDER BY id'
      : 'SELECT * FROM turns WHERE analyzed=0 ORDER BY id'
    const stmt = getDb().prepare(sql)
    const rows = sessionId ? stmt.all(sessionId) : stmt.all()
    return rows.map(normalizeTurn)
  } catch {
    return []
  }
}

// Mark by explicit id list (the rows actually read), not by session_id — avoids
// missing null sessions and mis-marking turns written after the read.
export function markTurnsAnalyzed(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return
  try {
    const placeholders = ids.map(() => '?').join(',')
    getDb().prepare(
      `UPDATE turns SET analyzed=1 WHERE id IN (${placeholders})`
    ).run(...ids)
  } catch {}
}

// ── corrections ────────────────────────────────────────────────────────────

export function writeCorrection(record, space) {
  try {
    getDb().prepare(`
      INSERT INTO corrections
        (ts, session_id, turn_id, language_space, type, original, corrected, explanation, pattern)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      record.ts || new Date().toISOString(),
      n(record.session_id),
      n(record.turn_id ?? record.turn_ref),  // tolerate legacy 'turn_ref' field name
      space,
      n(record.type),
      n(record.original),
      n(record.corrected),
      n(record.explanation),
      n(record.pattern),
    )
  } catch {}
}

export function readCorrections(space, monthKeys) {
  if (!monthKeys || monthKeys.length === 0) return []
  try {
    const placeholders = monthKeys.map(() => '?').join(',')
    return getDb().prepare(
      `SELECT * FROM corrections WHERE language_space=? AND substr(ts,1,7) IN (${placeholders}) ORDER BY id`
    ).all(space, ...monthKeys)
  } catch {
    return []
  }
}

export function listCorrectionMonths(space) {
  try {
    return getDb().prepare(
      'SELECT DISTINCT substr(ts,1,7) AS m FROM corrections WHERE language_space=? ORDER BY m'
    ).all(space).map(r => r.m)
  } catch {
    return []
  }
}

// ── learning items (also hold SRS state) ──────────────────────────────────────

export function writeLearningItem(record, space) {
  try {
    getDb().prepare(`
      INSERT INTO learning_items
        (ts, session_id, language_space, type, target_text, native_explanation,
         next_review, review_count, interval_days)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      record.ts || new Date().toISOString(),
      n(record.session_id),
      space,
      n(record.type),
      n(record.target_text),
      n(record.native_explanation),
      n(record.next_review),                 // null = never reviewed (due immediately)
      record.review_count ?? 0,
      record.interval_days ?? 1,
    )
  } catch {}
}

export function readLearningItems(space, monthKeys) {
  if (!monthKeys || monthKeys.length === 0) return []
  try {
    const placeholders = monthKeys.map(() => '?').join(',')
    return getDb().prepare(
      `SELECT * FROM learning_items WHERE language_space=? AND substr(ts,1,7) IN (${placeholders}) ORDER BY id`
    ).all(space, ...monthKeys)
  } catch {
    return []
  }
}

export function listItemMonths(space) {
  try {
    return getDb().prepare(
      'SELECT DISTINCT substr(ts,1,7) AS m FROM learning_items WHERE language_space=? ORDER BY m'
    ).all(space).map(r => r.m)
  } catch {
    return []
  }
}

// SRS update — by primary key (ts could collide within the same millisecond).
export function updateLearningItemReview(id, reviewCount) {
  try {
    const nextReview = computeNextReview(reviewCount).toISOString()
    const interval = computeIntervalDays(reviewCount)
    getDb().prepare(
      'UPDATE learning_items SET review_count=?, next_review=?, interval_days=? WHERE id=?'
    ).run(reviewCount, nextReview, interval, id)
  } catch {}
}

export function readItemsDue(space) {
  try {
    const nowIso = new Date().toISOString()
    // NULL next_review = never reviewed -> due now, and sorted first (NULL ranks
    // before any timestamp). Matches srs.getItemsDue() ordering.
    return getDb().prepare(`
      SELECT * FROM learning_items
      WHERE language_space=? AND (next_review IS NULL OR next_review <= ?)
      ORDER BY (next_review IS NOT NULL), next_review ASC
    `).all(space, nowIso)
  } catch {
    return []
  }
}

// ── sessions ─────────────────────────────────────────────────────────────────

export function writeSession(record) {
  try {
    getDb().prepare(`
      INSERT OR REPLACE INTO sessions
        (ts, session_id, language_space, total_prompts, optimized, translated,
         corrected, fallbacks, raws, top_errors)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      new Date().toISOString(),
      n(record.session_id),
      n(record.language_space),
      n(record.total_prompts),
      n(record.optimized),
      n(record.translated),
      n(record.corrected),
      n(record.fallbacks),
      n(record.raws),
      JSON.stringify(record.top_errors ?? []),
    )
  } catch {}
}

export function readSession(sessionId) {
  try {
    const row = getDb().prepare('SELECT * FROM sessions WHERE session_id=?').get(sessionId)
    if (!row) return null
    let top_errors = []
    try { top_errors = JSON.parse(row.top_errors) } catch {}
    return { ...row, top_errors }
  } catch {
    return null
  }
}

// ── responses (Claude replies, Stop hook) ─────────────────────────────────────

export function writeResponseRecord(record) {
  try {
    getDb().prepare(
      'INSERT INTO responses (ts, session_id, text, word_count) VALUES (?,?,?,?)'
    ).run(
      record.ts || new Date().toISOString(),
      n(record.session_id),
      n(record.text),
      n(record.word_count),
    )
  } catch {}
}

// `date` kept for signature compatibility but ignored — querying by session_id
// alone is correct across midnight boundaries.
export function readResponsesForSession(sessionId, date) {
  try {
    return getDb().prepare(
      'SELECT * FROM responses WHERE session_id=? ORDER BY id'
    ).all(sessionId)
  } catch {
    return []
  }
}

// ── purge (used by /my-lingo:purge) ───────────────────────────────────────────

export function purgeSpace(space) {
  try {
    const db = getDb()
    db.prepare('DELETE FROM corrections WHERE language_space=?').run(space)
    db.prepare('DELETE FROM learning_items WHERE language_space=?').run(space)
  } catch {}
}

export function purgeAll({ keepSessions = false } = {}) {
  try {
    const db = getDb()
    db.exec('DELETE FROM turns')
    db.exec('DELETE FROM responses')
    db.exec('DELETE FROM corrections')
    db.exec('DELETE FROM learning_items')
    if (!keepSessions) db.exec('DELETE FROM sessions')
  } catch {}
}
