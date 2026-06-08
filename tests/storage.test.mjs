import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  writeTurn,
  readTurnsForDay,
  listTurnDates,
  countTotalTurns,
  getDataDir,
  writeCorrection,
  readCorrections,
  writeLearningItem,
  readLearningItems,
  writeSession,
  readSession,
  listCorrectionMonths,
  readRecentTurns,
  listItemMonths,
  updateLearningItemReview,
  readItemsDue,
  writeResponseRecord,
  readResponsesForSession,
  readUnanalyzedTurns,
  markTurnsAnalyzed,
  purgeSpace,
  purgeAll,
  countTurnsForSpace,
  countCorrectionsForSpace,
} from '../scripts/lib/storage.mjs'
import { resetDb } from '../scripts/lib/db.mjs'

function withTempData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-stor-test-'))
  const prev = process.env.CLAUDE_PLUGIN_DATA
  process.env.CLAUDE_PLUGIN_DATA = dir
  try {
    fn(dir)
  } finally {
    resetDb() // close singleton before the dir it points at is removed
    process.env.CLAUDE_PLUGIN_DATA = prev !== undefined ? prev : undefined
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const TODAY = new Date().toISOString().slice(0, 10)

const BASE_INPUT = {
  prompt: 'Review this code for issues',
  detection: { lang: 'en', ratio: 95 },
  sessionId: 'test-session-001',
  mode: 'english_optimized',
  executionPrompt: 'Analyze the code for potential issues.',
  rewriteType: 'optimize',
  latencyMs: 350,
  fallback: false,
}

const BASE_CONFIG = {
  language_space: 'english',
  cwd: '/tmp/test-project',
}

// ── writeTurn + readTurnsForDay ──────────────────────────────────────────────

test('writeTurn: data.db is created after write', () => {
  withTempData((dir) => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    const file = path.join(dir, 'my-lingo', 'data.db')
    assert.ok(fs.existsSync(file), `data.db not found: ${file}`)
    assert.equal(readTurnsForDay(TODAY).length, 1)
  })
})

test('writeTurn: record has snake_case fields', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    const [record] = readTurnsForDay(TODAY)
    assert.ok(record, 'no record found')
    assert.ok('session_id' in record, 'missing session_id')
    assert.ok('original_prompt' in record, 'missing original_prompt')
    assert.ok('detected_language' in record, 'missing detected_language')
    assert.ok('execution_prompt' in record, 'missing execution_prompt')
    assert.ok('latency_ms' in record, 'missing latency_ms')
    assert.ok('mode' in record, 'missing mode')
    assert.ok('fallback' in record, 'missing fallback')
  })
})

test('writeTurn: English turn has detected_language === en', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, detection: { lang: 'en', ratio: 95 } }, BASE_CONFIG)
    const [record] = readTurnsForDay(TODAY)
    assert.equal(record.detected_language, 'en')
  })
})

test('writeTurn: non-English turn has detected_language !== en', () => {
  withTempData(() => {
    writeTurn({
      ...BASE_INPUT,
      detection: { lang: 'non-english', ratio: 15 },
      detectedLanguage: 'zh-CN',
    }, BASE_CONFIG)
    const [record] = readTurnsForDay(TODAY)
    assert.notEqual(record.detected_language, 'en')
    assert.equal(record.detected_language, 'zh-CN')
  })
})

test('writeTurn: uses API detected_input_language over detection.lang when provided', () => {
  withTempData(() => {
    writeTurn({
      ...BASE_INPUT,
      detection: { lang: 'non-english', ratio: 20 },
      detectedLanguage: 'ja',
    }, BASE_CONFIG)
    const [record] = readTurnsForDay(TODAY)
    assert.equal(record.detected_language, 'ja')
  })
})

test('writeTurn: fallback field is boolean', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, fallback: true, fallbackReason: 'api_error' }, BASE_CONFIG)
    const [record] = readTurnsForDay(TODAY)
    assert.equal(record.fallback, true)
    assert.equal(record.fallback_reason, 'api_error')
  })
})

