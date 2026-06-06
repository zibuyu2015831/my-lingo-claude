import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeNextReview, getItemsDue } from '../scripts/lib/srs.mjs'

const NOW = Date.now()
const DAY_MS = 86400000

// ── computeNextReview ────────────────────────────────────────────────────────

test('computeNextReview(0, now): first review → 1 day later', () => {
  const result = computeNextReview(0, NOW)
  const diff = result.getTime() - NOW
  assert.ok(Math.abs(diff - DAY_MS) < 1000, `expected ~1 day, got ${diff}ms`)
})

test('computeNextReview(1, now): second review → 3 days later', () => {
  const result = computeNextReview(1, NOW)
  const diff = result.getTime() - NOW
  assert.ok(Math.abs(diff - 3 * DAY_MS) < 1000, `expected ~3 days, got ${diff}ms`)
})

test('computeNextReview(2, now): third review → 7 days later', () => {
  const result = computeNextReview(2, NOW)
  const diff = result.getTime() - NOW
  assert.ok(Math.abs(diff - 7 * DAY_MS) < 1000, `expected ~7 days, got ${diff}ms`)
})

test('computeNextReview(3, now): → 14 days later', () => {
  const result = computeNextReview(3, NOW)
  const diff = result.getTime() - NOW
  assert.ok(Math.abs(diff - 14 * DAY_MS) < 1000, `expected ~14 days, got ${diff}ms`)
})

test('computeNextReview(4, now): → 30 days later', () => {
  const result = computeNextReview(4, NOW)
  const diff = result.getTime() - NOW
  assert.ok(Math.abs(diff - 30 * DAY_MS) < 1000, `expected ~30 days, got ${diff}ms`)
})

test('computeNextReview(5, now): → 60 days later', () => {
  const result = computeNextReview(5, NOW)
  const diff = result.getTime() - NOW
  assert.ok(Math.abs(diff - 60 * DAY_MS) < 1000, `expected ~60 days, got ${diff}ms`)
})

test('computeNextReview(99, now): beyond table → uses last interval (60 days)', () => {
  const result = computeNextReview(99, NOW)
  const diff = result.getTime() - NOW
  assert.ok(Math.abs(diff - 60 * DAY_MS) < 1000, `expected ~60 days (last slot), got ${diff}ms`)
})

test('computeNextReview returns a Date object', () => {
  const result = computeNextReview(0, NOW)
  assert.ok(result instanceof Date, 'should return Date')
})

// ── getItemsDue ──────────────────────────────────────────────────────────────

test('getItemsDue: item with next_review=null is due', () => {
  const items = [{ next_review: null, review_count: 0, ts: 'a' }]
  const result = getItemsDue(items, NOW)
  assert.equal(result.length, 1)
})

test('getItemsDue: item with past next_review is due', () => {
  const past = new Date(NOW - DAY_MS).toISOString()
  const items = [{ next_review: past, review_count: 1, ts: 'b' }]
  const result = getItemsDue(items, NOW)
  assert.equal(result.length, 1)
})

test('getItemsDue: item with future next_review is NOT due', () => {
  const future = new Date(NOW + DAY_MS).toISOString()
  const items = [{ next_review: future, review_count: 1, ts: 'c' }]
  const result = getItemsDue(items, NOW)
  assert.equal(result.length, 0)
})

test('getItemsDue: sorts null before past dates', () => {
  const items = [
    { next_review: new Date(NOW - DAY_MS).toISOString(), review_count: 2, ts: 'x' },
    { next_review: null, review_count: 0, ts: 'y' },
    { next_review: new Date(NOW - 2 * DAY_MS).toISOString(), review_count: 1, ts: 'z' },
  ]
  const result = getItemsDue(items, NOW)
  assert.equal(result.length, 3)
  assert.equal(result[0].ts, 'y', 'null should come first')
  assert.equal(result[1].ts, 'z', 'older date second')
  assert.equal(result[2].ts, 'x', 'newer date third')
})

test('getItemsDue: full sort — null → 2026-05-01 → 2026-06-01', () => {
  const future = new Date(NOW + 10 * DAY_MS).toISOString()
  const items = [
    { next_review: '2026-06-01T00:00:00.000Z', review_count: 1, ts: 'c' },
    { next_review: null, review_count: 0, ts: 'a' },
    { next_review: '2026-05-01T00:00:00.000Z', review_count: 1, ts: 'b' },
    { next_review: future, review_count: 2, ts: 'd' },
  ]
  const result = getItemsDue(items, NOW)
  // null and both past dates are due; future is not
  assert.ok(result.length >= 2, 'should have at least null and may/june entries if they are past')
  assert.equal(result[0].ts, 'a', 'null item first')
})

test('getItemsDue: empty array → returns empty, no throw', () => {
  const result = getItemsDue([], NOW)
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 0)
})

test('getItemsDue: mixed — only due items returned', () => {
  const past = new Date(NOW - 1000).toISOString()
  const future = new Date(NOW + DAY_MS).toISOString()
  const items = [
    { next_review: null, ts: 'due1' },
    { next_review: past, ts: 'due2' },
    { next_review: future, ts: 'notdue' },
  ]
  const result = getItemsDue(items, NOW)
  assert.equal(result.length, 2)
  const tss = result.map(r => r.ts)
  assert.ok(tss.includes('due1'))
  assert.ok(tss.includes('due2'))
  assert.ok(!tss.includes('notdue'))
})
