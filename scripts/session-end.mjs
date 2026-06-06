// SessionEnd hook — does NOT read stdin (D: SessionEnd may have no stdin pipe)
import process from 'node:process'
import { readTurnsForDay } from './lib/storage.mjs'

function main() {
  try {
    const sessionId = process.env.CLAUDE_SESSION_ID || null
    const today = new Date().toISOString().slice(0, 10)
    const all = readTurnsForDay(today)
    const records = sessionId ? all.filter(r => r.session_id === sessionId) : all

    if (records.length === 0) return

    const optimized = records.filter(r => r.execution_prompt && !r.fallback)
    const translated = records.filter(
      r => r.detected_language !== 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original'
    )
    const corrected = records.filter(
      r => r.detected_language === 'en' && !r.fallback && r.mode !== 'raw' && r.mode !== 'original'
    )
    const fallbacks = records.filter(r => r.fallback)
    const raws = records.filter(r => r.mode === 'raw')

    const parts = [`[my-lingo] Session: ${records.length} prompts`]
    if (optimized.length) {
      const detail = []
      if (translated.length) detail.push(`${translated.length} translated`)
      if (corrected.length) detail.push(`${corrected.length} corrected`)
      parts.push(`${optimized.length} optimized (${detail.join(', ')})`)
    }
    if (raws.length) parts.push(`${raws.length} !raw`)
    if (fallbacks.length) parts.push(`${fallbacks.length} fallbacks`)

    process.stderr.write(parts.join(' | ') + '\n')
  } catch {
    // never throw — exit 0 always (D2)
  }
}

main()
