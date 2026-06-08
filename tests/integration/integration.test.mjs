// Integration tests for My Lingo hook scripts.
// Tests that require a live API use a local mock HTTP server instead.
// Run with: npm run test:integration
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startMockServer, stopServer,
  makeSuccessHandler, makeAuthErrorHandler, makeMarkdownHandler,
} from './mock-server.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import {
  makeTmpDir, cleanup,
  writeConfig, writeCircuitJson, circuitJsonExists, readCircuitJson,
  seedTurns, readTurnsForDate, seedCorrections, seedItems, dbCall,
  runHookSync, runHookAsync, runSessionEnd, runSessionEndAsync,
  ROOT,
} from './helpers.mjs'

// Minimal config shared across sync tests (no real API involved).
function baseConfig(overrides = {}) {
  return {
    execution_mode: 'english_optimized',
    native_language: 'en',  // no trailing summary noise
    timeout_seconds: 2,
    fallback_policy: 'send_original',
    privacy_mode: 'standard',
    ...overrides,
  }
}

// ── PT-004: -- prefix skips API and records turn as "raw" ───────────────────

test('PT-004: -- prefix — skips optimization, emits [my-lingo] --:', () => {
  const dataDir = makeTmpDir()
  try {
    // api_base_url points to an unreachable port — must NOT be called
    writeConfig(dataDir, baseConfig({ api_base_url: 'http://127.0.0.1:1', model_fast: 'test' }))
    const r = runHookSync('-- please check this code', { dataDir })

    assert.equal(r.status, 0, 'hook exits 0')
    assert.ok(r.json !== null, `stdout should be valid JSON, got: ${r.stdout}`)
    assert.ok(r.json.systemMessage?.includes('[my-lingo] --:'),
      `systemMessage should contain [my-lingo] --:, got: ${r.json.systemMessage}`)
    assert.ok(!r.json.additionalContext, 'no additionalContext should be emitted for --')

    // turn should be written with mode: "raw"
    const today = new Date().toISOString().slice(0, 10)
    const turns = readTurnsForDate(dataDir, today)
    assert.ok(turns.length > 0, 'a turn should be written to the DB')
    const last = turns[turns.length - 1]
    assert.equal(last.mode, 'raw', 'turn mode should be "raw"')
  } finally {
    cleanup(dataDir)
  }
})

// ── PT-002: Circuit breaker opens after first API failure ────────────────────

test('PT-002: circuit breaker — first failure gives "API unavailable", second gives "Circuit breaker open"', () => {
  const dataDir = makeTmpDir()
  try {
    // Port 1 causes immediate connection refused — no waiting for timeout
    writeConfig(dataDir, baseConfig())
    const prompt = '请帮我检查这段代码有没有问题'
    const credEnv = { MY_LINGO_API_BASE_URL: 'http://127.0.0.1:1', MY_LINGO_MODEL_FAST: 'test' }

    // Attempt 1: circuit closed → API fails → "API unavailable"
    const r1 = runHookSync(prompt, { dataDir, env: credEnv })
    assert.equal(r1.status, 0, 'attempt 1 exits 0')
    assert.ok(r1.json?.systemMessage?.includes('API unavailable'),
      `attempt 1 should say "API unavailable", got: ${r1.json?.systemMessage}`)

    // circuit.json should now exist
    assert.ok(circuitJsonExists(dataDir), 'circuit.json created after first failure')
    const c = readCircuitJson(dataDir)
    assert.equal(c.failure_count, 1)

    // Attempt 2: circuit open (recent failure) → "Circuit breaker open"
    const r2 = runHookSync(prompt, { dataDir, env: credEnv })
    assert.equal(r2.status, 0, 'attempt 2 exits 0')
    assert.ok(r2.json?.systemMessage?.includes('Circuit breaker open'),
      `attempt 2 should say "Circuit breaker open", got: ${r2.json?.systemMessage}`)
  } finally {
    cleanup(dataDir)
  }
})

// ── PT-006: session-end outputs stats to stderr ──────────────────────────────

