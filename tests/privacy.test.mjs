import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from '../scripts/lib/privacy.mjs'

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
