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
    assert.ok('execution_mode' in record, 'missing execution_mode')
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
    fs.writeFileSync(path.join(turnsDir, '2026-06-03.jsonl'), '{"ts":"t","session_id":null,"cwd":"/","language_space":"english","execution_mode":"original","mode":"original","detected_language":"en","original_prompt":"p","execution_prompt":null,"rewrite_type":null,"latency_ms":null,"fallback":false,"fallback_reason":null}\n')
    fs.writeFileSync(path.join(turnsDir, '2026-06-01.jsonl'), '{"ts":"t","session_id":null,"cwd":"/","language_space":"english","execution_mode":"original","mode":"original","detected_language":"en","original_prompt":"p","execution_prompt":null,"rewrite_type":null,"latency_ms":null,"fallback":false,"fallback_reason":null}\n')
    fs.writeFileSync(path.join(turnsDir, '2026-06-02.jsonl'), '{"ts":"t","session_id":null,"cwd":"/","language_space":"english","execution_mode":"original","mode":"original","detected_language":"en","original_prompt":"p","execution_prompt":null,"rewrite_type":null,"latency_ms":null,"fallback":false,"fallback_reason":null}\n')
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