test('PT-006: session-end — outputs correct stats to stderr', () => {
  const dataDir = makeTmpDir()
  try {
    const today = new Date().toISOString().slice(0, 10)
    const sessionId = 'test-session-006'

    seedTurns(dataDir, [
      // translated: non-english, optimized, not fallback
      { session_id: sessionId, mode: 'english_optimized', execution_prompt: 'Do X', detected_language: 'non-english', fallback: false },
      // corrected: english, optimized, not fallback
      { session_id: sessionId, mode: 'english_optimized', execution_prompt: 'Fix Y', detected_language: 'en', fallback: false },
      // raw: counts as -- (skip prefix)
      { session_id: sessionId, mode: 'raw', detected_language: 'en', fallback: false },
      // different session — must NOT be counted
      { session_id: 'other-session', mode: 'english_optimized', execution_prompt: 'Z', detected_language: 'en', fallback: false },
    ])

    const r = runSessionEnd({ dataDir, sessionId })

    assert.equal(r.status, 0, 'session-end exits 0')
    assert.equal(r.stdout, '', 'no stdout output')
    assert.ok(r.stderr.includes('[my-lingo] Session:'),
      `stderr should contain session summary, got: ${r.stderr}`)
    assert.ok(r.stderr.includes('3 prompts'),
      `should count 3 prompts for this session, got: ${r.stderr}`)
    assert.ok(r.stderr.includes('2 optimized'),
      `should count 2 optimized, got: ${r.stderr}`)
    assert.ok(r.stderr.includes('1 translated'),
      `should count 1 translated, got: ${r.stderr}`)
    assert.ok(r.stderr.includes('1 corrected'),
      `should count 1 corrected, got: ${r.stderr}`)
    assert.ok(r.stderr.includes('1 --'),
      `should count 1 --, got: ${r.stderr}`)
  } finally {
    cleanup(dataDir)
  }
})

// ── PT-001: API success → additionalContext with CANONICAL REQUEST ────────────

test('PT-001: API success — additionalContext contains CANONICAL REQUEST + execution_prompt_en', async () => {
  const { server, port } = await startMockServer(makeSuccessHandler({
    execution_prompt_en: 'Review this code for architectural issues',
    rewrite_type: 'translate',
    detected_input_language: 'zh-CN',
  }))
  const dataDir = makeTmpDir()
  try {
    writeConfig(dataDir, baseConfig())
    const r = await runHookAsync('检查这个代码有没有架构问题', { dataDir, env: { MY_LINGO_API_BASE_URL: `http://127.0.0.1:${port}`, MY_LINGO_MODEL_FAST: 'test' } })

    assert.equal(r.status, 0, 'hook exits 0')
    assert.ok(r.json !== null, `stdout should be valid JSON, got: ${r.stdout}`)
    assert.ok(r.json.additionalContext?.startsWith('CANONICAL REQUEST:'),
      `additionalContext should start with CANONICAL REQUEST:, got: ${r.json.additionalContext?.slice(0, 80)}`)
    assert.ok(r.json.additionalContext?.includes('Review this code for architectural issues'),
      'additionalContext should contain execution_prompt_en')
    assert.ok(r.json.systemMessage?.includes('[my-lingo]'),
      `systemMessage should be present, got: ${r.json.systemMessage}`)
  } finally {
    cleanup(dataDir)
    await stopServer(server)
  }
})

// ── PT-003: circuit.json deleted on successful API call ──────────────────────

test('PT-003: circuit breaker reset — circuit.json gone after cooldown expires and API succeeds', async () => {
  const { server, port } = await startMockServer(makeSuccessHandler({
    execution_prompt_en: 'Check this code for issues',
    rewrite_type: 'translate',
    detected_input_language: 'zh-CN',
  }))
  const dataDir = makeTmpDir()
  try {
    // Write circuit.json with a very old timestamp so cooldown is already expired.
    // checkCircuitBreaker() auto-deletes it and returns false → API call proceeds.
    writeCircuitJson(dataDir, { failure_count: 3, last_failure_at: 1000 })
    writeConfig(dataDir, baseConfig())

    assert.ok(circuitJsonExists(dataDir), 'circuit.json should exist before hook runs')

    const r = await runHookAsync('请帮我检查这段代码有没有问题', { dataDir, env: { MY_LINGO_API_BASE_URL: `http://127.0.0.1:${port}`, MY_LINGO_MODEL_FAST: 'test' } })
    assert.equal(r.status, 0, 'hook exits 0')
    assert.ok(!circuitJsonExists(dataDir), 'circuit.json should be gone after successful API call')
    assert.ok(r.json?.additionalContext?.includes('Check this code for issues'),
      'execution_prompt_en should appear in additionalContext')
  } finally {
    cleanup(dataDir)
    await stopServer(server)
  }
})

// ── PT-005: :: prefix → refine path ─────────────────────────────────────────

