import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Project root, two levels up from tests/integration/
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const STORAGE_URL = pathToFileURL(path.join(ROOT, 'scripts/lib/storage.mjs')).href

// Call a named export of storage.mjs in a fresh child process (so this test
// process never holds a SQLite connection / module singleton). Returns the
// parsed JSON result. Used for both seeding (writeX) and reading (readX).
export function dbCall(dataDir, exportName, args = []) {
  const script = `
const mod = await import(process.env.STORAGE_URL)
const out = mod[process.env.CALL_NAME](...JSON.parse(process.env.CALL_ARGS))
process.stdout.write(JSON.stringify(out ?? null))
`
  const res = spawnSync('node', ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: dataDir,
      STORAGE_URL,
      CALL_NAME: exportName,
      CALL_ARGS: JSON.stringify(args),
    },
  })
  if (res.status !== 0) throw new Error(`dbCall ${exportName} failed: ${res.stderr}`)
  try { return JSON.parse(res.stdout.trim() || 'null') } catch { return null }
}

export function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'my-lingo-test-'))
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

// Write CLAUDE_PLUGIN_DATA/my-lingo/config.json
export function writeConfig(dataDir, config) {
  const dir = path.join(dataDir, 'my-lingo')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 })
}

// Write a pre-populated circuit.json (for PT-002/003 setup)
export function writeCircuitJson(dataDir, data) {
  const dir = path.join(dataDir, 'my-lingo')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'circuit.json'), JSON.stringify(data))
}

export function circuitJsonExists(dataDir) {
  return fs.existsSync(path.join(dataDir, 'my-lingo', 'circuit.json'))
}

export function readCircuitJson(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'my-lingo', 'circuit.json'), 'utf8'))
  } catch { return null }
}

// Seed turns into the SQLite DB. Records use snake_case columns (as the old
// JSONL fixtures did); mapped to writeTurn's camelCase input here.
export function seedTurns(dataDir, records) {
  const script = `
const { writeTurn } = await import(process.env.STORAGE_URL)
for (const r of JSON.parse(process.env.SEED_JSON)) {
  writeTurn({
    ts: r.ts, sessionId: r.session_id, mode: r.mode,
    executionPrompt: r.execution_prompt, prompt: r.original_prompt,
    detectedLanguage: r.detected_language, fallback: r.fallback,
    rewriteType: r.rewrite_type, latencyMs: r.latency_ms,
  }, { language_space: r.language_space ?? 'english', cwd: r.cwd ?? '/tmp' })
}
`
  const res = spawnSync('node', ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, STORAGE_URL, SEED_JSON: JSON.stringify(records) },
  })
  if (res.status !== 0) throw new Error(`seedTurns failed: ${res.stderr}`)
}

export function readTurnsForDate(dataDir, date) {
  return dbCall(dataDir, 'readTurnsForDay', [date]) || []
}

function parseJson(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

function baseEnv(dataDir, extra = {}) {
  return {
    ...process.env,
    CLAUDE_PLUGIN_DATA: dataDir,
    MY_LINGO_API_KEY: 'sk-test',
    ...extra,
  }
}

// Async variant — REQUIRED when a mock server is running in the same Node process.
// spawnSync blocks the event loop, so the server can't respond while we wait.
export function runHookAsync(promptText, { dataDir, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(ROOT, 'scripts/user-prompt-submit.mjs')], {
      env: baseEnv(dataDir, env),
      cwd: ROOT,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.stdin.write(JSON.stringify({ prompt: promptText, cwd: ROOT, session_id: 'test-session' }))
    child.stdin.end()
    child.on('close', (status) => {
      resolve({ stdout, stderr, status, json: parseJson(stdout) })
    })
  })
}

// Sync variant — OK only when no mock server is involved (PT-002, PT-004).
export function runHookSync(promptText, { dataDir, env = {} } = {}) {
  const input = JSON.stringify({ prompt: promptText, cwd: ROOT, session_id: 'test-session' })
  const result = spawnSync('node', [path.join(ROOT, 'scripts/user-prompt-submit.mjs')], {
    input,
    encoding: 'utf8',
    env: baseEnv(dataDir, env),
    cwd: ROOT,
  })
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    json: parseJson(result.stdout),
  }
}

// Run session-end.mjs with a pre-populated turns file.
export function runSessionEnd({ dataDir, sessionId = 'test-session', env = {} } = {}) {
  const result = spawnSync('node', [path.join(ROOT, 'scripts/session-end.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: dataDir,
      CLAUDE_SESSION_ID: sessionId,
      ...env,
    },
    cwd: ROOT,
  })
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status }
}

// Async variant for session-end (needed when mock server is running in same process)
export function runSessionEndAsync({ dataDir, sessionId = 'test-session', timeout = 10000, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(ROOT, 'scripts/session-end.mjs')], {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: dataDir,
        CLAUDE_SESSION_ID: sessionId,
        MY_LINGO_API_KEY: 'sk-test',
        ...env,
      },
      cwd: ROOT,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    let resolved = false
    const finish = (status) => {
      if (resolved) return
      resolved = true
      resolve({ stdout, stderr, status })
    }
    child.on('close', finish)
    setTimeout(() => { child.kill(); finish(-1) }, timeout)
  })
}

// Seed corrections / learning items into the DB for pre-populating test data.
export function seedCorrections(dataDir, space, records) {
  for (const r of records) dbCall(dataDir, 'writeCorrection', [r, space])
}

export function seedItems(dataDir, space, records) {
  for (const r of records) dbCall(dataDir, 'writeLearningItem', [r, space])
}

// Extract the fenced ```bash blocks from a command markdown file.
export function commandBashBlocks(commandName) {
  const md = fs.readFileSync(path.join(ROOT, 'commands/my-lingo', `${commandName}.md`), 'utf8')
  const blocks = []
  const re = /```bash\n([\s\S]*?)```/g
  let m
  while ((m = re.exec(md))) blocks.push(m[1])
  return blocks
}

// Run a command's bash block from a FOREIGN cwd (NOT the plugin root), exactly
// as Claude Code does when a user invokes the slash command from their own
// project. This is the configuration that catches cwd-relative module-resolution
// bugs — every other helper runs with cwd:ROOT and so cannot surface them.
export function runCommandBlock(commandName, { dataDir, blockIndex = 0, env = {} } = {}) {
  const blocks = commandBashBlocks(commandName)
  const script = blocks[blockIndex]
  if (!script) throw new Error(`no bash block #${blockIndex} in ${commandName}.md`)
  const res = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    cwd: os.tmpdir(),               // deliberately NOT the plugin root
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,     // how Claude Code locates plugin scripts
      CLAUDE_PLUGIN_DATA: dataDir,
      ARGUMENTS: '',
      ...env,
    },
  })
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' }
}
