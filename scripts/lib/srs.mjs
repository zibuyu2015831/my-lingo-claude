const INTERVALS = [1, 3, 7, 14, 30, 60]

export function computeNextReview(reviewCount, nowMs = Date.now()) {
  const idx = Math.min(reviewCount, INTERVALS.length - 1)
  const intervalDays = INTERVALS[idx]
  return new Date(nowMs + intervalDays * 86400000)
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