test('writeTurn: non-fallback record reads fallback === false', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    const [record] = readTurnsForDay(TODAY)
    assert.equal(record.fallback, false)
  })
})

test('writeTurn: multiple appends accumulate', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    writeTurn(BASE_INPUT, BASE_CONFIG)
    writeTurn(BASE_INPUT, BASE_CONFIG)
    const records = readTurnsForDay(TODAY)
    assert.equal(records.length, 3)
  })
})

// ── readTurnsForDay ──────────────────────────────────────────────────────────

test('readTurnsForDay: returns empty array when no data', () => {
  withTempData(() => {
    const records = readTurnsForDay(TODAY)
    assert.ok(Array.isArray(records))
    assert.equal(records.length, 0)
  })
})

test('readTurnsForDay: content matches what was written', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    const [record] = readTurnsForDay(TODAY)
    assert.equal(record.original_prompt, BASE_INPUT.prompt)
    assert.equal(record.execution_prompt, BASE_INPUT.executionPrompt)
    assert.equal(record.session_id, BASE_INPUT.sessionId)
    assert.equal(record.latency_ms, BASE_INPUT.latencyMs)
  })
})

// ── listTurnDates ────────────────────────────────────────────────────────────

test('listTurnDates: empty when no data', () => {
  withTempData(() => {
    assert.deepEqual(listTurnDates(), [])
  })
})

test('listTurnDates: returns dates in ascending order', () => {
  withTempData(() => {
    // seed turns across three days via the ts test-seam (writeTurn honors input.ts)
    writeTurn({ ...BASE_INPUT, ts: '2026-06-03T10:00:00.000Z' }, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, ts: '2026-06-01T10:00:00.000Z' }, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, ts: '2026-06-02T10:00:00.000Z' }, BASE_CONFIG)
    const dates = listTurnDates()
    assert.deepEqual(dates, ['2026-06-01', '2026-06-02', '2026-06-03'])
  })
})

// ── countTotalTurns ──────────────────────────────────────────────────────────

test('countTotalTurns: returns 0 with no data', () => {
  withTempData(() => {
    assert.equal(countTotalTurns(), 0)
  })
})

test('countTotalTurns: counts across multiple days', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    writeTurn(BASE_INPUT, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, ts: '2026-01-01T10:00:00.000Z' }, BASE_CONFIG)
    const total = countTotalTurns()
    assert.equal(total, 3)
  })
})

// ── countTurnsForSpace / countCorrectionsForSpace (slash-command stats) ───────

test('countTurnsForSpace: counts only the given space', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, { ...BASE_CONFIG, language_space: 'english' })
    writeTurn(BASE_INPUT, { ...BASE_CONFIG, language_space: 'english' })
    writeTurn(BASE_INPUT, { ...BASE_CONFIG, language_space: 'spanish' })
    assert.equal(countTurnsForSpace('english'), 2)
    assert.equal(countTurnsForSpace('spanish'), 1)
    assert.equal(countTurnsForSpace('french'), 0)
  })
})

test('countCorrectionsForSpace: counts only the given space', () => {
  withTempData(() => {
    writeCorrection({ type: 'grammar', original: 'I has', corrected: 'I have' }, 'english')
    writeCorrection({ type: 'grammar', original: 'he go', corrected: 'he goes' }, 'english')
    writeCorrection({ type: 'gender', original: 'el casa', corrected: 'la casa' }, 'spanish')
    assert.equal(countCorrectionsForSpace('english'), 2)
    assert.equal(countCorrectionsForSpace('spanish'), 1)
    assert.equal(countCorrectionsForSpace('french'), 0)
  })
})

// ── writeTurn failure tolerance ──────────────────────────────────────────────

test('writeTurn: write failure does not throw', () => {
  withTempData((dir) => {
    // Block DB creation: place a regular file where the data dir should be, so
    // getDb()'s mkdir of that path fails. writeTurn must swallow the error.
    resetDb()
    fs.writeFileSync(path.join(dir, 'my-lingo'), 'not-a-dir')
    assert.doesNotThrow(() => writeTurn(BASE_INPUT, BASE_CONFIG))
  })
})

