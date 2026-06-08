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
  listCorrectionMonths,
  readRecentTurns,
  listItemMonths,
  updateLearningItemReview,
  readItemsDue,
  writeResponseRecord,
  readResponsesForSession,
} from '../scripts/lib/storage.mjs'

function withTempData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-stor-test-'))
  const prev = process.env.CLAUDE_PLUGIN_DATA
  process.env.CLAUDE_PLUGIN_DATA = dir
  try {
    fn(dir)
  } finally {
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

test('writeTurn: JSONL file is created after write', () => {
  withTempData((dir) => {
    writeTurn(BASE_INPUT, BASE_CONFIG)
    const file = path.join(dir, 'my-lingo', 'turns', `${TODAY}.jsonl`)
    assert.ok(fs.existsSync(file), `JSONL file not found: ${file}`)
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
  withTempData((dir) => {
    const turnsDir = path.join(dir, 'my-lingo', 'turns')
    fs.mkdirSync(turnsDir, { recursive: true })
    fs.writeFileSync(path.join(turnsDir, '2026-06-03.jsonl'), '{"ts":"t","session_id":null,"cwd":"/","language_space":"english","mode":"original","detected_language":"en","original_prompt":"p","execution_prompt":null,"rewrite_type":null,"latency_ms":null,"fallback":false,"fallback_reason":null}\n')
    fs.writeFileSync(path.join(turnsDir, '2026-06-01.jsonl'), '{"ts":"t","session_id":null,"cwd":"/","language_space":"english","mode":"original","detected_language":"en","original_prompt":"p","execution_prompt":null,"rewrite_type":null,"latency_ms":null,"fallback":false,"fallback_reason":null}\n')
    fs.writeFileSync(path.join(turnsDir, '2026-06-02.jsonl'), '{"ts":"t","session_id":null,"cwd":"/","language_space":"english","mode":"original","detected_language":"en","original_prompt":"p","execution_prompt":null,"rewrite_type":null,"latency_ms":null,"fallback":false,"fallback_reason":null}\n')
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

    // write a second day manually
    const dir = getDataDir()
    const turnsDir = path.join(dir, 'turns')
    fs.mkdirSync(turnsDir, { recursive: true })
    const line = JSON.stringify({ ...BASE_INPUT, ts: new Date().toISOString() }) + '\n'
    fs.appendFileSync(path.join(turnsDir, '2026-01-01.jsonl'), line)

    const total = countTotalTurns()
    assert.ok(total >= 3, `expected at least 3, got ${total}`)
  })
})

// ── writeTurn failure tolerance ──────────────────────────────────────────────

test('writeTurn: write failure does not throw', () => {
  withTempData((dir) => {
    // make turns dir read-only to force write failure
    const turnsDir = path.join(dir, 'my-lingo', 'turns')
    fs.mkdirSync(turnsDir, { recursive: true })
    fs.chmodSync(turnsDir, 0o444)
    try {
      assert.doesNotThrow(() => writeTurn(BASE_INPUT, BASE_CONFIG))
    } finally {
      fs.chmodSync(turnsDir, 0o755)
    }
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

test('writeSession: sessions file is created and contains session_id', () => {
  withTempData((dir) => {
    writeSession({ session_id: 'sess-test-001', language_space: 'english', total_prompts: 5, optimized: 3, translated: 1, corrected: 2, fallbacks: 0, raws: 0, top_errors: [] })
    const today = new Date().toISOString().slice(0, 10)
    const file = path.join(dir, 'my-lingo', 'sessions', `${today}.jsonl`)
    assert.ok(fs.existsSync(file), `sessions file not found: ${file}`)
    const content = fs.readFileSync(file, 'utf8')
    assert.ok(content.includes('sess-test-001'), 'sessions file should contain session_id')
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

test('listCorrectionMonths: directory missing → empty array, no throw', () => {
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

test('listItemMonths: directory missing → empty array, no throw', () => {
  withTempData(() => {
    const months = listItemMonths('nonexistent-space')
    assert.ok(Array.isArray(months))
    assert.equal(months.length, 0)
  })
})

// ── v0.3: updateLearningItemReview ──────────────────────────────────────────

test('updateLearningItemReview: updates matching item review_count and next_review', () => {
  withTempData(() => {
    const now = new Date().toISOString()
    const rec = { ts: now, type: 'phrase', target_text: 'test phrase', native_explanation: 'foo', review_count: 0, next_review: null }
    writeLearningItem(rec, 'english')
    updateLearningItemReview('english', CURRENT_MONTH, now, 1)
    const items = readLearningItems('english', [CURRENT_MONTH])
    const updated = items.find(i => i.ts === now)
    assert.ok(updated, 'item should still exist')
    assert.equal(updated.review_count, 1)
    assert.ok(updated.next_review !== null, 'next_review should be set')
  })
})

test('updateLearningItemReview: ts not found → other items unchanged', () => {
  withTempData(() => {
    const now = new Date().toISOString()
    const rec = { ts: now, type: 'phrase', target_text: 'unchanged', native_explanation: 'bar', review_count: 0, next_review: null }
    writeLearningItem(rec, 'english')
    updateLearningItemReview('english', CURRENT_MONTH, 'nonexistent-ts', 5)
    const items = readLearningItems('english', [CURRENT_MONTH])
    const item = items.find(i => i.ts === now)
    assert.ok(item, 'original item should still exist')
    assert.equal(item.review_count, 0, 'review_count should not change')
  })
})

test('updateLearningItemReview: missing file → no throw', () => {
  withTempData(() => {
    assert.doesNotThrow(() => updateLearningItemReview('english', '2000-01', 'fake-ts', 1))
  })
})

// ── v0.3: readItemsDue ───────────────────────────────────────────────────────

test('readItemsDue: item with null next_review is returned', () => {
  withTempData(() => {
    const now = new Date().toISOString()
    const rec = { ts: now, type: 'phrase', target_text: 'due item', native_explanation: 'test', review_count: 0, next_review: null }
    writeLearningItem(rec, 'english')
    const due = readItemsDue('english')
    assert.ok(due.length >= 1, 'should have at least 1 due item')
    assert.ok(due.some(i => i.target_text === 'due item'), 'due item should be present')
  })
})

test('readItemsDue: items with future next_review are not returned', () => {
  withTempData(() => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString()
    const now = new Date().toISOString()
    const rec = { ts: now, type: 'phrase', target_text: 'future item', native_explanation: 'test', review_count: 1, next_review: future }
    writeLearningItem(rec, 'english')
    const due = readItemsDue('english')
    assert.ok(!due.some(i => i.target_text === 'future item'), 'future item should NOT be due')
  })
})

test('readItemsDue: directory missing → empty array, no throw', () => {
  withTempData(() => {
    const due = readItemsDue('nonexistent-space')
    assert.ok(Array.isArray(due))
    assert.equal(due.length, 0)
  })
})

// ── v0.4: writeResponseRecord + readResponsesForSession ─────────────────────

test('writeResponseRecord: creates responses file in correct path', () => {
  withTempData((dir) => {
    writeResponseRecord({ session_id: 'sess-001', text: 'Hello response', word_count: 2 })
    const file = path.join(dir, 'my-lingo', 'responses', `${TODAY}.jsonl`)
    assert.ok(fs.existsSync(file), `responses file not found: ${file}`)
  })
})

test('writeResponseRecord: record is readable with correct fields', () => {
  withTempData(() => {
    writeResponseRecord({ session_id: 'sess-001', text: 'Review complete.', word_count: 2 })
    const records = readResponsesForSession('sess-001', TODAY)
    assert.ok(records.length >= 1, 'should have at least 1 record')
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

test('readResponsesForSession: nonexistent date → empty array, no throw', () => {
  withTempData(() => {
    const results = readResponsesForSession('sess-001', '1990-01-01')
    assert.ok(Array.isArray(results))
    assert.equal(results.length, 0)
  })
})

test('writeResponseRecord: write failure does not throw', () => {
  withTempData((dir) => {
    const respDir = path.join(dir, 'my-lingo', 'responses')
    fs.mkdirSync(respDir, { recursive: true })
    fs.chmodSync(respDir, 0o444)
    try {
      assert.doesNotThrow(() => writeResponseRecord({ session_id: 'sess-001', text: 'test', word_count: 1 }))
    } finally {
      fs.chmodSync(respDir, 0o755)
    }
  })
})
