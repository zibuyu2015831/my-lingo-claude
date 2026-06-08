import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isDebugEnabled, debugLog } from '../scripts/lib/debug.mjs'

// ── helpers ──────────────────────────────────────────────────────────────────

function withTempData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-dbg-test-'))
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

function withEnv(key, value, fn) {
  const prev = process.env[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
  try {
    fn()
  } finally {
    if (prev === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = prev
    }
  }
}

// ── isDebugEnabled ────────────────────────────────────────────────────────────

test('isDebugEnabled: false when env unset and no config', () => {
  withEnv('MY_LINGO_DEBUG', undefined, () => {
    assert.equal(isDebugEnabled({}), false)
    assert.equal(isDebugEnabled(null), false)
    assert.equal(isDebugEnabled(undefined), false)
  })
})

test('isDebugEnabled: true when MY_LINGO_DEBUG=1', () => {
  withEnv('MY_LINGO_DEBUG', '1', () => {
    assert.equal(isDebugEnabled({}), true)
  })
})

test('isDebugEnabled: false when MY_LINGO_DEBUG=0', () => {
  withEnv('MY_LINGO_DEBUG', '0', () => {
    assert.equal(isDebugEnabled({}), false)
  })
})

test('isDebugEnabled: true when config.debug=true, env unset', () => {
  withEnv('MY_LINGO_DEBUG', undefined, () => {
    assert.equal(isDebugEnabled({ debug: true }), true)
  })
})

test('isDebugEnabled: false when config.debug=false, env unset', () => {
  withEnv('MY_LINGO_DEBUG', undefined, () => {
    assert.equal(isDebugEnabled({ debug: false }), false)
  })
})

test('isDebugEnabled: env takes priority when both set', () => {
  withEnv('MY_LINGO_DEBUG', '1', () => {
    assert.equal(isDebugEnabled({ debug: false }), true)
  })
})

// ── debugLog: activation ─────────────────────────────────────────────────────

test('debugLog: does not create file when both env and config.debug unset', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', undefined, () => {
      debugLog('TEST', { msg: 'should not appear' }, { debug: false })
      const file = path.join(dir, 'debug.log')
      assert.equal(fs.existsSync(file), false, 'debug.log must not be created when disabled')
    })
  })
})

test('debugLog: creates debug.log when MY_LINGO_DEBUG=1', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      debugLog('TEST', { msg: 'hello' })
      const file = path.join(dir, 'debug.log')
      assert.ok(fs.existsSync(file), 'debug.log should be created')
    })
  })
})

test('debugLog: creates debug.log when config.debug=true (env unset)', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', undefined, () => {
      debugLog('TEST', { msg: 'from config' }, { debug: true })
      const file = path.join(dir, 'debug.log')
      assert.ok(fs.existsSync(file), 'debug.log should be created via config.debug')
    })
  })
})

// ── debugLog: format ──────────────────────────────────────────────────────────

test('debugLog: line format is [ISO] [EVENT] JSON', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      debugLog('API_REQUEST', { model: 'gpt-4o-mini', url: 'https://api.example.com' })
      const file = path.join(dir, 'debug.log')
      const content = fs.readFileSync(file, 'utf8').trim()
      // Format: [ISO timestamp] [EVENT] {...}
      assert.match(content, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[API_REQUEST\] \{/)
    })
  })
})

test('debugLog: written line is valid JSON after the event prefix', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      debugLog('CONFIG', { execution_mode: 'english_optimized', debug: true })
      const file = path.join(dir, 'debug.log')
      const line = fs.readFileSync(file, 'utf8').trim()
      const jsonPart = line.replace(/^\[.*?\] \[.*?\] /, '')
      assert.doesNotThrow(() => JSON.parse(jsonPart), 'JSON portion should be parseable')
      const obj = JSON.parse(jsonPart)
      assert.equal(obj.execution_mode, 'english_optimized')
    })
  })
})

test('debugLog: multiple calls accumulate lines', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      debugLog('SKIP', { preview: 'ls -la' })
      debugLog('CONFIG', { execution_mode: 'off' })
      debugLog('CIRCUIT', { event: 'failure', failure_count: 1 })
      const file = path.join(dir, 'debug.log')
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      assert.equal(lines.length, 3)
    })
  })
})

// ── debugLog: privacy / sanitization ─────────────────────────────────────────

test('debugLog: redacts API key strings before writing', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      debugLog('API_REQUEST', { prompt: 'use sk-abc1234567890abcdef1234567890 for this' })
      const file = path.join(dir, 'debug.log')
      const content = fs.readFileSync(file, 'utf8')
      assert.ok(!content.includes('sk-abc'), 'API key must not appear in debug.log')
      assert.ok(content.includes('[API_KEY]'), 'redacted placeholder should appear')
    })
  })
})

test('debugLog: redacts nested string fields in objects', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      debugLog('API_REQUEST', {
        messages: [
          { role: 'system', content: 'You are a helper.' },
          { role: 'user', content: 'My token=supersecret here' },
        ],
      })
      const file = path.join(dir, 'debug.log')
      const content = fs.readFileSync(file, 'utf8')
      assert.ok(!content.includes('supersecret'), 'secret must be redacted from nested content')
      assert.ok(content.includes('[REDACTED]'), 'redacted placeholder should appear')
    })
  })
})

test('debugLog: api_key=[SET] placeholder is not further redacted', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      debugLog('CONFIG', { api_key: '[SET]', execution_mode: 'english_optimized' })
      const file = path.join(dir, 'debug.log')
      const content = fs.readFileSync(file, 'utf8')
      assert.ok(content.includes('[SET]'), '[SET] placeholder should pass through intact')
    })
  })
})

// ── debugLog: failure tolerance ───────────────────────────────────────────────

test('debugLog: does not throw when data dir is read-only', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      const mlDir = dir
      fs.mkdirSync(mlDir, { recursive: true })
      fs.chmodSync(mlDir, 0o444)
      try {
        assert.doesNotThrow(() => debugLog('TEST', { msg: 'should not throw' }))
      } finally {
        fs.chmodSync(mlDir, 0o755)
      }
    })
  })
})

// ── debugLog: log rotation ────────────────────────────────────────────────────

test('debugLog: rotates when file exceeds 1MB, keeps last 500 lines', () => {
  withTempData((dir) => {
    withEnv('MY_LINGO_DEBUG', '1', () => {
      const mlDir = dir
      fs.mkdirSync(mlDir, { recursive: true, mode: 0o700 })
      const file = path.join(mlDir, 'debug.log')

      // Write 600 lines × ~2000 bytes ≈ 1.2 MB (well over the 1 MB threshold)
      const manyLines = Array.from({ length: 600 }, (_, i) =>
        `[2026-06-06T00:00:00.000Z] [OLD] {"i":${i},"pad":"${'x'.repeat(1950)}"}`
      ).join('\n') + '\n'
      fs.writeFileSync(file, manyLines)
      assert.ok(fs.statSync(file).size > 1024 * 1024, 'pre-condition: file must be > 1MB')

      debugLog('NEW', { msg: 'trigger rotation' })

      const afterLines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      // Rotation keeps last 500 old lines + appends 1 new = 501 max
      assert.ok(afterLines.length <= 501, `expected ≤ 501 lines after rotation, got ${afterLines.length}`)
      // Last line is the newly appended entry
      assert.ok(afterLines[afterLines.length - 1].includes('trigger rotation'), 'new entry must be last line')
      // Oldest lines should be gone (line 0 was i=0, rotation removed early lines)
      assert.ok(!afterLines[0].includes('"i":0,'), 'oldest lines should have been rotated out')
    })
  })
})