// ── cleanup verification ─────────────────────────────────────────────────────

test('withTempData: temp directory is cleaned up after test', () => {
  let capturedDir
  withTempData((dir) => {
    capturedDir = dir
    assert.ok(fs.existsSync(dir))
  })
  assert.ok(!fs.existsSync(capturedDir), `temp dir not cleaned up: ${capturedDir}`)
})

// ── v0.2: readCorrections ────────────────────────────────────────────────────

const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

test('writeCorrection + readCorrections: record is readable with correct fields', () => {
  withTempData(() => {
    const rec = { type: 'grammar', original: 'have bug', corrected: 'has a bug', explanation: 'test', pattern: 'subject-verb' }
    writeCorrection(rec, 'english')
    const results = readCorrections('english', [CURRENT_MONTH])
    assert.ok(results.length >= 1, 'should have at least 1 correction')
    const r = results[0]
    assert.equal(r.type, 'grammar')
    assert.equal(r.original, 'have bug')
    assert.equal(r.pattern, 'subject-verb')
  })
})

test('readCorrections: nonexistent month → empty array, no throw', () => {
  withTempData(() => {
    const results = readCorrections('english', ['1990-01'])
    assert.ok(Array.isArray(results))
    assert.equal(results.length, 0)
  })
})

test('readCorrections: empty monthKeys → empty array', () => {
  withTempData(() => {
    const results = readCorrections('english', [])
    assert.ok(Array.isArray(results))
    assert.equal(results.length, 0)
  })
})

// ── v0.2: readLearningItems ──────────────────────────────────────────────────

test('writeLearningItem + readLearningItems: record is readable', () => {
  withTempData(() => {
    const rec = { type: 'phrase', target_text: 'identify bugs', native_explanation: 'test', language_space: 'english' }
    writeLearningItem(rec, 'english')
    const results = readLearningItems('english', [CURRENT_MONTH])
    assert.ok(results.length >= 1)
    assert.equal(results[0].target_text, 'identify bugs')
  })
})

// ── v0.2: writeSession ───────────────────────────────────────────────────────

test('writeSession: session is readable and contains session_id', () => {
  withTempData(() => {
    writeSession({ session_id: 'sess-test-001', language_space: 'english', total_prompts: 5, optimized: 3, translated: 1, corrected: 2, fallbacks: 0, raws: 0, top_errors: [] })
    const row = readSession('sess-test-001')
    assert.ok(row, 'session row should exist')
    assert.equal(row.session_id, 'sess-test-001')
    assert.equal(row.total_prompts, 5)
    assert.ok(Array.isArray(row.top_errors), 'top_errors should round-trip to an array')
  })
})

test('writeSession: top_errors round-trips through JSON', () => {
  withTempData(() => {
    writeSession({ session_id: 'sess-te', language_space: 'english', total_prompts: 1, optimized: 1, translated: 0, corrected: 1, fallbacks: 0, raws: 0, top_errors: [{ pattern: 'tense', count: 2 }] })
    const row = readSession('sess-te')
    assert.equal(row.top_errors[0].pattern, 'tense')
    assert.equal(row.top_errors[0].count, 2)
  })
})

test('writeSession: same session_id replaces rather than duplicates', () => {
  withTempData(() => {
    writeSession({ session_id: 'sess-dup', language_space: 'english', total_prompts: 1, optimized: 1, translated: 0, corrected: 0, fallbacks: 0, raws: 0, top_errors: [] })
    writeSession({ session_id: 'sess-dup', language_space: 'english', total_prompts: 9, optimized: 9, translated: 0, corrected: 0, fallbacks: 0, raws: 0, top_errors: [] })
    const row = readSession('sess-dup')
    assert.equal(row.total_prompts, 9, 'second write should overwrite')
  })
})

// ── v0.2: listCorrectionMonths ───────────────────────────────────────────────

