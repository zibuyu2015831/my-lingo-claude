// End-to-end tests against a REAL OpenAI-compatible LLM endpoint.
//
// Unlike tests/integration/*, these drive the actual plugin scripts against a
// live provider — no mock server. Credentials come from a gitignored .env at the
// repo root (see .env.example). When MY_LINGO_* is absent the whole suite SKIPS
// silently, so `npm test` and CI stay green without secrets.
//
//   cp .env.example .env  &&  edit .env  &&  npm run test:e2e
//
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  ROOT, makeTmpDir, cleanup, writeConfig,
  runHookAsync, runSessionEndAsync,
  seedTurns, seedCorrections, dbCall, readTurnsForDate,
} from '../integration/helpers.mjs'

// Load repo-root .env into process.env. Harmless (and silent) when absent.
try { process.loadEnvFile(path.join(ROOT, '.env')) } catch {}

const HAVE_CREDS = !!(
  process.env.MY_LINGO_API_KEY &&
  process.env.MY_LINGO_API_BASE_URL &&
  process.env.MY_LINGO_MODEL_FAST &&
  // a bare placeholder ("sk-...") counts as "not configured"
  process.env.MY_LINGO_API_KEY !== 'sk-...'
)
const skip = HAVE_CREDS ? false : '需在 .env 中设置真实的 MY_LINGO_* 才会运行 E2E'

// Real creds handed to each spawned hook. helpers' baseEnv() spreads `...extra`
// AFTER its default MY_LINGO_API_KEY:'sk-test' (helpers.mjs), so these win.
const creds = {
  MY_LINGO_API_KEY: process.env.MY_LINGO_API_KEY,
  MY_LINGO_API_BASE_URL: process.env.MY_LINGO_API_BASE_URL,
  MY_LINGO_MODEL_FAST: process.env.MY_LINGO_MODEL_FAST,
  MY_LINGO_MODEL_DEEP: process.env.MY_LINGO_MODEL_DEEP || process.env.MY_LINGO_MODEL_FAST,
}

// Real endpoints are slower than the local mock — give them headroom. Credential
// fields are intentionally NOT written to config.json; they arrive via env,
// exactly as in production (config.mjs Layer 0). deep_timeout_seconds is raised
// well past the 12s production default so slow reasoning deep models (e.g.
// gemini-2.5-pro, ~24s) can finish the analysis call inside the test.
function e2eConfig() {
  return {
    execution_mode: 'english_optimized',
    native_language: 'zh-CN',
    timeout_seconds: 20,
    deep_timeout_seconds: 60,
  }
}

const today = () => new Date().toISOString().slice(0, 10)

// ── E2E-1: real optimization — zh prompt comes back as structured English ─────

test('E2E-1: optimization — real LLM returns CANONICAL REQUEST with English', { skip }, async () => {
  const dataDir = makeTmpDir()
  try {
    writeConfig(dataDir, e2eConfig())
    const r = await runHookAsync('检查这个项目有没有架构问题，先不要修改代码。', { dataDir, env: creds })

    assert.equal(r.status, 0, `hook exits 0, stderr: ${r.stderr}`)
    assert.ok(r.json, `stdout should be JSON, got: ${r.stdout}`)
    assert.ok(r.json.additionalContext?.startsWith('CANONICAL REQUEST:'),
      `additionalContext should start with CANONICAL REQUEST:, got: ${r.json.additionalContext?.slice(0, 100)}`)
    // the optimized English must be non-trivial and actually present after the preamble
    const after = (r.json.additionalContext || '').split('\n\n').slice(1).join('\n\n')
    assert.ok(after.trim().length > 10, `optimized English should be non-empty, got: ${after.slice(0, 120)}`)
    assert.ok(r.json.systemMessage?.includes('[my-lingo]'),
      `systemMessage should contain [my-lingo], got: ${r.json.systemMessage}`)

    const turns = readTurnsForDate(dataDir, today())
    assert.ok(turns.length >= 1, 'a turn should be recorded')
    const last = turns[turns.length - 1]
    assert.equal(last.fallback, false, 'a real success must not be a fallback')
    assert.ok((last.execution_prompt || '').trim().length > 0, 'execution_prompt should be stored')
    console.log('  [E2E-1] optimized →', (last.execution_prompt || '').slice(0, 120))
  } finally {
    cleanup(dataDir)
  }
})

// ── E2E-2: refine mode (::) — rough idea polished by the real LLM ─────────────

test('E2E-2: refine (::) — real LLM polishes a rough idea', { skip }, async () => {
  const dataDir = makeTmpDir()
  try {
    writeConfig(dataDir, e2eConfig())
    const r = await runHookAsync(':: 让测试不那么慢', { dataDir, env: creds })

    assert.equal(r.status, 0, `hook exits 0, stderr: ${r.stderr}`)
    assert.ok(r.json, `stdout should be JSON, got: ${r.stdout}`)
    assert.ok(r.json.additionalContext?.includes(':: to request prompt refinement'),
      `additionalContext should mention refinement, got: ${r.json.additionalContext?.slice(0, 120)}`)
    assert.ok(r.json.systemMessage?.includes('[my-lingo] Refined:'),
      `systemMessage should say Refined, got: ${r.json.systemMessage}`)
    console.log('  [E2E-2] refined →', (r.json.systemMessage || '').slice(0, 120))
  } finally {
    cleanup(dataDir)
  }
})

