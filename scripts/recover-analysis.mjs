#!/usr/bin/env node
// Recovery tool — regenerate learning materials for historical turns whose
// SessionEnd analysis was lost. Older builds marked turns analyzed=1 even when
// the deep-model call timed out (common with slow reasoning models), so those
// turns produced no corrections / learning_items and would never be retried.
//
// This script re-runs the deep analysis for target turns in a recent window,
// in foreground, batch by batch, writing results directly to the DB. It does
// NOT touch the `analyzed` flag — it only fills in the missing materials, and
// the date filter keeps the scope precise.
//
//   node scripts/recover-analysis.mjs            # default: last 3 days
//   node scripts/recover-analysis.mjs --days 7
//
import process from 'node:process'
import { getDb } from './lib/db.mjs'
import { loadConfig } from './lib/config.mjs'
import { buildAnalysisMessages, callDeepModel } from './lib/analysis.mjs'
import { writeCorrection, writeLearningItem } from './lib/storage.mjs'

function parseDays(argv) {
  const i = argv.indexOf('--days')
  if (i !== -1 && argv[i + 1]) {
    const v = parseInt(argv[i + 1], 10)
    if (Number.isFinite(v) && v > 0) return v
  }
  return 3
}

function cutoffDate(days) {
  // ts is an ISO string; compare on the YYYY-MM-DD prefix.
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function main() {
  const days = parseDays(process.argv.slice(2))
  const cutoff = cutoffDate(days)
  const config = loadConfig(process.cwd())
  const space = config.language_space ?? 'english'

  if (!config.api_base_url || !(config.model_deep || config.model_fast)) {
    console.error('[recover] API not configured (api_base_url / model). Run /my-lingo:setup.')
    process.exit(1)
  }

  const db = getDb()
  // Real analysis targets only — same filter SessionEnd uses (execution_prompt,
  // not a fallback, not raw/original) — restricted to the recovery window.
  const turns = db.prepare(`
    SELECT id, ts, session_id, original_prompt, execution_prompt, detected_language
    FROM turns
    WHERE execution_prompt IS NOT NULL
      AND fallback = 0
      AND mode NOT IN ('raw','original')
      AND substr(ts, 1, 10) >= ?
    ORDER BY id
  `).all(cutoff)

  if (turns.length === 0) {
    console.log(`[recover] No target turns since ${cutoff}. Nothing to do.`)
    return
  }

  const batchSize = config.analysis_batch_size ?? 5
  const deepTimeout = config.deep_timeout_seconds ?? 120
  const totalBatches = Math.ceil(turns.length / batchSize)
  console.log(`[recover] ${turns.length} turns since ${cutoff} → ${totalBatches} batches of ${batchSize} (deep model: ${config.model_deep || config.model_fast}, timeout ${deepTimeout}s)`)

  // Make re-runs idempotent: clear any prior recovery/catchup output in the
  // window (session_id IS NULL) before regenerating, so a second run after a
  // partial failure does not duplicate the materials from batches that already
  // succeeded. Live-session materials (session_id set) are left untouched.
  const delC = db.prepare(`DELETE FROM corrections WHERE session_id IS NULL AND substr(ts,1,10) >= ?`).run(cutoff)
  const delL = db.prepare(`DELETE FROM learning_items WHERE session_id IS NULL AND substr(ts,1,10) >= ?`).run(cutoff)
  if (delC.changes || delL.changes) {
    console.log(`[recover] cleared ${delC.changes} corrections + ${delL.changes} learning items from a prior run`)
  }

  let okBatches = 0, failBatches = 0, corrections = 0, items = 0

  for (let b = 0; b < totalBatches; b++) {
    const batch = turns.slice(b * batchSize, b * batchSize + batchSize)
    process.stdout.write(`[recover] batch ${b + 1}/${totalBatches} (${batch.length} turns)… `)

    const messages = buildAnalysisMessages(batch, config, [])
    const result = messages ? callDeepModel(messages, config, { maxTimeSeconds: deepTimeout }) : null

    if (!result) {
      failBatches++
      console.log('FAILED (timeout / API error) — left for a later run')
      continue
    }

    // Attribute recovered materials to the batch's first turn date so they land
    // in the right month for /vocab and /errors browsing.
    const ts = batch[0].ts
    let bc = 0, bi = 0
    db.exec('BEGIN')
    try {
      for (const c of (result.corrections ?? [])) {
        writeCorrection({ ...c, ts, session_id: null, turn_id: null }, space)
        bc++
      }
      for (const item of (result.learning_points ?? [])) {
        writeLearningItem({ ...item, ts, session_id: null, language_space: space }, space)
        bi++
      }
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch {}
      failBatches++
      console.log(`DB write failed: ${e?.message ?? e}`)
      continue
    }

    okBatches++
    corrections += bc
    items += bi
    console.log(`ok (+${bc} corrections, +${bi} learning items)`)
  }

  console.log(`\n[recover] done: ${okBatches} ok, ${failBatches} failed | wrote ${corrections} corrections, ${items} learning items`)
  if (failBatches > 0) {
    console.log('[recover] Re-run the same command to retry failed batches — the pre-clean step keeps it idempotent (no duplicates).')
  }
}

main()