test('listCorrectionMonths: after writing corrections, returns array containing current month', () => {
  withTempData(() => {
    writeCorrection({ type: 'grammar', original: 'test', corrected: 'test2', explanation: 'e', pattern: 'p' }, 'english')
    const months = listCorrectionMonths('english')
    assert.ok(Array.isArray(months))
    assert.ok(months.includes(CURRENT_MONTH), `months should include ${CURRENT_MONTH}, got: ${months}`)
  })
})

test('listCorrectionMonths: missing space → empty array, no throw', () => {
  withTempData(() => {
    const months = listCorrectionMonths('nonexistent-space')
    assert.ok(Array.isArray(months))
    assert.equal(months.length, 0)
  })
})

// ── v0.2: readRecentTurns ────────────────────────────────────────────────────

test('readRecentTurns(5): 8 turns written → returns 5', () => {
  withTempData(() => {
    for (let i = 0; i < 8; i++) {
      writeTurn(BASE_INPUT, BASE_CONFIG)
    }
    const result = readRecentTurns(5)
    assert.equal(result.length, 5)
  })
})

test('readRecentTurns: returns most recent first', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, prompt: 'first' }, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, prompt: 'second' }, BASE_CONFIG)
    const result = readRecentTurns(2)
    assert.equal(result[0].original_prompt, 'second')
  })
})

test('readRecentTurns(0): returns empty array', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    const result = readRecentTurns(0)
    assert.ok(Array.isArray(result))
    assert.equal(result.length, 0)
  })
})

// ── v0.3: listItemMonths ─────────────────────────────────────────────────────

test('listItemMonths: after writing items, returns array containing current month', () => {
  withTempData(() => {
    const rec = { type: 'phrase', target_text: 'debug', native_explanation: 'test' }
    writeLearningItem(rec, 'english')
    const months = listItemMonths('english')
    assert.ok(Array.isArray(months))
    assert.ok(months.includes(CURRENT_MONTH), `should include ${CURRENT_MONTH}, got: ${months}`)
  })
})

test('listItemMonths: missing space → empty array, no throw', () => {
  withTempData(() => {
    const months = listItemMonths('nonexistent-space')
    assert.ok(Array.isArray(months))
    assert.equal(months.length, 0)
  })
})

// ── v0.3: updateLearningItemReview (by id) ───────────────────────────────────

test('updateLearningItemReview: updates matching item review_count and next_review', () => {
  withTempData(() => {
    writeLearningItem({ type: 'phrase', target_text: 'test phrase', native_explanation: 'foo', review_count: 0, next_review: null }, 'english')
    const [item] = readItemsDue('english')
    assert.ok(item && item.id, 'seeded item should have an id')
    updateLearningItemReview(item.id, 1)
    const updated = readLearningItems('english', [CURRENT_MONTH]).find(i => i.id === item.id)
    assert.ok(updated, 'item should still exist')
    assert.equal(updated.review_count, 1)
    assert.ok(updated.next_review !== null, 'next_review should be set')
    assert.ok(updated.interval_days >= 1, 'interval_days should be set')
  })
})

test('updateLearningItemReview: id not found → other items unchanged', () => {
  withTempData(() => {
    writeLearningItem({ type: 'phrase', target_text: 'unchanged', native_explanation: 'bar', review_count: 0, next_review: null }, 'english')
    const [item] = readItemsDue('english')
    updateLearningItemReview(999999, 5)
    const it = readLearningItems('english', [CURRENT_MONTH]).find(i => i.id === item.id)
    assert.ok(it, 'original item should still exist')
    assert.equal(it.review_count, 0, 'review_count should not change')
  })
})

test('updateLearningItemReview: nonexistent id → no throw', () => {
  withTempData(() => {
    assert.doesNotThrow(() => updateLearningItemReview(999999, 1))
  })
})

// ── v0.3: readItemsDue ───────────────────────────────────────────────────────

test('readItemsDue: item with null next_review is returned', () => {
  withTempData(() => {
    const rec = { type: 'phrase', target_text: 'due item', native_explanation: 'test', review_count: 0, next_review: null }
    writeLearningItem(rec, 'english')
    const due = readItemsDue('english')
    assert.ok(due.length >= 1, 'should have at least 1 due item')
    assert.ok(due.some(i => i.target_text === 'due item'), 'due item should be present')
  })
})

