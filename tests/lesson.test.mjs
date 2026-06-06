import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLessonMessages, parseLessonResponse } from '../scripts/lib/lesson.mjs'

// ── buildLessonMessages ──────────────────────────────────────────────────────

const BASE_DATA = {
  corrections: [
    { type: 'grammar', original: 'this have bug', corrected: 'this has a bug', pattern: 'subject-verb agreement' },
  ],
  turns: [
    { original_prompt: 'check the code', execution_prompt: 'Review the code for potential issues.' },
  ],
  level: 'intermediate',
  space_name: 'English',
}

const BASE_CONFIG = {
  native_language: 'zh-CN',
}

test('buildLessonMessages: returns { messages: [...] } with system and user messages', () => {
  const result = buildLessonMessages(BASE_DATA, BASE_CONFIG)
  assert.ok(result && typeof result === 'object', 'should return object')
  assert.ok(Array.isArray(result.messages), 'messages should be array')
  assert.ok(result.messages.length >= 2, 'should have at least 2 messages')
})

test('buildLessonMessages: messages[0].role === "system"', () => {
  const result = buildLessonMessages(BASE_DATA, BASE_CONFIG)
  assert.equal(result.messages[0].role, 'system')
})

test('buildLessonMessages: messages[1].role === "user"', () => {
  const result = buildLessonMessages(BASE_DATA, BASE_CONFIG)
  assert.equal(result.messages[1].role, 'user')
})

test('buildLessonMessages: system prompt contains target_language (space_name)', () => {
  const result = buildLessonMessages(BASE_DATA, BASE_CONFIG)
  assert.ok(result.messages[0].content.includes('English'), 'system prompt should contain "English"')
})

test('buildLessonMessages: system prompt contains native_language', () => {
  const result = buildLessonMessages(BASE_DATA, BASE_CONFIG)
  assert.ok(result.messages[0].content.includes('zh-CN'), 'system prompt should contain native_language')
})

test('buildLessonMessages: system prompt contains level', () => {
  const result = buildLessonMessages(BASE_DATA, BASE_CONFIG)
  assert.ok(result.messages[0].content.includes('intermediate'), 'system prompt should contain level')
})

test('buildLessonMessages: empty corrections → user message says no corrections, not null', () => {
  const data = { ...BASE_DATA, corrections: [] }
  const result = buildLessonMessages(data, BASE_CONFIG)
  assert.ok(result !== null, 'should not return null')
  assert.ok(result.messages.length >= 2, 'should still have messages')
  assert.ok(result.messages[1].content.includes('No corrections'), 'should mention no corrections')
})

test('buildLessonMessages: user message includes corrections content (original / corrected)', () => {
  const result = buildLessonMessages(BASE_DATA, BASE_CONFIG)
  const userContent = result.messages[1].content
  assert.ok(userContent.includes('this have bug'), 'user message should include original text')
  assert.ok(userContent.includes('this has a bug'), 'user message should include corrected text')
})

// ── parseLessonResponse ──────────────────────────────────────────────────────

test('parseLessonResponse: valid stdout → returns Markdown string', () => {
  const markdown = '# My Lingo Lesson\n\n## Summary\nFocus on grammar.\n'
  const stdout = JSON.stringify({ choices: [{ message: { content: markdown } }] })
  const result = parseLessonResponse(stdout)
  assert.equal(typeof result, 'string')
  assert.ok(result.includes('# My Lingo Lesson'))
})

test('parseLessonResponse: garbage string → null, no throw', () => {
  const result = parseLessonResponse('not valid json{{{{')
  assert.equal(result, null)
})

test('parseLessonResponse: empty string → null', () => {
  const result = parseLessonResponse('')
  assert.equal(result, null)
})

test('parseLessonResponse: null → null', () => {
  const result = parseLessonResponse(null)
  assert.equal(result, null)
})

test('parseLessonResponse: empty content string → null', () => {
  const stdout = JSON.stringify({ choices: [{ message: { content: '' } }] })
  const result = parseLessonResponse(stdout)
  assert.equal(result, null)
})

test('parseLessonResponse: API error response → null', () => {
  const stdout = JSON.stringify({ error: { type: 'authentication_error', message: 'Invalid key' } })
  const result = parseLessonResponse(stdout)
  assert.equal(result, null)
})

test('parseLessonResponse: whitespace-only content → null', () => {
  const stdout = JSON.stringify({ choices: [{ message: { content: '   \n  ' } }] })
  const result = parseLessonResponse(stdout)
  assert.equal(result, null)
})
