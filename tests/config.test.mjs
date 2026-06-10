import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadConfig, writeConfig, loadSpaces, getActiveSpace } from '../scripts/lib/config.mjs'

function withTempData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-cfg-test-'))
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

// ── defaults ────────────────────────────────────────────────────────────────

test('loadConfig: missing config.json returns DEFAULT_CONFIG', () => {
  withTempData(() => {
    const cfg = loadConfig(null)
    assert.equal(cfg.execution_mode, 'english_optimized')
    assert.equal(cfg.timeout_seconds, 8)
    assert.equal(cfg.privacy_mode, 'standard')
    assert.equal(cfg.fallback_policy, 'send_original')
    assert.ok(Array.isArray(cfg.domain_terms))
  })
})

test('loadConfig: corrupt config.json does not throw, returns defaults', () => {
  withTempData((dir) => {
    const cfgDir = dir
    fs.mkdirSync(cfgDir, { recursive: true })
    fs.writeFileSync(path.join(cfgDir, 'config.json'), 'not valid json')
    const cfg = loadConfig(null)
    assert.equal(cfg.execution_mode, 'english_optimized')
  })
})

// ── global config override ───────────────────────────────────────────────────

test('loadConfig: global config.json overrides defaults', () => {
  withTempData((dir) => {
    const cfgDir = dir
    fs.mkdirSync(cfgDir, { recursive: true })
    fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({
      timeout_seconds: 15,
      execution_mode: 'original',
    }))
    const cfg = loadConfig(null)
    assert.equal(cfg.timeout_seconds, 15)
    assert.equal(cfg.execution_mode, 'original')
    assert.equal(cfg.privacy_mode, 'standard') // still from default
  })
})

// ── project-level override ───────────────────────────────────────────────────

test('loadConfig: project .claude-my-lingo.json overrides global', () => {
  withTempData((dir) => {
    const cfgDir = dir
    fs.mkdirSync(cfgDir, { recursive: true })
    fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ timeout_seconds: 15 }))

    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-proj-'))
    try {
      fs.writeFileSync(path.join(projectDir, '.claude-my-lingo.json'), JSON.stringify({ timeout_seconds: 5 }))
      const cfg = loadConfig(projectDir)
      assert.equal(cfg.timeout_seconds, 5)
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true })
    }
  })
})

// ── writeConfig ──────────────────────────────────────────────────────────────

test('writeConfig: writes correct content', () => {
  withTempData((dir) => {
    const payload = { execution_mode: 'off', timeout_seconds: 12 }
    writeConfig(payload)
    const cfgPath = path.join(dir, 'config.json')
    assert.ok(fs.existsSync(cfgPath))
    const read = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.equal(read.execution_mode, 'off')
    assert.equal(read.timeout_seconds, 12)
  })
})

test('writeConfig: file permission is 0o600', () => {
  withTempData((dir) => {
    writeConfig({ execution_mode: 'off' })
    const cfgPath = path.join(dir, 'config.json')
    const stat = fs.statSync(cfgPath)
    assert.equal(stat.mode & 0o777, 0o600)
  })
})

test('writeConfig: creates directory if missing', () => {
  withTempData((dir) => {
    const cfgDir = path.join(dir, 'nested') // not yet created
    process.env.CLAUDE_PLUGIN_DATA = cfgDir
    assert.ok(!fs.existsSync(cfgDir))
    writeConfig({ execution_mode: 'english_optimized' })
    assert.ok(fs.existsSync(cfgDir))
  })
})

// ── loadSpaces ───────────────────────────────────────────────────────────────

test('loadSpaces: returns default when spaces.json missing', () => {
  withTempData(() => {
    const spaces = loadSpaces()
    assert.equal(spaces.active, 'english')
    assert.ok(spaces.spaces.english)
  })
})

test('getActiveSpace: returns english space by default', () => {
  withTempData(() => {
    const spaces = loadSpaces()
    const active = getActiveSpace(spaces)
    assert.equal(active.key, 'english')
  })
})
