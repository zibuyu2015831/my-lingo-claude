const INTERVALS = [1, 3, 7, 14, 30, 60]

export function computeNextReview(reviewCount, nowMs = Date.now()) {
  const intervalDays = computeIntervalDays(reviewCount)
  return new Date(nowMs + intervalDays * 86400000)
}

// The interval (in days) applied at a given review count. Exposed so the
// storage layer can persist learning_items.interval_days alongside next_review.
export function computeIntervalDays(reviewCount) {
  const idx = Math.min(reviewCount, INTERVALS.length - 1)
  return INTERVALS[idx]
}

export function getItemsDue(items, nowMs = Date.now()) {
  if (!Array.isArray(items) || items.length === 0) return []

  const due = items.filter(item => {
    if (item.next_review === null || item.next_review === undefined) return true
    return new Date(item.next_review).getTime() <= nowMs
  })

  return due.sort((a, b) => {
    const aNull = a.next_review === null || a.next_review === undefined
    const bNull = b.next_review === null || b.next_review === undefined
    if (aNull && bNull) return 0
    if (aNull) return -1
    if (bNull) return 1
    return new Date(a.next_review).getTime() - new Date(b.next_review).getTime()
  })
}
