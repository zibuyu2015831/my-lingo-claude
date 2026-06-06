import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOptimizationMessages, buildRefineMessages, buildSummaryLanguageCtx } from '../scripts/lib/prompts.mjs'
import { parseModelResponse } from '../scripts/lib/api.mjs'

const MOCK_CONFIG = {
  model_fast: 'gpt-4o-mini',
  api_base_url: 'https://api.openai.com/v1',
  timeout_seconds: 8,
  domain_terms: [],
}

const MOCK_DETECTION = { lang: 'non-english', ratio: 20 }

// ── buildOptimizationMessages ───────────────────────────────────────────────

test('buildOptimizationMessages returns messages array', () => {
  const result = buildOptimizationMessages('检查代码', MOCK_DETECTION, MOCK_CONFIG)
  assert.ok(result.messages)
  assert.ok(Array.isArray(result.messages))
})

test('buildOptimizationMessages: first message is system', () => {
  const { messages } = buildOptimizationMessages('review this', MOCK_DETECTION, MOCK_CONFIG)
  assert.equal(messages[0].role, 'system')
})

test('buildOptimizationMessages: second message is user', () => {
  const { messages } = buildOptimizationMessages('review this', MOCK_DETECTION, MOCK_CONFIG)
  assert.equal(messages[1].role, 'user')
})

test('buildOptimizationMessages: system prompt contains 10 rules', () => {
  const { messages } = buildOptimizationMessages('review this', MOCK_DETECTION, MOCK_CONFIG)
  const sys = messages[0].content
  assert.ok(sys.includes('Do not change the user\'s intent'))
  assert.ok(sys.includes('Do not add requirements'))
  assert.ok(sys.includes('Preserve code blocks'))
  assert.ok(sys.includes('Optimize the prompt for Claude Code'))
  assert.ok(sys.includes('clear task boundaries'))
  assert.ok(sys.includes('analysis'))
  assert.ok(sys.includes('implement'))
  assert.ok(sys.includes('minimal clarification'))
  assert.ok(sys.includes('Output valid JSON only'))
  assert.ok(sys.includes('Never expose secrets'))
})

test('buildOptimizationMessages: user message contains original prompt', () => {
  const { messages } = buildOptimizationMessages('refactor the auth module', MOCK_DETECTION, MOCK_CONFIG)
  assert.ok(messages[1].content.includes('refactor the auth module'))
})

// ── buildRefineMessages ─────────────────────────────────────────────────────

test('buildRefineMessages returns messages array', () => {
  const result = buildRefineMessages('make the tests faster', MOCK_CONFIG)
  assert.ok(result.messages)
  assert.ok(Array.isArray(result.messages))
})

test('buildRefineMessages: first message is system', () => {
  const { messages } = buildRefineMessages('make tests faster', MOCK_CONFIG)
  assert.equal(messages[0].role, 'system')
})

test('buildRefineMessages: second message is user', () => {
  const { messages } = buildRefineMessages('make tests faster', MOCK_CONFIG)
  assert.equal(messages[1].role, 'user')
})

test('buildRefineMessages: system contains refine instruction', () => {
  const { messages } = buildRefineMessages('make tests faster', MOCK_CONFIG)
  assert.ok(messages[0].content.toLowerCase().includes('refine') || messages[0].content.toLowerCase().includes('rewrite'))
})

// ── parseModelResponse (pure function, no network) ──────────────────────────

test('parseModelResponse: null on empty string', () => {
  assert.equal(parseModelResponse(''), null)
})

test('parseModelResponse: null on garbage string', () => {
  assert.equal(parseModelResponse('not json at all'), null)
})

test('parseModelResponse: null when response.error exists', () => {
  const raw = JSON.stringify({ error: { type: 'invalid_request_error', message: 'bad' } })
  assert.equal(parseModelResponse(raw), null)
})

test('parseModelResponse: null when choices is empty array', () => {
  const raw = JSON.stringify({ choices: [] })
  assert.equal(parseModelResponse(raw), null)
})

test('parseModelResponse: returns parsed object for valid response', () => {
  const inner = { execution_prompt_en: 'Review this code for bugs.', rewrite_type: 'optimize' }
  const raw = JSON.stringify({
    choices: [{
      message: { content: JSON.stringify(inner) }
    }]
  })
  const result = parseModelResponse(raw)
  assert.ok(result !== null)
  assert.equal(result.execution_prompt_en, 'Review this code for bugs.')
  assert.equal(result.rewrite_type, 'optimize')
})

test('parseModelResponse: full mock flow — extract execution_prompt_en', () => {
  const expected = 'Analyze the authentication module for security vulnerabilities.'
  const mockStdout = JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          detected_input_language: 'zh-CN',
          execution_prompt_en: expected,
          rewrite_type: 'translate_and_optimize',
          key_changes: ['Translated from Chinese', 'Added analysis scope'],
        })
      }
    }]
  })
  const result = parseModelResponse(mockStdout)
  assert.ok(result !== null)
  assert.equal(result.execution_prompt_en, expected)
  assert.equal(result.detected_input_language, 'zh-CN')
})

test('parseModelResponse: null on non-null error', () => {
  assert.equal(parseModelResponse(null), null)
  assert.equal(parseModelResponse(undefined), null)
})

// ── buildSummaryLanguageCtx ─────────────────────────────────────────────────

test('buildSummaryLanguageCtx: returns empty string when no native_language', () => {
  assert.equal(buildSummaryLanguageCtx({}), '')
})

test('buildSummaryLanguageCtx: returns empty string for native_language = en', () => {
  assert.equal(buildSummaryLanguageCtx({ native_language: 'en' }), '')
})

test('buildSummaryLanguageCtx: returns instruction for zh-CN', () => {
  const ctx = buildSummaryLanguageCtx({ native_language: 'zh-CN' })
  assert.ok(ctx.includes('zh-CN'))
  assert.ok(ctx.includes('summary'))
})

test('buildSummaryLanguageCtx: summary_language takes priority over native_language', () => {
  const ctx = buildSummaryLanguageCtx({ native_language: 'zh-CN', summary_language: 'ja' })
  assert.ok(ctx.includes('ja'))
  assert.ok(!ctx.includes('zh-CN'))
})

test('buildSummaryLanguageCtx: returns empty string when summary_language = en', () => {
  assert.equal(buildSummaryLanguageCtx({ native_language: 'zh-CN', summary_language: 'en' }), '')
})
