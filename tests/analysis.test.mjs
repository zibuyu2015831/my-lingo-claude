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
