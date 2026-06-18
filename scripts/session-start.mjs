// SessionStart hook — triggers catchup analysis for unanalyzed turns from prior sessions
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getDataDir, writeInstallPointer } from './lib/paths.mjs'
import { getDb } from './lib/db.mjs'

const SESSION_END_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'session-end.mjs'
)

function lockPath() {
  return path.join(getDataDir(), 'analysis.lock')
}

function isLockFresh(maxAgeMs = 5 * 60 * 1000) {
  try {
    const stat = fs.statSync(lockPath())
    return Date.now() - stat.mtimeMs < maxAgeMs
  } catch { return false }
}

function main() {
  try {
    writeInstallPointer()
    const currentSessionId = process.env.CLAUDE_SESSION_ID
    if (!currentSessionId) return
    const db = getDb()
    // OR session_id IS NULL: NULL != 'x' evaluates to NULL in SQL, not TRUE
    const { n } = db.prepare(
      'SELECT COUNT(*) AS n FROM turns WHERE analyzed=0 AND (session_id != ? OR session_id IS NULL)'
    ).get(currentSessionId)
    if (n === 0) return
    if (isLockFresh()) return
    // Use 'node' (not process.execPath) — in Claude Code, execPath may be Electron
    const { CLAUDE_SESSION_ID: _drop, ...inheritedEnv } = process.env
    const child = spawn('node', [SESSION_END_SCRIPT], {
      detached: true,
      stdio: 'ignore',
      env: { ...inheritedEnv, MY_LINGO_CATCHUP: '1' },
    })
    child.unref()
  } catch { /* never throw */ }
}

main()
