import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Project root, two levels up from tests/integration/
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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

// Write CLAUDE_PLUGIN_DATA/my-lingo/turns/DATE.jsonl for PT-006
export function writeTurnsFile(dataDir, date, records) {
  const dir = path.join(dataDir, 'my-lingo', 'turns')
  fs.mkdirSync(dir, { recursive: true })
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n'
  fs.writeFileSync(path.join(dir, `${date}.jsonl`), lines)
}

export function readTurnsForDate(dataDir, date) {
  try {
    const file = path.join(dataDir, 'my-lingo', 'turns', `${date}.jsonl`)
    return fs.readFileSync(file, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
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

// Write a corrections JSONL file for pre-populating test data (PT-010 setup)
export function writeCorrectionsFile(dataDir, space, month, records) {
  const dir = path.join(dataDir, 'my-lingo', 'learning', space)
  fs.mkdirSync(dir, { recursive: true })
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n'
  fs.writeFileSync(path.join(dir, `corrections-${month}.jsonl`), lines)
}
