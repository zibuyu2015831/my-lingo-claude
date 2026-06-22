import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModelResponse, extractJsonContent, classifyCurlFailure, callFastModel, drainFailure } from '../scripts/lib/api.mjs'

// Wrap arbitrary message content in an OpenAI-compatible completion envelope.
function envelope(content) {
  return JSON.stringify({ choices: [{ message: { content } }] })
}

test('extractJsonContent — bare JSON object', () => {
  assert.deepEqual(extractJsonContent('{"ok":true,"n":1}'), { ok: true, n: 1 })
})

test('extractJsonContent — ```json fenced (Anthropic-via-gateway shape)', () => {
  assert.deepEqual(extractJsonContent('```json\n{"ok":true}\n```'), { ok: true })
})

test('extractJsonContent — bare ``` fence without language tag', () => {
  assert.deepEqual(extractJsonContent('```\n{"a":1}\n```'), { a: 1 })
})

test('extractJsonContent — JSON embedded in surrounding prose', () => {
  assert.deepEqual(
    extractJsonContent('Here is your result:\n{"execution_prompt_en":"Do X"}\nHope that helps!'),
    { execution_prompt_en: 'Do X' },
  )
})

test('extractJsonContent — non-JSON returns null', () => {
  assert.equal(extractJsonContent('not json at all'), null)
  assert.equal(extractJsonContent(''), null)
  assert.equal(extractJsonContent(null), null)
})

test('parseModelResponse — clean JSON content', () => {
  assert.deepEqual(
    parseModelResponse(envelope('{"execution_prompt_en":"Review the code"}')),
    { execution_prompt_en: 'Review the code' },
  )
})

test('parseModelResponse — fenced JSON content (regression: real gateway response)', () => {
  // This is exactly what claude-sonnet behind an OpenAI-compatible gateway returns
  // even when response_format:json_object is requested. Previously parsed to null
  // and silently fell back to the original prompt.
  assert.deepEqual(
    parseModelResponse(envelope('```json\n{"execution_prompt_en":"Review the code","rewrite_type":"translate"}\n```')),
    { execution_prompt_en: 'Review the code', rewrite_type: 'translate' },
  )
})

test('parseModelResponse — auth error returns null', () => {
  const body = JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } })
  assert.equal(parseModelResponse(body), null)
})

test('parseModelResponse — missing content returns null', () => {
  assert.equal(parseModelResponse(JSON.stringify({ choices: [{ message: {} }] })), null)
  assert.equal(parseModelResponse('not json'), null)
  assert.equal(parseModelResponse(''), null)
})

// ── failure classification — distinguish timeout from a dead endpoint, etc. ───

test('classifyCurlFailure — curl exit codes map to distinct reasons', () => {
  assert.equal(classifyCurlFailure({ status: 28 }), 'timeout')      // --max-time exceeded
  assert.equal(classifyCurlFailure({ status: 6 }), 'unreachable')   // DNS failure
  assert.equal(classifyCurlFailure({ status: 7 }), 'unreachable')   // connection refused
  assert.equal(classifyCurlFailure({ status: 35 }), 'tls_error')    // TLS handshake
  assert.equal(classifyCurlFailure({ status: 60 }), 'tls_error')    // cert problem
  assert.equal(classifyCurlFailure({ status: 22 }), 'api_error')    // any other nonzero
})

test('classifyCurlFailure — spawnSync timeout backstop is a timeout, other errors unreachable', () => {
  assert.equal(classifyCurlFailure({ error: { code: 'ETIMEDOUT' } }), 'timeout')
  assert.equal(classifyCurlFailure({ error: { code: 'ENOENT' } }), 'unreachable')
})

test('callFastModel — no API key reports no_api_key (not a generic failure)', () => {
  assert.equal(callFastModel({ messages: [] }, {}), null)
  assert.deepEqual(drainFailure(), { reason: 'no_api_key', detail: null })
  // drained — a second read is clean
  assert.equal(drainFailure(), null)
})

test('callFastModel — key set but no base url reports not_configured', () => {
  assert.equal(callFastModel({ messages: [] }, { api_key: 'sk-x' }), null)
  assert.deepEqual(drainFailure(), { reason: 'not_configured', detail: null })
})
