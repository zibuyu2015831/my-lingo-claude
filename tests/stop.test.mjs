import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { transcriptPath, readTailBytes, extractLastResponse } from '../scripts/stop.mjs'

// ── transcriptPath ────────────────────────────────────────────────────────────

test('transcriptPath: / and _ in cwd are replaced with -', () => {
  const result = transcriptPath('/data/zibuyu/my_lingo_claude', 'sess-001')
  const expected = path.join(os.homedir(), '.claude', 'projects', '-data-zibuyu-my-lingo-claude', 'sess-001.jsonl')
  assert.equal(result, expected)
})

test('transcriptPath: path without underscore', () => {
  const result = transcriptPath('/home/user/project', 'abc123')
  const expected = path.join(os.homedir(), '.claude', 'projects', '-home-user-project', 'abc123.jsonl')
  assert.equal(result, expected)
})

test('transcriptPath: session id is included as filename', () => {
  const result = transcriptPath('/tmp/proj', 'my-session-id')
  assert.ok(result.endsWith('my-session-id.jsonl'), `unexpected path: ${result}`)
})

// ── readTailBytes ─────────────────────────────────────────────────────────────

test('readTailBytes: reads full file when smaller than maxBytes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-stop-test-'))
  try {
    const filePath = path.join(tmp, 'test.txt')
    fs.writeFileSync(filePath, 'hello world')
    const result = readTailBytes(filePath, 65536)
    assert.equal(result, 'hello world')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('readTailBytes: reads only last maxBytes when file is larger', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-stop-test-'))
  try {
    const filePath = path.join(tmp, 'big.txt')
    const content = 'A'.repeat(1000) + 'TAIL'
    fs.writeFileSync(filePath, content)
    const result = readTailBytes(filePath, 10)
    assert.ok(result.includes('TAIL'), 'should include tail content')
    assert.ok(!result.startsWith('A'.repeat(100)), 'should not include leading content')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('readTailBytes: empty file returns empty string', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-stop-test-'))
  try {
    const filePath = path.join(tmp, 'empty.txt')
    fs.writeFileSync(filePath, '')
    const result = readTailBytes(filePath, 65536)
    assert.equal(result, '')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ── extractLastResponse ───────────────────────────────────────────────────────

const SESSION_ID = 'test-session-abc'

function makeAssistantLine(text, sessionId = SESSION_ID) {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'internal thought' },
        { type: 'text', text },
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} },
      ],
    },
  })
}

test('extractLastResponse: returns text from matching assistant record', () => {
  const chunk = makeAssistantLine('Hello from Claude') + '\n'
  const result = extractLastResponse(chunk, SESSION_ID)
  assert.equal(result, 'Hello from Claude')
})

test('extractLastResponse: ignores thinking and tool_use blocks', () => {
  const chunk = makeAssistantLine('Only text content') + '\n'
  const result = extractLastResponse(chunk, SESSION_ID)
  assert.ok(!result.includes('internal thought'), 'should not include thinking content')
  assert.ok(!result.includes('Bash'), 'should not include tool_use content')
})

test('extractLastResponse: skips records with wrong sessionId', () => {
  const chunk = makeAssistantLine('Wrong session response', 'other-session') + '\n'
  const result = extractLastResponse(chunk, SESSION_ID)
  assert.equal(result, null)
})

test('extractLastResponse: returns LAST assistant text when multiple records present', () => {
  const line1 = makeAssistantLine('First response')
  const line2 = makeAssistantLine('Second response')
  const chunk = line1 + '\n' + line2 + '\n'
  const result = extractLastResponse(chunk, SESSION_ID)
  assert.equal(result, 'Second response')
})

test('extractLastResponse: empty chunk → null', () => {
  assert.equal(extractLastResponse('', SESSION_ID), null)
})

test('extractLastResponse: chunk with no assistant records → null', () => {
  const chunk = JSON.stringify({ type: 'user', sessionId: SESSION_ID, message: { role: 'user', content: 'hi' } }) + '\n'
  assert.equal(extractLastResponse(chunk, SESSION_ID), null)
})

test('extractLastResponse: malformed JSON lines are skipped without throwing', () => {
  const chunk = 'not-json\n' + makeAssistantLine('Valid response') + '\n'
  const result = extractLastResponse(chunk, SESSION_ID)
  assert.equal(result, 'Valid response')
})

test('extractLastResponse: multiple text blocks are joined', () => {
  const line = JSON.stringify({
    type: 'assistant',
    sessionId: SESSION_ID,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: 'Part 2' },
      ],
    },
  })
  const result = extractLastResponse(line + '\n', SESSION_ID)
  assert.ok(result.includes('Part 1'), 'should include first text block')
  assert.ok(result.includes('Part 2'), 'should include second text block')
})
