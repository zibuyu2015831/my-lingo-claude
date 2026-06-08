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
import { debugLog } from './lib/debug.mjs'

function main() {
  try {
    const sessionId = process.env.CLAUDE_SESSION_ID || null
    const today = new Date().toISOString().slice(0, 10)

    debugLog('SESSION_START', { session_id: sessionId, cwd: process.cwd() })

    // Idempotent: only turns not yet folded into a committed analysis. Crash
    // reruns and double invocations see an empty set and exit with no effect.
    const records = readUnanalyzedTurns(sessionId)
    if (records.length === 0) {
      debugLog('SESSION_EMPTY', { session_id: sessionId })
      return
    }
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

    debugLog('SESSION_STATS', {
      session_id: sessionId,
      total: records.length,
      optimized: optimized.length,
      translated: translated.length,
      corrected: corrected.length,
      fallbacks: fallbacks.length,
      raws: raws.length,
    })

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
        const reason = !shouldAnalyze ? 'disabled' : 'no_targets'
        debugLog('SESSION_ANALYSIS_SKIP', { reason, space }, config)
        markTurnsAnalyzed(ids)
        return
      }

      // ① Network call OUTSIDE the transaction (slow, may fail).
      const responses = readResponsesForSession(sessionId, today)
      debugLog('SESSION_ANALYSIS_START', {
        targets: analysisTargets.length,
        responses: responses.length,
        space,
      }, config)

      const messages = buildAnalysisMessages(analysisTargets, config, responses)
      const result = messages ? callDeepModel(messages, config, { maxTimeSeconds: 12 }) : null

      debugLog('SESSION_ANALYSIS_RESULT', {
        has_result: Boolean(result),
        corrections: result?.corrections?.length ?? 0,
        learning_points: result?.learning_points?.length ?? 0,
      }, config)

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
        debugLog('SESSION_COMMIT', { session_id: sessionId }, config)
      } catch (e) {
        try { db.exec('ROLLBACK') } catch {}
        debugLog('SESSION_ROLLBACK', { error: e?.message ?? String(e) }, config)
      }
    } catch (e) {
      debugLog('SESSION_ANALYSIS_ERROR', { error: e?.message ?? String(e) })
    }

    debugLog('SESSION_DONE', { session_id: sessionId })
  } catch {
    // never throw — exit 0 always (D2)
  }
}

main()
