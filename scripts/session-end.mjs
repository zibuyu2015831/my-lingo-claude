// SessionEnd hook — does NOT read stdin (D: SessionEnd may have no stdin pipe)
import process from 'node:process'
import {
  readUnanalyzedTurns,
  markTurnsAnalyzed,
  writeCorrection,
  writeLearningItem,
  writeSession,
  readResponsesForSession,
} from './lib/storage.mjs'
import { getDb } from './lib/db.mjs'
import { loadConfig, loadSpaces, getActiveSpace } from './lib/config.mjs'
import { buildAnalysisMessages, callDeepModel } from './lib/analysis.mjs'

function main() {
  try {
    const sessionId = process.env.CLAUDE_SESSION_ID || null
    const today = new Date().toISOString().slice(0, 10)

    // Idempotent: only turns not yet folded into a committed analysis. Crash
    // reruns and double invocations see an empty set and exit with no effect.
    const records = readUnanalyzedTurns(sessionId)
    if (records.length === 0) return
    const ids = records.map(r => r.id)

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
    if (raws.length) parts.push(`${raws.length} --`)
    if (fallbacks.length) parts.push(`${fallbacks.length} fallbacks`)

    process.stderr.write(parts.join(' | ') + '\n')

    // ── analysis (v0.2) ─────────────────────────────────────────────────────
    try {
      const config = loadConfig(process.cwd())
      const spaces = loadSpaces()
      const activeSpace = getActiveSpace(spaces)

      const analysisTargets = records.filter(r =>
        r.execution_prompt &&
        !r.fallback &&
        r.mode !== 'raw' &&
        r.mode !== 'original'
      )

      const shouldAnalyze = activeSpace.auto_generate_learning !== false
      const space = config.language_space ?? 'english'

      // No analysis to run (disabled or nothing to analyze): still mark the
      // turns processed so they are not reconsidered next time.
      if (!shouldAnalyze || !analysisTargets.length) {
        markTurnsAnalyzed(ids)
        return
      }

      // ① Network call OUTSIDE the transaction (slow, may fail).
      const responses = readResponsesForSession(sessionId, today)
      const messages = buildAnalysisMessages(analysisTargets, config, responses)
      const result = messages ? callDeepModel(messages, config, { maxTimeSeconds: 12 }) : null

      // ② DB writes + analyzed flag committed atomically: a crash mid-write
      //    rolls back entirely, so a rerun never produces duplicate corrections.
      const db = getDb()
      db.exec('BEGIN')
      try {
        for (const c of (result?.corrections ?? [])) {
          writeCorrection({ ...c, session_id: sessionId, turn_id: null }, space)
        }
        for (const item of (result?.learning_points ?? [])) {
          writeLearningItem({ ...item, language_space: space }, space)
        }
        writeSession({
          session_id: sessionId,
          language_space: space,
          total_prompts: records.length,
          optimized: optimized.length,
          translated: translated.length,
          corrected: corrected.length,
          fallbacks: fallbacks.length,
          raws: raws.length,
          top_errors: result?.corrections?.slice(0, 3).map(c => ({
            pattern: c.pattern ?? c.type,
            count: 1,
          })) ?? [],
        })
        markTurnsAnalyzed(ids)
        db.exec('COMMIT')
      } catch {
        try { db.exec('ROLLBACK') } catch {}
      }
    } catch {
      // analysis failures are silent
    }
  } catch {
    // never throw — exit 0 always (D2)
  }
}

main()
