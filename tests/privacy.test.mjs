import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, redactMessages } from '../scripts/lib/privacy.mjs'

// ── API keys ─────────────────────────────────────────────────────────────────

test('redact: sk- API key → [API_KEY]', () => {
  const result = redact('Use this key: sk-abc1234567890abcdef12345')
  assert.ok(result.includes('[API_KEY]'), `got: ${result}`)
  assert.ok(!result.includes('sk-abc'), `still contains key: ${result}`)
})

test('redact: Bearer token → [API_KEY]', () => {
  const result = redact('Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnop')
  assert.ok(result.includes('[API_KEY]'), `got: ${result}`)
})

test('redact: GitHub token ghp_ → [API_KEY]', () => {
  const result = redact('auth: ghp_' + 'a'.repeat(36))
  assert.ok(result.includes('[API_KEY]'), `got: ${result}`)
})

test('redact: GitHub token gho_ → [API_KEY]', () => {
  const result = redact('auth: gho_' + 'b'.repeat(36))
  assert.ok(result.includes('[API_KEY]'), `got: ${result}`)
})

// ── DB passwords ──────────────────────────────────────────────────────────────

test('redact: postgres connection string password', () => {
  const result = redact('postgres://user:s3cr3tpassword@host/db')
  assert.ok(result.includes('[PASS]'), `got: ${result}`)
  assert.ok(!result.includes('s3cr3tpassword'), `password leaked: ${result}`)
})

test('redact: mysql connection string password', () => {
  const result = redact('mysql://admin:mysecret123@localhost/mydb')
  assert.ok(result.includes('[PASS]'), `got: ${result}`)
})

// ── password= patterns ────────────────────────────────────────────────────────

test('redact: password=secret123 → [REDACTED]', () => {
  const result = redact('password=secret123')
  assert.ok(result.includes('[REDACTED]'), `got: ${result}`)
  assert.ok(!result.includes('secret123'), `password leaked: ${result}`)
})

test('redact: token=abc123 → [REDACTED]', () => {
  const result = redact('token=abc123')
  assert.ok(result.includes('[REDACTED]'), `got: ${result}`)
})

// ── PEM private key ───────────────────────────────────────────────────────────

test('redact: PEM private key block → [PRIVATE_KEY]', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----'
  const result = redact(pem)
  assert.ok(result.includes('[PRIVATE_KEY]'), `got: ${result}`)
  assert.ok(!result.includes('MIIEowIBAAKCAQEA'), `key content leaked: ${result}`)
})

// ── home paths ────────────────────────────────────────────────────────────────

test('redact: /home/alice/ → /home/[USER]/', () => {
  const result = redact('/home/alice/projects/myapp')
  assert.ok(result.includes('/home/[USER]/'), `got: ${result}`)
  assert.ok(!result.includes('/home/alice/'), `username leaked: ${result}`)
})

test('redact: /Users/bob/ → /Users/[USER]/', () => {
  const result = redact('/Users/bob/code/service')
  assert.ok(result.includes('/Users/[USER]/'), `got: ${result}`)
  assert.ok(!result.includes('/Users/bob/'), `username leaked: ${result}`)
})

// ── private IPs ───────────────────────────────────────────────────────────────

test('redact: 192.168.x.x → [PRIVATE_IP]', () => {
  const result = redact('host: 192.168.1.100')
  assert.ok(result.includes('[PRIVATE_IP]'), `got: ${result}`)
  assert.ok(!result.includes('192.168.1.100'), `IP leaked: ${result}`)
})

test('redact: 10.x.x.x → [PRIVATE_IP]', () => {
  const result = redact('connect to 10.0.0.1:5432')
  assert.ok(result.includes('[PRIVATE_IP]'), `got: ${result}`)
})

test('redact: 172.16-31.x.x → [PRIVATE_IP]', () => {
  const result = redact('server: 172.20.1.50')
  assert.ok(result.includes('[PRIVATE_IP]'), `got: ${result}`)
})

// ── privacy mode off ──────────────────────────────────────────────────────────

test('redact: privacyMode=off returns unchanged text', () => {
  const input = 'sk-abc1234567890abcdef12345 postgres://user:pass@host/db'
  assert.equal(redact(input, 'off'), input)
})

// ── false positive prevention ─────────────────────────────────────────────────

test('redact: variable name "password_manager" not redacted', () => {
  const result = redact('use password_manager.get(key)')
  assert.ok(!result.includes('[REDACTED]'), `false positive: ${result}`)
})

test('redact: package name "sk-learn" not redacted', () => {
  // sk-learn is only 7 chars after sk-, does not meet the 20-char threshold
  const result = redact('import sklearn from sk-learn')
  assert.ok(!result.includes('[API_KEY]'), `false positive: ${result}`)
})

test('redact: public IP not redacted', () => {
  const result = redact('server: 8.8.8.8')
  assert.equal(result, 'server: 8.8.8.8')
})

// ── redactMessages: the outbound API boundary scrubber (F2 / D-A) ─────────────

test('redactMessages: scrubs secrets in every message content', () => {
  const messages = [
    { role: 'system', content: 'You are a helper.' },
    { role: 'user', content: 'deploy with password=hunter2 to 192.168.1.10' },
  ]
  const out = redactMessages(messages)
  assert.ok(out[1].content.includes('[REDACTED]'), `password not scrubbed: ${out[1].content}`)
  assert.ok(out[1].content.includes('[PRIVATE_IP]'), `IP not scrubbed: ${out[1].content}`)
  assert.ok(!out[1].content.includes('hunter2'), `secret leaked: ${out[1].content}`)
  // system message left intact
  assert.equal(out[0].content, 'You are a helper.')
})

test('redactMessages: privacyMode=off passes through unchanged', () => {
  const messages = [{ role: 'user', content: 'sk-abc1234567890abcdef12345' }]
  assert.equal(redactMessages(messages, 'off'), messages)
})

test('redactMessages: does not mutate the input array', () => {
  const messages = [{ role: 'user', content: 'token=abc1234567890' }]
  const out = redactMessages(messages)
  assert.equal(messages[0].content, 'token=abc1234567890', 'input must be untouched')
  assert.notEqual(out[0], messages[0], 'should return new message objects')
})

test('redactMessages: tolerates non-array / non-string content', () => {
  assert.equal(redactMessages(null), null)
  const messages = [{ role: 'user', content: { parts: ['x'] } }]
  const out = redactMessages(messages)
  assert.deepEqual(out[0].content, { parts: ['x'] }, 'non-string content untouched')
})