test('PT-005: :: prefix — refine path injects refinement notice into additionalContext', async () => {
  const { server, port } = await startMockServer(makeSuccessHandler({
    execution_prompt_en: 'Optimize test performance by using parallel execution and mocking I/O operations',
    rewrite_type: 'refine',
  }))
  const dataDir = makeTmpDir()
  try {
    writeConfig(dataDir, baseConfig())
    const r = await runHookAsync(':: make tests not slow', { dataDir, env: { MY_LINGO_API_BASE_URL: `http://127.0.0.1:${port}`, MY_LINGO_MODEL_FAST: 'test' } })

    assert.equal(r.status, 0, 'hook exits 0')
    assert.ok(r.json !== null, `stdout should be valid JSON, got: ${r.stdout}`)
    assert.ok(r.json.additionalContext?.includes(':: to request prompt refinement'),
      `additionalContext should mention refinement, got: ${r.json.additionalContext?.slice(0, 120)}`)
    assert.ok(r.json.additionalContext?.includes('Optimize test performance'),
      'additionalContext should contain refined execution_prompt_en')
    assert.ok(r.json.systemMessage?.includes('[my-lingo] Refined:'),
      `systemMessage should say [my-lingo] Refined:, got: ${r.json.systemMessage}`)
  } finally {
    cleanup(dataDir)
    await stopServer(server)
  }
})

// ── PT-008: authentication error → warning prepended to systemMessage ────────

test('PT-008: auth error — "[my-lingo] Authentication failed" in systemMessage', async () => {
  const { server, port } = await startMockServer(makeAuthErrorHandler())
  const dataDir = makeTmpDir()
  try {
    writeConfig(dataDir, baseConfig())
    const r = await runHookAsync('请帮我检查这段代码有没有问题', { dataDir, env: { MY_LINGO_API_BASE_URL: `http://127.0.0.1:${port}`, MY_LINGO_MODEL_FAST: 'test' } })

    assert.equal(r.status, 0, 'hook exits 0')
    assert.ok(r.json !== null, `stdout should be valid JSON, got: ${r.stdout}`)
    assert.ok(r.json.systemMessage?.includes('Authentication failed'),
      `systemMessage should mention auth failure, got: ${r.json.systemMessage}`)
  } finally {
    cleanup(dataDir)
    await stopServer(server)
  }
})

// ── PT-009: session-end analysis writes corrections JSONL with mock server ───

test('PT-009: session-end analysis — writes corrections and sessions JSONL', async () => {
  const { server, port } = await startMockServer(makeSuccessHandler({
    corrections: [{
      type: 'grammar',
      original: 'this have bug',
      corrected: 'this has a bug',
      explanation: 'subject-verb agreement',
      pattern: 'subject-verb agreement',
    }],
    learning_points: [{
      type: 'phrase',
      target_text: 'identify bugs',
      native_explanation: '找出 bug',
    }],
  }))
  const dataDir = makeTmpDir()
  try {
    const today = new Date().toISOString().slice(0, 10)
    const sessionId = 'test-session-009'

    writeConfig(dataDir, {
      execution_mode: 'english_optimized',
      native_language: 'zh-CN',
      timeout_seconds: 5,
    })

    seedTurns(dataDir, [
      {
        session_id: sessionId,
        mode: 'english_optimized',
        execution_prompt: 'This has a bug. Please review.',
        original_prompt: 'this have bug',
        detected_language: 'zh-CN',
        fallback: false,
      },
      {
        session_id: sessionId,
        mode: 'english_optimized',
        execution_prompt: 'Fix the code properly.',
        original_prompt: 'need fix code',
        detected_language: 'zh-CN',
        fallback: false,
      },
    ])

    const r = await runSessionEndAsync({ dataDir, sessionId, timeout: 10000, env: { MY_LINGO_API_BASE_URL: `http://127.0.0.1:${port}`, MY_LINGO_MODEL_FAST: 'test-model' } })

    assert.equal(r.status, 0, `session-end should exit 0, got ${r.status}, stderr: ${r.stderr}`)

    const currentMonth = today.slice(0, 7)
    const corrections = dbCall(dataDir, 'readCorrections', ['english', [currentMonth]])
    assert.ok(corrections.length >= 1, `should have at least 1 correction, got: ${corrections.length}`)

    const sessionRow = dbCall(dataDir, 'readSession', [sessionId])
    assert.ok(sessionRow, `session row should exist for ${sessionId}`)
  } finally {
    cleanup(dataDir)
    await stopServer(server)
  }
})

// ── PT-010: session-end skips analysis for raw-only turns ────────────────────

test('PT-010: session-end — raw-only turns skip analysis, no corrections file', () => {
  const dataDir = makeTmpDir()
  try {
    const today = new Date().toISOString().slice(0, 10)
    const sessionId = 'test-session-010'

    writeConfig(dataDir, {
      execution_mode: 'english_optimized',
      api_base_url: 'http://127.0.0.1:1',
      model_fast: 'test-model',
      timeout_seconds: 1,
    })

    seedTurns(dataDir, [
      { session_id: sessionId, mode: 'raw', detected_language: 'en', fallback: false },
      { session_id: sessionId, mode: 'raw', detected_language: 'en', fallback: false },
    ])

    const r = runSessionEnd({ dataDir, sessionId })

    assert.equal(r.status, 0, 'session-end should exit 0')

    const currentMonth = today.slice(0, 7)
    const corrections = dbCall(dataDir, 'readCorrections', ['english', [currentMonth]])
    assert.equal(corrections.length, 0, 'no corrections should exist for raw-only session')
  } finally {
    cleanup(dataDir)
  }
})

