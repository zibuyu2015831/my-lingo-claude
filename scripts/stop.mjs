// Stop hook — captures Claude's last text response from the transcript JSONL.
// Fires after each Claude turn. Constraints: no API calls, no sleep/retry,
// target < 200ms, all errors silent, always exit 0.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { writeResponseRecord } from './lib/storage.mjs'
import { debugLog } from './lib/debug.mjs'
import { writeInstallPointer } from './lib/paths.mjs'

// Derive Claude Code transcript path from cwd + sessionId.
// Claude Code maps EVERY non-alphanumeric char in the project path to '-' (not
// just '/' and '_'), so a cwd containing '.', ' ', '@', etc. must be handled too
// — otherwise the path misses and response capture silently fails (F8).
// e.g. /data/zibuyu/my_lingo_claude → -data-zibuyu-my-lingo-claude
export function transcriptPath(cwd, sessionId) {
  const hash = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return path.join(os.homedir(), '.claude', 'projects', hash, `${sessionId}.jsonl`)
}

// Read only the tail of a file (up to maxBytes from the end).
// Avoids loading multi-MB transcripts for long sessions.
export function readTailBytes(filePath, maxBytes) {
  const stat = fs.statSync(filePath)
  if (stat.size === 0) return ''
  const readSize = Math.min(stat.size, maxBytes)
  const buf = Buffer.alloc(readSize)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize)
  } finally {
    fs.closeSync(fd)
  }
  return buf.toString('utf8')
}

// Scan transcript chunk backwards to find the latest assistant text for this session.
// Returns the joined text content, or null if not found.
export function extractLastResponse(chunk, sessionId) {
  const lines = chunk.split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    let record
    try { record = JSON.parse(lines[i]) } catch { continue }
    if (record.type !== 'assistant') continue
    if (record.sessionId !== sessionId) continue
    const content = record.message?.content
    if (!Array.isArray(content)) continue
    const texts = content
      .filter(c => c.type === 'text' && typeof c.text === 'string' && c.text.trim())
      .map(c => c.text.trim())
    if (texts.length > 0) return texts.join('\n')
  }
  return null
}

function main() {
  try {
    writeInstallPointer() // refresh the env-blind command pointer (dev_docs/14 §六-F)

    const sessionId = process.env.CLAUDE_SESSION_ID
    if (!sessionId) return

    debugLog('STOP_START', { session_id: sessionId, cwd: process.cwd() })

    const tPath = transcriptPath(process.cwd(), sessionId)
    if (!fs.existsSync(tPath)) {
      debugLog('STOP_TRANSCRIPT_MISS', { path: tPath })
      return
    }

    const fileSize = fs.statSync(tPath).size
    debugLog('STOP_TRANSCRIPT_HIT', { path: tPath, file_size: fileSize })

    // 64KB covers ~50 records — sufficient for any realistic turn
    const chunk = readTailBytes(tPath, 65536)
    const text = extractLastResponse(chunk, sessionId)
    if (!text) {
      const lines = chunk.split('\n').filter(Boolean).length
      debugLog('STOP_RESPONSE_MISS', { chunk_lines: lines, session_id: sessionId })
      return
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length
    debugLog('STOP_RESPONSE_FOUND', { word_count: wordCount, preview: text.slice(0, 120) })

    writeResponseRecord({
      session_id: sessionId,
      text,
      word_count: wordCount,
    })
    debugLog('STOP_DB_WRITE', { session_id: sessionId, word_count: wordCount })
  } catch {
    // Never throw — Stop hook must always exit 0
  }
}

main()
