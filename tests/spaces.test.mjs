import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  loadSpaces,
  getActiveSpace,
  setActiveSpace,
  addSpace,
  removeSpace,
} from '../scripts/lib/config.mjs'

function withTempData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-spc-test-'))
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

// ── loadSpaces ───────────────────────────────────────────────────────────────

test('loadSpaces: file missing → default { active: english, spaces: { english: {...} } }', () => {
  withTempData(() => {
    const spaces = loadSpaces()
    assert.equal(spaces.active, 'english')
    assert.ok(spaces.spaces.english, 'english space should exist')
  })
})

test('loadSpaces: reads existing spaces.json correctly', () => {
  withTempData((dir) => {
    const data = {
      active: 'japanese',
      spaces: {
        english: { key: 'english', display_name: 'English', target_language: 'en' },
        japanese: { key: 'japanese', display_name: 'Japanese', target_language: 'ja' },
      },
    }
    const dir2 = dir
    fs.mkdirSync(dir2, { recursive: true })
    fs.writeFileSync(path.join(dir2, 'spaces.json'), JSON.stringify(data))
    const loaded = loadSpaces()
    assert.equal(loaded.active, 'japanese')
    assert.equal(loaded.spaces.japanese.target_language, 'ja')
  })
})

// ── getActiveSpace ───────────────────────────────────────────────────────────

test('getActiveSpace: returns current active space with correct key', () => {
  withTempData(() => {
    addSpace('japanese', { target_language: 'ja' })
    setActiveSpace('japanese')
    const spaces = loadSpaces()
    const activeSpace = getActiveSpace(spaces)
    assert.equal(activeSpace.key, spaces.active)
    assert.equal(activeSpace.key, 'japanese')
  })
})

// ── setActiveSpace ───────────────────────────────────────────────────────────

test('setActiveSpace: switches active space when space exists', () => {
  withTempData(() => {
    addSpace('japanese', { target_language: 'ja' })
    setActiveSpace('japanese')
    assert.equal(loadSpaces().active, 'japanese')
  })
})

test('setActiveSpace: throws Error when space does not exist', () => {
  withTempData(() => {
    assert.throws(
      () => setActiveSpace('nonexistent'),
      /Space 'nonexistent' not found/
    )
  })
})

// ── addSpace ─────────────────────────────────────────────────────────────────

test('addSpace: adds space with specified target_language', () => {
  withTempData(() => {
    addSpace('japanese', { target_language: 'ja' })
    assert.equal(loadSpaces().spaces.japanese.target_language, 'ja')
  })
})

test('addSpace: writes spaces.json with mode 0o600', () => {
  withTempData((dir) => {
    addSpace('japanese', { target_language: 'ja' })
    const spacesPath = path.join(dir, 'spaces.json')
    const stat = fs.statSync(spacesPath)
    assert.equal(stat.mode & 0o777, 0o600)
  })
})

test('addSpace: sets key field to normalized lowercase key', () => {
  withTempData(() => {
    addSpace('Japanese', { target_language: 'ja' })
    const spaces = loadSpaces()
    assert.ok(spaces.spaces.japanese, 'space stored under lowercase key')
    assert.equal(spaces.spaces.japanese.key, 'japanese')
  })
})

test('addSpace: overwrite merges overrides with defaults', () => {
  withTempData(() => {
    addSpace('german', { target_language: 'de', level: 'beginner' })
    const s = loadSpaces().spaces.german
    assert.equal(s.target_language, 'de')
    assert.equal(s.level, 'beginner')
    assert.equal(s.display_mode, 'compact') // default preserved
  })
})

// ── removeSpace ──────────────────────────────────────────────────────────────

test('removeSpace: removes existing space', () => {
  withTempData(() => {
    addSpace('japanese', { target_language: 'ja' })
    removeSpace('japanese')
    assert.ok(!loadSpaces().spaces.japanese, 'japanese space should be removed')
  })
})

test('removeSpace: nonexistent key does not throw', () => {
  withTempData(() => {
    assert.doesNotThrow(() => removeSpace('nonexistent'))
  })
})