// ── PT-011: generate-lesson.mjs generates lesson via mock server ──────────────

test('PT-011: generate-lesson.mjs — creates lesson file and outputs markdown', async () => {
  const lessonMarkdown = '# My Lingo Lesson\n\n## Summary\nFocus on verb agreement.\n'
  const { server, port } = await startMockServer(makeMarkdownHandler(lessonMarkdown))
  const dataDir = makeTmpDir()
  try {
    const today = new Date().toISOString().slice(0, 10)
    const currentMonth = today.slice(0, 7)

    // Pre-seed some corrections so generate-lesson has data to work with
    seedCorrections(dataDir, 'english', [
      { ts: new Date().toISOString(), type: 'grammar', original: 'this have bug', corrected: 'this has a bug', explanation: 'test', pattern: 'subject-verb' },
      { ts: new Date().toISOString(), type: 'grammar', original: 'need fix', corrected: 'need to fix', explanation: 'test2', pattern: 'infinitive' },
      { ts: new Date().toISOString(), type: 'grammar', original: 'have problem', corrected: 'has a problem', explanation: 'test3', pattern: 'subject-verb' },
    ])

    writeConfig(dataDir, {
      execution_mode: 'english_optimized',
      native_language: 'zh-CN',
      timeout_seconds: 10,
    })

    const result = await new Promise((resolve) => {
      const child = spawn('node', [path.join(ROOT, 'scripts/generate-lesson.mjs'), '--days', '7'], {
        env: {
          ...process.env,
          CLAUDE_PLUGIN_DATA: dataDir,
          MY_LINGO_API_KEY: 'sk-test',
          MY_LINGO_API_BASE_URL: `http://127.0.0.1:${port}`,
          MY_LINGO_MODEL_FAST: 'test-model',
          MY_LINGO_MODEL_DEEP: 'test-model',
        },
        cwd: ROOT,
      })
      let stdout = '', stderr = ''
      child.stdout.on('data', d => { stdout += d })
      child.stderr.on('data', d => { stderr += d })
      child.on('close', status => resolve({ stdout, stderr, status }))
      setTimeout(() => { child.kill(); resolve({ stdout, stderr, status: -1 }) }, 15000)
    })

    assert.equal(result.status, 0, `generate-lesson should exit 0, stderr: ${result.stderr}`)
    assert.ok(result.stdout.includes('# My Lingo Lesson'), `stdout should contain lesson heading, got: ${result.stdout.slice(0, 200)}`)

    const lessonFile = path.join(dataDir, 'my-lingo', 'learning', 'english', `lessons-${today}.md`)
    assert.ok(fs.existsSync(lessonFile), `lesson file should exist: ${lessonFile}`)
    const fileContent = fs.readFileSync(lessonFile, 'utf8')
    assert.ok(fileContent.includes('# My Lingo Lesson'), 'lesson file should contain heading')
  } finally {
    cleanup(dataDir)
    await stopServer(server)
  }
})

// ── PT-012: SRS due items correctly filtered (storage unit test) ──────────────

test('PT-012: readItemsDue — correctly filters due items, null sorts first', () => {
  const dataDir = makeTmpDir()
  try {
    const pastDate = new Date(Date.now() - 2 * 86400000).toISOString()
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString()

    seedItems(dataDir, 'english', [
      { ts: 'ts-a', type: 'phrase', target_text: 'item A (past)', native_explanation: 'past due', review_count: 1, next_review: pastDate },
      { ts: 'ts-b', type: 'phrase', target_text: 'item B (null)', native_explanation: 'never reviewed', review_count: 0, next_review: null },
      { ts: 'ts-c', type: 'phrase', target_text: 'item C (future)', native_explanation: 'not yet due', review_count: 1, next_review: futureDate },
    ])

    const due = dbCall(dataDir, 'readItemsDue', ['english'])

    const dueTss = due.map(i => i.ts)
    assert.ok(dueTss.includes('ts-a'), 'item A (past) should be due')
    assert.ok(dueTss.includes('ts-b'), 'item B (null) should be due')
    assert.ok(!dueTss.includes('ts-c'), 'item C (future) should NOT be due')

    // Verify B (null) comes before A (past)
    const bIdx = dueTss.indexOf('ts-b')
    const aIdx = dueTss.indexOf('ts-a')
    assert.ok(bIdx < aIdx, `null item (B) should come before past item (A), got order: ${dueTss}`)
  } finally {
    cleanup(dataDir)
  }
})