test('readItemsDue: items with future next_review are not returned', () => {
  withTempData(() => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString()
    const rec = { type: 'phrase', target_text: 'future item', native_explanation: 'test', review_count: 1, next_review: future }
    writeLearningItem(rec, 'english')
    const due = readItemsDue('english')
    assert.ok(!due.some(i => i.target_text === 'future item'), 'future item should NOT be due')
  })
})

test('readItemsDue: missing space → empty array, no throw', () => {
  withTempData(() => {
    const due = readItemsDue('nonexistent-space')
    assert.ok(Array.isArray(due))
    assert.equal(due.length, 0)
  })
})

// ── v0.4: writeResponseRecord + readResponsesForSession ─────────────────────

test('writeResponseRecord: record is readable', () => {
  withTempData(() => {
    writeResponseRecord({ session_id: 'sess-001', text: 'Hello response', word_count: 2 })
    const records = readResponsesForSession('sess-001', TODAY)
    assert.ok(records.length >= 1, 'should have at least 1 record')
  })
})

test('writeResponseRecord: record is readable with correct fields', () => {
  withTempData(() => {
    writeResponseRecord({ session_id: 'sess-001', text: 'Review complete.', word_count: 2 })
    const records = readResponsesForSession('sess-001', TODAY)
    const r = records[0]
    assert.equal(r.session_id, 'sess-001')
    assert.equal(r.text, 'Review complete.')
    assert.equal(r.word_count, 2)
    assert.ok(typeof r.ts === 'string', 'should have ts field')
  })
})

test('readResponsesForSession: filters by session_id', () => {
  withTempData(() => {
    writeResponseRecord({ session_id: 'sess-A', text: 'Response A', word_count: 2 })
    writeResponseRecord({ session_id: 'sess-B', text: 'Response B', word_count: 2 })
    const resultsA = readResponsesForSession('sess-A', TODAY)
    assert.ok(resultsA.every(r => r.session_id === 'sess-A'), 'should only return sess-A records')
    assert.ok(!resultsA.some(r => r.session_id === 'sess-B'), 'should not return sess-B records')
  })
})

test('readResponsesForSession: multiple responses for same session are all returned', () => {
  withTempData(() => {
    writeResponseRecord({ session_id: 'sess-X', text: 'Turn 1 response', word_count: 3 })
    writeResponseRecord({ session_id: 'sess-X', text: 'Turn 2 response', word_count: 3 })
    const results = readResponsesForSession('sess-X', TODAY)
    assert.ok(results.length >= 2, 'should return all responses for session')
  })
})

test('readResponsesForSession: unknown session → empty array, no throw', () => {
  withTempData(() => {
    const results = readResponsesForSession('sess-001', '1990-01-01')
    assert.ok(Array.isArray(results))
    assert.equal(results.length, 0)
  })
})

test('writeResponseRecord: write failure does not throw', () => {
  withTempData((dir) => {
    resetDb()
    fs.writeFileSync(path.join(dir, 'my-lingo'), 'not-a-dir')
    assert.doesNotThrow(() => writeResponseRecord({ session_id: 'sess-001', text: 'test', word_count: 1 }))
  })
})

// ── v0.5: readUnanalyzedTurns + markTurnsAnalyzed (idempotency) ──────────────

test('readUnanalyzedTurns: returns only turns for the session that are not analyzed', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, sessionId: 'sB' }, BASE_CONFIG)
    const unA = readUnanalyzedTurns('sA')
    assert.equal(unA.length, 2)
    assert.ok(unA.every(t => t.session_id === 'sA'))
  })
})

test('markTurnsAnalyzed: marked turns no longer returned by readUnanalyzedTurns', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    const before = readUnanalyzedTurns('sA')
    markTurnsAnalyzed(before.map(t => t.id))
    assert.equal(readUnanalyzedTurns('sA').length, 0)
  })
})