// ── E2E-3: -- pass-through — no API call, recorded as raw ──────────────────────

test('E2E-3: -- pass-through — skips optimization, records raw turn', { skip }, async () => {
  const dataDir = makeTmpDir()
  try {
    writeConfig(dataDir, e2eConfig())
    const r = await runHookAsync('-- implement this in Python', { dataDir, env: creds })

    assert.equal(r.status, 0, `hook exits 0, stderr: ${r.stderr}`)
    assert.ok(r.json.systemMessage?.includes('[my-lingo] --:'),
      `systemMessage should contain [my-lingo] --:, got: ${r.json.systemMessage}`)
    assert.ok(!r.json.additionalContext, 'no additionalContext for -- pass-through')

    const turns = readTurnsForDate(dataDir, today())
    assert.equal(turns[turns.length - 1].mode, 'raw', 'turn mode should be "raw"')
  } finally {
    cleanup(dataDir)
  }
})

// ── E2E-4: session-end analysis — real LLM extracts corrections/items ─────────

test('E2E-4: session analysis — real LLM runs the learning pipeline end-to-end', { skip }, async () => {
  const dataDir = makeTmpDir()
  try {
    const sessionId = 'e2e-session-analysis'
    writeConfig(dataDir, e2eConfig())

    // Seed turns whose originals carry deliberate English mistakes for the
    // analyzer to find. (execution_prompt is the corrected version Claude saw.)
    seedTurns(dataDir, [
      { session_id: sessionId, mode: 'english_optimized', detected_language: 'zh-CN', fallback: false,
        original_prompt: 'this code have a bug, please fix it', execution_prompt: 'This code has a bug — please fix it.' },
      { session_id: sessionId, mode: 'english_optimized', detected_language: 'zh-CN', fallback: false,
        original_prompt: 'i want to refactor this function for more clean', execution_prompt: 'I want to refactor this function to be cleaner.' },
    ])

    const r = await runSessionEndAsync({ dataDir, sessionId, timeout: 90000, env: creds })
    assert.equal(r.status, 0, `session-end should exit 0, stderr: ${r.stderr}`)

    // Pipeline must complete — session row written, turns marked analyzed.
    const sessionRow = dbCall(dataDir, 'readSession', [sessionId])
    assert.ok(sessionRow, `session row should exist for ${sessionId}`)
    const unanalyzed = dbCall(dataDir, 'readUnanalyzedTurns', [sessionId])
    assert.equal(unanalyzed.length, 0, 'all turns should be marked analyzed after a successful run')

    // The seeds carry blatant errors ("this code have a bug", "for more clean"),
    // so a working analyzer must surface at least one correction or learning item.
    // (0/0 previously meant a silent timeout/parse failure — a false green.)
    const month = today().slice(0, 7)
    const corrections = dbCall(dataDir, 'readCorrections', ['english', [month]]) || []
    const items = dbCall(dataDir, 'readLearningItems', ['english', [month]]) || []
    console.log(`  [E2E-4] corrections=${corrections.length} learning_items=${items.length}`)
    assert.ok(corrections.length + items.length >= 1,
      'analysis should produce ≥1 correction or learning item for obviously-flawed input')
  } finally {
    cleanup(dataDir)
  }
})

// ── E2E-5: generate-lesson — real DEEP model writes a markdown lesson ─────────

test('E2E-5: generate-lesson — real deep model produces a lesson file', { skip }, async () => {
  const dataDir = makeTmpDir()
  try {
    writeConfig(dataDir, e2eConfig())
    const now = new Date().toISOString()
    seedCorrections(dataDir, 'english', [
      { ts: now, type: 'grammar', original: 'this have bug', corrected: 'this has a bug', explanation: 'subject-verb agreement', pattern: 'subject-verb' },
      { ts: now, type: 'grammar', original: 'need fix code', corrected: 'need to fix the code', explanation: 'missing infinitive/article', pattern: 'infinitive' },
      { ts: now, type: 'word_choice', original: 'more clean', corrected: 'cleaner', explanation: 'comparative form', pattern: 'comparative' },
    ])

    const result = await new Promise((resolve) => {
      const child = spawn('node', [path.join(ROOT, 'scripts/generate-lesson.mjs'), '--days', '7'], {
        env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, HOME: dataDir, ...creds },
        cwd: ROOT,
      })
      let stdout = '', stderr = ''
      child.stdout.on('data', d => { stdout += d })
      child.stderr.on('data', d => { stderr += d })
      child.on('close', status => resolve({ stdout, stderr, status }))
      setTimeout(() => { child.kill(); resolve({ stdout, stderr, status: -1 }) }, 40000)
    })

    assert.equal(result.status, 0, `generate-lesson should exit 0, stderr: ${result.stderr}`)
    assert.ok(result.stdout.includes('#'), `stdout should be markdown, got: ${result.stdout.slice(0, 160)}`)

    const lessonFile = path.join(dataDir, 'learning', 'english', `lessons-${today()}.md`)
    assert.ok(fs.existsSync(lessonFile), `lesson file should exist: ${lessonFile}`)
    assert.ok(fs.readFileSync(lessonFile, 'utf8').trim().length > 0, 'lesson file should be non-empty')
    console.log('  [E2E-5] lesson written →', lessonFile)
  } finally {
    cleanup(dataDir)
  }
})
