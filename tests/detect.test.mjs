import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLanguage, shouldSkip, detectMode } from '../scripts/lib/detect.mjs'

// ── detectLanguage shape ────────────────────────────────────────────────────

test('detectLanguage returns valid shape', () => {
  const result = detectLanguage('hello world')
  assert.equal(typeof result.lang, 'string')
  assert.ok(['en', 'non-english'].includes(result.lang))
  assert.equal(typeof result.ratio, 'number')
  assert.ok(result.ratio >= 0 && result.ratio <= 100)
})

test('detectLanguage: pure English is en', () => {
  const { lang, ratio } = detectLanguage('Review this function for potential issues')
  assert.equal(lang, 'en')
  assert.ok(ratio >= 85)
})

test('detectLanguage: Chinese is non-english', () => {
  const { lang, ratio } = detectLanguage('检查这个代码')
  assert.equal(lang, 'non-english')
  assert.ok(ratio < 85)
})

test('detectLanguage: mixed Chinese+English is non-english', () => {
  const { lang } = detectLanguage('把 auth module 重构一下')
  assert.equal(lang, 'non-english')
})

test('detectLanguage: empty string returns en without throwing', () => {
  const result = detectLanguage('')
  assert.equal(typeof result.lang, 'string')
  assert.ok(['en', 'non-english'].includes(result.lang))
})

test('detectLanguage: whitespace-only returns en without throwing', () => {
  const result = detectLanguage('   ')
  assert.ok(['en', 'non-english'].includes(result.lang))
})

// ── shouldSkip ──────────────────────────────────────────────────────────────

test('shouldSkip: slash command → true', () => {
  assert.equal(shouldSkip('/my-lingo:status'), true)
})

test('shouldSkip: short prompt "ok" → true', () => {
  assert.equal(shouldSkip('ok'), true)
})

test('shouldSkip: URL → true', () => {
  assert.equal(shouldSkip('https://example.com'), true)
})

test('shouldSkip: npm command → true', () => {
  assert.equal(shouldSkip('npm install lodash'), true)
})

test('shouldSkip: code block → true', () => {
  assert.equal(shouldSkip('```js\nfoo()'), true)
})

test('shouldSkip: ! prefix → true (shell command)', () => {
  assert.equal(shouldSkip('!ls -la'), true)
})

test('shouldSkip: -- prefix → false (handled by hook, not skipped here)', () => {
  assert.equal(shouldSkip('-- implement this in Python'), false)
})

test('shouldSkip: normal English prompt → false', () => {
  assert.equal(shouldSkip('Review this function for potential issues'), false)
})

test('shouldSkip: normal Chinese prompt → false', () => {
  assert.equal(shouldSkip('检查这个代码有没有问题'), false)
})

// ── detectMode ──────────────────────────────────────────────────────────────

test('detectMode: Chinese → non-english mode', () => {
  const result = detectMode('检查这个代码有没有问题')
  assert.equal(result.mode, 'non-english')
})

test('detectMode: English → english mode', () => {
  const result = detectMode('Review this function for potential issues')
  assert.equal(result.mode, 'english')
})

test('detectMode: slash command → skip mode', () => {
  const result = detectMode('/my-lingo:status')
  assert.equal(result.mode, 'skip')
})

test('detectMode: short prompt → skip mode', () => {
  const result = detectMode('ok')
  assert.equal(result.mode, 'skip')
})

test('detectMode: URL → skip mode', () => {
  const result = detectMode('https://example.com')
  assert.equal(result.mode, 'skip')
})

test('detectMode: npm command → skip mode', () => {
  const result = detectMode('npm install lodash')
  assert.equal(result.mode, 'skip')
})

test('detectMode: mixed Chinese+English → non-english', () => {
  const result = detectMode('把 auth module 重构一下')
  assert.equal(result.mode, 'non-english')
})

// ── edge cases ──────────────────────────────────────────────────────────────

test('detectLanguage: lang is strictly en or non-english', () => {
  const inputs = ['hello world', '你好世界', '```code```', '']
  for (const input of inputs) {
    const { lang } = detectLanguage(input)
    assert.ok(lang === 'en' || lang === 'non-english', `lang must be en or non-english, got: ${lang}`)
  }
})

test('shouldSkip: git@ URL → true', () => {
  assert.equal(shouldSkip('git@github.com:user/repo.git'), true)
})

test('shouldSkip: sudo command → true', () => {
  assert.equal(shouldSkip('sudo apt install curl'), true)
})

test('shouldSkip: docker command → true', () => {
  assert.equal(shouldSkip('docker run -it ubuntu bash'), true)
})

test('shouldSkip: 8-char prompt without word limit → false', () => {
  // exactly 8 chars AND 1 word: charCount >= 8 so condition fails → not skipped
  assert.equal(shouldSkip('abcdefgh'), false)
})

// ── :: refine prefix and shouldSkip interaction ──────────────────────────────

test('shouldSkip: "::" alone is skipped (too short)', () => {
  // The hook bypasses shouldSkip for isRefine=true; this just documents the raw behavior
  assert.equal(shouldSkip('::'), true)
})

test('shouldSkip: ":: fix" is skipped (too short, <8 chars, <3 words)', () => {
  // The hook bypasses shouldSkip for isRefine=true so this doesn't block :: fix
  assert.equal(shouldSkip(':: fix'), true)
})

test('shouldSkip: ":: fix it" passes (3 words)', () => {
  assert.equal(shouldSkip(':: fix it'), false)
})

test('shouldSkip: ":: make tests not slow" passes', () => {
  assert.equal(shouldSkip(':: make tests not slow'), false)
})
