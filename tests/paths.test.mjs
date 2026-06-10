import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getDataDir, writeInstallPointer } from '../scripts/lib/paths.mjs'

// The install pointer lives at $HOME/.claude/plugins/data/my-lingo/install.json.
// paths.mjs reads os.homedir() at call-time, so redirecting $HOME isolates each
// test from the real home dir. See dev_docs/14 §六-F / §十.
function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-paths-home-'))
  const prevHome = process.env.HOME
  const prevData = process.env.CLAUDE_PLUGIN_DATA
  process.env.HOME = home
  delete process.env.CLAUDE_PLUGIN_DATA
  try {
    fn(home)
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevData === undefined) delete process.env.CLAUDE_PLUGIN_DATA
    else process.env.CLAUDE_PLUGIN_DATA = prevData
    fs.rmSync(home, { recursive: true, force: true })
  }
}

function pointerPath(home) {
  return path.join(home, '.claude', 'plugins', 'data', 'my-lingo', 'install.json')
}

// ── getDataDir resolution order ──────────────────────────────────────────────

test('getDataDir: ① env CLAUDE_PLUGIN_DATA wins and is NOT re-nested with plugin name', () => {
  withTempHome(() => {
    process.env.CLAUDE_PLUGIN_DATA = '/tmp/some/plugin/data/my-lingo'
    assert.equal(getDataDir(), '/tmp/some/plugin/data/my-lingo')
  })
})

test('getDataDir: ② env-blind reads data_dir from the install pointer', () => {
  withTempHome((home) => {
    const real = path.join(home, 'real-data-dir')
    fs.mkdirSync(path.dirname(pointerPath(home)), { recursive: true })
    fs.writeFileSync(pointerPath(home), JSON.stringify({ plugin_root: '/x', data_dir: real }))
    assert.equal(getDataDir(), real) // no env set → resolved via pointer
  })
})

test('getDataDir: ③ no env + no pointer throws a clear, actionable error (no silent fallback)', () => {
  withTempHome(() => {
    assert.throws(() => getDataDir(), /data dir unresolved/)
  })
})

test('getDataDir: corrupt pointer JSON throws rather than returning a wrong dir', () => {
  withTempHome((home) => {
    fs.mkdirSync(path.dirname(pointerPath(home)), { recursive: true })
    fs.writeFileSync(pointerPath(home), '{ not json')
    assert.throws(() => getDataDir(), /data dir unresolved/)
  })
})

// ── writeInstallPointer ──────────────────────────────────────────────────────

test('writeInstallPointer: writes data_dir from env and plugin_root from import.meta.url', () => {
  withTempHome((home) => {
    process.env.CLAUDE_PLUGIN_DATA = path.join(home, 'data')
    writeInstallPointer()
    const ptr = JSON.parse(fs.readFileSync(pointerPath(home), 'utf8'))
    assert.equal(ptr.data_dir, path.join(home, 'data'))
    // plugin_root is this repo root (paths.mjs is at <root>/scripts/lib/paths.mjs)
    assert.ok(fs.existsSync(path.join(ptr.plugin_root, 'scripts', 'lib', 'paths.mjs')),
      `plugin_root should point at the repo: ${ptr.plugin_root}`)
    assert.ok(!('updated_at' in ptr), 'no volatile field (so skip-if-unchanged is stable)')
  })
})

test('writeInstallPointer: no-op when CLAUDE_PLUGIN_DATA is absent (never writes a guess)', () => {
  withTempHome((home) => {
    writeInstallPointer() // env-blind → must not write
    assert.ok(!fs.existsSync(pointerPath(home)))
  })
})

test('writeInstallPointer: atomic + idempotent — second identical call leaves mtime untouched', () => {
  withTempHome((home) => {
    process.env.CLAUDE_PLUGIN_DATA = path.join(home, 'data')
    writeInstallPointer()
    const mtime1 = fs.statSync(pointerPath(home)).mtimeMs
    writeInstallPointer() // content unchanged → should skip the rewrite
    const mtime2 = fs.statSync(pointerPath(home)).mtimeMs
    assert.equal(mtime1, mtime2)
    assert.ok(!fs.existsSync(pointerPath(home) + '.tmp'), 'temp file is renamed away')
  })
})