test('markTurnsAnalyzed: only marks the given ids, not the whole session', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    const first = readUnanalyzedTurns('sA')
    markTurnsAnalyzed(first.map(t => t.id))
    // a new turn arrives after the analysis pass
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    const remaining = readUnanalyzedTurns('sA')
    assert.equal(remaining.length, 1, 'the later turn must remain unanalyzed')
  })
})

test('readUnanalyzedTurns: null sessionId returns all unanalyzed turns', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    writeTurn({ ...BASE_INPUT, sessionId: 'sB' }, BASE_CONFIG)
    assert.equal(readUnanalyzedTurns(null).length, 2)
  })
})

test('markTurnsAnalyzed: empty list is a no-op', () => {
  withTempData(() => {
    writeTurn({ ...BASE_INPUT, sessionId: 'sA' }, BASE_CONFIG)
    assert.doesNotThrow(() => markTurnsAnalyzed([]))
    assert.equal(readUnanalyzedTurns('sA').length, 1)
  })
})

// ── v0.5: purge ──────────────────────────────────────────────────────────────

test('purgeSpace: removes corrections and items for the space only', () => {
  withTempData(() => {
    writeCorrection({ type: 'grammar', original: 'a', corrected: 'b', explanation: 'e', pattern: 'p' }, 'english')
    writeLearningItem({ type: 'phrase', target_text: 'x', native_explanation: 'y' }, 'english')
    writeCorrection({ type: 'grammar', original: 'c', corrected: 'd', explanation: 'e', pattern: 'p' }, 'french')
    purgeSpace('english')
    assert.equal(readCorrections('english', [CURRENT_MONTH]).length, 0)
    assert.equal(readLearningItems('english', [CURRENT_MONTH]).length, 0)
    assert.equal(readCorrections('french', [CURRENT_MONTH]).length, 1, 'other space untouched')
  })
})

test('purgeAll: clears all data, keeps sessions when requested', () => {
  withTempData(() => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    writeCorrection({ type: 'grammar', original: 'a', corrected: 'b', explanation: 'e', pattern: 'p' }, 'english')
    writeSession({ session_id: 'sK', language_space: 'english', total_prompts: 1, optimized: 1, translated: 0, corrected: 0, fallbacks: 0, raws: 0, top_errors: [] })
    purgeAll({ keepSessions: true })
    assert.equal(countTotalTurns(), 0)
    assert.equal(readCorrections('english', [CURRENT_MONTH]).length, 0)
    assert.ok(readSession('sK'), 'session should be kept')
    purgeAll()
    assert.equal(readSession('sK'), null, 'session should now be gone')
  })
})

// ── value coercion: malformed (non-bindable) fields must not drop the row ─────

test('writeCorrection: object/array fields are coerced to text, not dropped', () => {
  withTempData(() => {
    // node:sqlite cannot bind objects/arrays; without coercion .run() throws
    // inside the helper's catch{} and the row is silently lost. Simulates a
    // malformed LLM analysis result (pattern as array, original as object).
    writeCorrection({
      type: 'grammar',
      original: { raw: 'helo' },
      corrected: 'hello',
      explanation: 'spelling',
      pattern: ['spelling', 'typo'],
    }, 'english')

    const rows = readCorrections('english', [CURRENT_MONTH])
    assert.equal(rows.length, 1, 'malformed correction must still be written')
    assert.equal(rows[0].corrected, 'hello')
    assert.equal(typeof rows[0].pattern, 'string', 'array field coerced to text')
    assert.equal(rows[0].pattern, JSON.stringify(['spelling', 'typo']))
    assert.equal(rows[0].original, JSON.stringify({ raw: 'helo' }))
  })
})

test('writeLearningItem: object field is coerced to text, not dropped', () => {
  withTempData(() => {
    writeLearningItem({
      type: 'phrase',
      target_text: 'kick off',
      native_explanation: { zh: '开始' },
    }, 'english')

    const rows = readLearningItems('english', [CURRENT_MONTH])
    assert.equal(rows.length, 1, 'malformed item must still be written')
    assert.equal(rows[0].target_text, 'kick off')
    assert.equal(rows[0].native_explanation, JSON.stringify({ zh: '开始' }))
  })
})
