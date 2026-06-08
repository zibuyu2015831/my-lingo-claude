import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAnalysisMessages, parseAnalysisResponse } from '../scripts/lib/analysis.mjs'

const SAMPLE_TURNS = [
  {
    original_prompt: 'this code have bug',
    execution_prompt: 'This code has a bug. Please review and fix.',
    detected_language: 'zh-CN',
  },
]

const BASE_CONFIG = {
  native_language: 'zh-CN',
  target_language: 'English',
}

// ── buildAnalysisMessages ────────────────────────────────────────────────────

test('buildAnalysisMessages: 1 turn → returns { messages: [...] }', () => {
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG)
  assert.ok(result !== null, 'should not return null')
  assert.ok(Array.isArray(result.messages), 'messages should be an array')
  assert.equal(result.messages.length, 2)
})

test('buildAnalysisMessages: messages[0] is system, messages[1] is user', () => {
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG)
  assert.equal(result.messages[0].role, 'system')
  assert.equal(result.messages[1].role, 'user')
})

test('buildAnalysisMessages: user message contains original_prompt', () => {
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG)
  assert.ok(result.messages[1].content.includes('this code have bug'),
    'user message should contain original_prompt text')
})

test('buildAnalysisMessages: system prompt contains native_language', () => {
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG)
  assert.ok(result.messages[0].content.includes('zh-CN'),
    'system prompt should contain native_language value')
})

test('buildAnalysisMessages: turns empty → returns null', () => {
  const result = buildAnalysisMessages([], BASE_CONFIG)
  assert.equal(result, null)
})

test('buildAnalysisMessages: turns null → returns null', () => {
  const result = buildAnalysisMessages(null, BASE_CONFIG)
  assert.equal(result, null)
})

test('buildAnalysisMessages: user message includes turn number and detected language', () => {
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG)
  assert.ok(result.messages[1].content.includes('Turn 1'), 'should include turn number')
  assert.ok(result.messages[1].content.includes('detected: zh-CN'), 'should include detected language')
})

// ── parseAnalysisResponse ────────────────────────────────────────────────────

test('parseAnalysisResponse: valid stdout returns { corrections, learning_points }', () => {
  const inner = JSON.stringify({
    corrections: [{ type: 'grammar', original: 'have bug', corrected: 'has a bug', explanation: 'test', pattern: 'subject-verb' }],
    learning_points: [{ type: 'phrase', target_text: 'identify bugs', native_explanation: 'test' }],
  })
  const stdout = JSON.stringify({ choices: [{ message: { content: inner } }] })
  const result = parseAnalysisResponse(stdout)
  assert.ok(result !== null)
  assert.ok(Array.isArray(result.corrections))
  assert.ok(Array.isArray(result.learning_points))
  assert.equal(result.corrections.length, 1)
  assert.equal(result.learning_points.length, 1)
})

test('parseAnalysisResponse: garbage string → null, no throw', () => {
  const result = parseAnalysisResponse('not valid json at all !!!%^&')
  assert.equal(result, null)
})

test('parseAnalysisResponse: response.error present → null', () => {
  const stdout = JSON.stringify({ error: { type: 'api_error', message: 'Internal error' } })
  const result = parseAnalysisResponse(stdout)
  assert.equal(result, null)
})

test('parseAnalysisResponse: corrections missing → null', () => {
  const inner = JSON.stringify({ learning_points: [] })
  const stdout = JSON.stringify({ choices: [{ message: { content: inner } }] })
  const result = parseAnalysisResponse(stdout)
  assert.equal(result, null)
})

test('parseAnalysisResponse: corrections empty array → { corrections: [], learning_points: [] }', () => {
  const inner = JSON.stringify({ corrections: [], learning_points: [] })
  const stdout = JSON.stringify({ choices: [{ message: { content: inner } }] })
  const result = parseAnalysisResponse(stdout)
  assert.ok(result !== null, 'should not be null for empty corrections')
  assert.equal(result.corrections.length, 0)
})

test('parseAnalysisResponse: learning_points missing → defaults to [] (not null)', () => {
  const inner = JSON.stringify({ corrections: [] })
  const stdout = JSON.stringify({ choices: [{ message: { content: inner } }] })
  const result = parseAnalysisResponse(stdout)
  assert.ok(result !== null)
  assert.ok(Array.isArray(result.learning_points))
  assert.equal(result.learning_points.length, 0)
})

test('parseAnalysisResponse: null input → null, no throw', () => {
  const result = parseAnalysisResponse(null)
  assert.equal(result, null)
})

// ── buildAnalysisMessages with responses ─────────────────────────────────────

test('buildAnalysisMessages: with responses → user message includes response text', () => {
  const responses = [
    { text: "I'll review this code. Here are the issues I found.", word_count: 10 },
  ]
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG, responses)
  assert.ok(result !== null)
  assert.ok(result.messages[1].content.includes("I'll review this code"),
    'user message should include response text')
})

test('buildAnalysisMessages: with responses → system prompt mentions response usage', () => {
  const responses = [{ text: 'Some response text', word_count: 3 }]
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG, responses)
  assert.ok(result.messages[0].content.includes("Claude's responses"),
    'system prompt should mention Claude responses')
})

test('buildAnalysisMessages: with empty responses array → same as no responses', () => {
  const withEmpty = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG, [])
  const withNone = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG)
  assert.equal(withEmpty.messages[0].content, withNone.messages[0].content)
  assert.equal(withEmpty.messages[1].content, withNone.messages[1].content)
})

test('buildAnalysisMessages: with null responses → same as no responses', () => {
  const withNull = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG, null)
  const withNone = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG)
  assert.equal(withNull.messages[1].content, withNone.messages[1].content)
})

test('buildAnalysisMessages: long response text is truncated to 300 chars', () => {
  const longText = 'x'.repeat(500)
  const responses = [{ text: longText, word_count: 500 }]
  const result = buildAnalysisMessages(SAMPLE_TURNS, BASE_CONFIG, responses)
  const userMsg = result.messages[1].content
  assert.ok(!userMsg.includes(longText), 'full 500-char text should not appear')
  assert.ok(userMsg.includes('...'), 'truncated text should end with ...')
})
