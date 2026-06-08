// SessionEnd hook — does NOT read stdin (D: SessionEnd may have no stdin pipe)
import process from 'node:process'
import { readTurnsForDay, writeCorrection, writeLearningItem, writeSession, readResponsesForSession } from './lib/storage.mjs'
import { loadConfig, loadSpaces, getActiveSpace } from './lib/config.mjs'
import { buildAnalysisMessages, callDeepModel } from './lib/analysis.mjs'

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
      if (!shouldAnalyze || !analysisTargets.length) return

      const responses = readResponsesForSession(sessionId, today)
      const messages = buildAnalysisMessages(analysisTargets, config, responses)
      if (!messages) return
      const result = callDeepModel(messages, config, { maxTimeSeconds: 12 })
      if (!result) return

      const space = config.language_space ?? 'english'
      for (const c of (result.corrections ?? [])) {
        writeCorrection({ ...c, session_id: sessionId, turn_ref: null }, space)
      }
      for (const item of (result.learning_points ?? [])) {
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
        top_errors: result.corrections?.slice(0, 3).map(c => ({
          pattern: c.pattern ?? c.type,
          count: 1,
        })) ?? [],
      })
    } catch {
      // analysis failures are silent
    }
  } catch {
    // never throw — exit 0 always (D2)
  }
}

main()
