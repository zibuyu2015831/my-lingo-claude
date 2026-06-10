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
  runCommandBlock, runCommandBlockEnvBlind, writeInstallPointerAt,
  ROOT,
} from './helpers.mjs'
import os from 'node:os'

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

// ── PT-002: Circuit breaker trips only after 3 consecutive failures (D4) ──────

test('PT-002: circuit breaker — transient failures retry; opens only after the 3rd', () => {
  const dataDir = makeTmpDir()
  try {
    // Port 1 causes immediate connection refused — no waiting for timeout
    writeConfig(dataDir, baseConfig())
    const prompt = '请帮我检查这段代码有没有问题'
    const credEnv = { MY_LINGO_API_BASE_URL: 'http://127.0.0.1:1', MY_LINGO_MODEL_FAST: 'test' }

    // Attempts 1 & 2: a single/double transient blip must NOT pause the API —
    // each still attempts the call and reports "API unavailable".
    for (const attempt of [1, 2]) {
      const r = runHookSync(prompt, { dataDir, env: credEnv })
      assert.equal(r.status, 0, `attempt ${attempt} exits 0`)
      assert.ok(r.json?.systemMessage?.includes('API unavailable'),
        `attempt ${attempt} should say "API unavailable", got: ${r.json?.systemMessage}`)
      assert.equal(readCircuitJson(dataDir).failure_count, attempt, `failure_count after attempt ${attempt}`)
    }

    // Attempt 3: the 3rd consecutive failure trips the breaker.
    const r3 = runHookSync(prompt, { dataDir, env: credEnv })
    assert.equal(readCircuitJson(dataDir).failure_count, 3)
    assert.ok(r3.json?.systemMessage?.includes('tripped'),
      `attempt 3 should announce the breaker tripped, got: ${r3.json?.systemMessage}`)

    // Attempt 4: breaker now OPEN → API skipped → "Circuit breaker open".
    const r4 = runHookSync(prompt, { dataDir, env: credEnv })
    assert.equal(r4.status, 0, 'attempt 4 exits 0')
    assert.ok(r4.json?.systemMessage?.includes('Circuit breaker open'),
      `attempt 4 should say "Circuit breaker open", got: ${r4.json?.systemMessage}`)
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

    const items = dbCall(dataDir, 'readLearningItems', ['english', [currentMonth]])
    assert.ok(items.length >= 1, `should have at least 1 learning item, got: ${items.length}`)

    const sessionRow = dbCall(dataDir, 'readSession', [sessionId])
    assert.ok(sessionRow, `session row should exist for ${sessionId}`)

    // Turns must be marked analyzed so a rerun is an idempotent no-op.
    const unanalyzed = dbCall(dataDir, 'readUnanalyzedTurns', [sessionId])
    assert.equal(unanalyzed.length, 0, 'all turns should be marked analyzed after a successful run')
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

    const lessonFile = path.join(dataDir, 'learning', 'english', `lessons-${today}.md`)
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

// ── PT-013: data commands resolve modules from a foreign cwd ──────────────────
// Regression guard: commands must import via $CLAUDE_PLUGIN_ROOT, not a cwd-
// relative './scripts/...' path. In real use the command's bash runs in the
// USER'S project dir, not the plugin root — a relative import throws
// ERR_MODULE_NOT_FOUND there. Every other helper runs with cwd:ROOT and so
// masked this; runCommandBlock deliberately runs from os.tmpdir().

test('PT-013: data commands run from a foreign cwd and render seeded data', () => {
  const dataDir = makeTmpDir()
  try {
    const sessionId = 'test-session-013'
    writeConfig(dataDir, { execution_mode: 'english_optimized', native_language: 'zh-CN' })
    fs.writeFileSync(
      path.join(dataDir, 'spaces.json'),
      JSON.stringify({ active: 'english', spaces: { english: {} } }),
    )

    seedTurns(dataDir, [
      { session_id: sessionId, mode: 'english_optimized', detected_language: 'en',
        original_prompt: 'helo wrld', execution_prompt: 'Hello world', rewrite_type: 'correction', fallback: false },
    ])
    seedCorrections(dataDir, 'english', [
      { ts: new Date().toISOString(), session_id: sessionId, type: 'grammar',
        original: 'helo wrld', corrected: 'hello world', explanation: 'spelling', pattern: 'spelling' },
    ])
    seedItems(dataDir, 'english', [
      { ts: new Date().toISOString(), session_id: sessionId, type: 'phrase',
        target_text: 'kick off', native_explanation: '开始' },
      { ts: new Date().toISOString(), session_id: sessionId, type: 'sentence_pattern',
        target_text: 'Could you ...?', native_explanation: '请求' },
    ])

    // [command, substring that only appears when seeded data was actually read]
    const cases = [
      ['info', 'Total turns:  1'],
      ['recent', 'helo wrld'],
      ['last', 'Hello world'],
      ['errors', 'hello world'],
      ['space', 'english'],
      ['spaces', 'english'],
      ['vocab', 'kick off'],
      ['sentences', 'Could you ...?'],
      ['review', 'kick off'],
      ['profile', 'Total turns:'],
      ['export', 'kick off'],
    ]

    for (const [name, needle] of cases) {
      const r = runCommandBlock(name, { dataDir })
      assert.equal(r.status, 0, `/${name} should exit 0 from a foreign cwd, stderr: ${r.stderr}`)
      assert.ok(
        r.stdout.includes(needle),
        `/${name} output should contain "${needle}" (seeded data not rendered). Got:\n${r.stdout}\n${r.stderr}`,
      )
    }
  } finally {
    cleanup(dataDir)
  }
})

// ── PT-015: env-blind production form — commands resolve via the install pointer ─
// The REAL production form: a user runs the slash command from their own project,
// so the command's bash subprocess sees NEITHER CLAUDE_PLUGIN_ROOT NOR
// CLAUDE_PLUGIN_DATA. The hook has written install.json; commands must read it to
// locate both the plugin root (to import modules) and the data dir (to read data).
// The old harness always injected both env vars and so could never catch the
// silent-fallback bug this guards against. dev_docs/14 §六-F / §10.5.6.

test('PT-015: data commands resolve via install.json pointer with NO plugin env vars', () => {
  const dataDir = makeTmpDir()
  const home = makeTmpDir()
  try {
    const sessionId = 'test-session-015'
    // Seed straight into dataDir (getDataDir() == CLAUDE_PLUGIN_DATA == dataDir here).
    seedTurns(dataDir, [
      { session_id: sessionId, mode: 'english_optimized', detected_language: 'en',
        original_prompt: 'helo wrld', execution_prompt: 'Hello world', rewrite_type: 'correction', fallback: false },
    ])
    seedItems(dataDir, 'english', [
      { ts: new Date().toISOString(), session_id: sessionId, type: 'phrase',
        target_text: 'kick off', native_explanation: '开始' },
    ])
    // The hook would have written this pointer; commands must rely on it alone.
    writeInstallPointerAt(home, { pluginRoot: ROOT, dataDir })

    const cases = [
      ['info', 'Total turns:  1'],
      ['recent', 'helo wrld'],
      ['last', 'Hello world'],
      ['vocab', 'kick off'],
      ['space', 'english'],
    ]
    for (const [name, needle] of cases) {
      const r = runCommandBlockEnvBlind(name, { home })
      assert.equal(r.status, 0, `/${name} should exit 0 env-blind via pointer, stderr: ${r.stderr}`)
      assert.ok(
        r.stdout.includes(needle),
        `/${name} env-blind output should contain "${needle}". Got:\n${r.stdout}\n${r.stderr}`,
      )
    }
  } finally {
    cleanup(dataDir)
    cleanup(home)
  }
})

// ── PT-016: no pointer + no env → loud, actionable failure (NOT a silent "0") ──
// Before the fix, an unresolved data dir fell back to a phantom directory and
// commands cheerfully printed "0 turns". The whole point of the rewrite is that
// this now fails loudly. dev_docs/14 §10.2 ③ / §10.5.6.

test('PT-016: a read command with a resolvable plugin but no data dir fails loudly, not silently', () => {
  const home = makeTmpDir()
  try {
    // Pointer can locate the plugin (so modules import) but carries NO data_dir,
    // mimicking "hook never recorded the real data dir". getDataDir() must throw
    // a clear error instead of silently falling back to a phantom "0 turns" dir.
    writeInstallPointerAt(home, { pluginRoot: ROOT, dataDir: undefined })
    const r = runCommandBlockEnvBlind('info', { home })
    assert.notEqual(r.status, 0, `/info should fail (non-zero) when the data dir is unresolvable. stdout:\n${r.stdout}`)
    assert.ok(
      /data dir unresolved/.test(r.stderr) || /data dir unresolved/.test(r.stdout),
      `error should explain how to recover. stdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    )
  } finally {
    cleanup(home)
  }
})
