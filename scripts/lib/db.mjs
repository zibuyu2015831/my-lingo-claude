// SQLite connection layer (v0.5). Single chokepoint for all node:sqlite usage —
// if the experimental API changes, only this file and storage.mjs need updating.

// Suppress node:sqlite's ExperimentalWarning before it can fire (it emits when
// DatabaseSync is constructed). The default 'warning' listener prints every
// warning; we remove it, then re-emit everything EXCEPT the SQLite experimental
// notice so other warnings still surface. Must run before importing node:sqlite.
process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return
  process.stderr.write((w.stack || w.message) + '\n')
})

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './paths.mjs'

let _db = null
let _warnedUnavailable = false

// Surface a backend-unavailable failure ONCE on stderr. Without this, every
// storage helper's catch{} swallows the cause and the plugin silently records
// nothing — exactly the "quiet wrong" failure class the data-dir rewrite set out
// to eliminate. Storage helpers still degrade gracefully; this just makes the
// root cause visible. See ARCHITECTURE_REVIEW F5 / D-D.
function warnUnavailableOnce(err) {
  if (_warnedUnavailable) return
  _warnedUnavailable = true
  try {
    process.stderr.write(
      `[my-lingo] SQLite backend unavailable (needs Node >= 22.5 with node:sqlite): ` +
      `${err?.message ?? err}\n`,
    )
  } catch {}
}

export function getDb() {
  if (_db) return _db
  // getDataDir() raises its own clear, distinct error if the data dir is
  // unresolved (commands surface it as a loud non-zero exit) — keep it OUT of
  // the try below so it is not mislabeled as a SQLite failure.
  const dir = getDataDir()
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }) // DatabaseSync requires parent dir to exist
    const dbPath = path.join(dir, 'data.db')
    _db = new DatabaseSync(dbPath)
    _db.exec('PRAGMA journal_mode=WAL')   // multi-process: concurrent readers + one writer
    _db.exec('PRAGMA busy_timeout=3000')  // wait up to 3s on write contention before SQLITE_BUSY
    _db.exec('PRAGMA synchronous=NORMAL') // safe + faster under WAL
    // (no foreign_keys pragma: the schema declares no FK constraints, so it would
    //  be a no-op that misleadingly implies referential enforcement.)
    initSchema(_db)
    try { fs.chmodSync(dbPath, 0o600) } catch {} // match the 0o600 file convention, best-effort
    return _db
  } catch (err) {
    warnUnavailableOnce(err)
    throw err
  }
}

// Close and clear the singleton. Unit tests switch CLAUDE_PLUGIN_DATA between
// cases; without this the cached connection points at an already-removed dir.
export function resetDb() {
  if (_db) {
    try { _db.close() } catch {}
    _db = null
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id                INTEGER PRIMARY KEY,
      ts                TEXT    NOT NULL,
      session_id        TEXT,
      cwd               TEXT,
      language_space    TEXT    DEFAULT 'english',
      mode              TEXT,
      detected_language TEXT,
      original_prompt   TEXT,
      execution_prompt  TEXT,
      rewrite_type      TEXT,
      latency_ms        INTEGER,
      fallback          INTEGER DEFAULT 0,
      fallback_reason   TEXT,
      analyzed          INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session  ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turns_ts       ON turns(ts);
    CREATE INDEX IF NOT EXISTS idx_turns_analyzed ON turns(session_id, analyzed);

    CREATE TABLE IF NOT EXISTS responses (
      id         INTEGER PRIMARY KEY,
      ts         TEXT    NOT NULL,
      session_id TEXT,
      text       TEXT,
      word_count INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);

    CREATE TABLE IF NOT EXISTS corrections (
      id             INTEGER PRIMARY KEY,
      ts             TEXT NOT NULL,
      session_id     TEXT,
      turn_id        INTEGER,
      language_space TEXT,
      type           TEXT,
      original       TEXT,
      corrected      TEXT,
      explanation    TEXT,
      pattern        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_space   ON corrections(language_space);
    CREATE INDEX IF NOT EXISTS idx_corrections_session ON corrections(session_id);

    CREATE TABLE IF NOT EXISTS learning_items (
      id                 INTEGER PRIMARY KEY,
      ts                 TEXT    NOT NULL,
      session_id         TEXT,
      language_space     TEXT,
      type               TEXT,
      target_text        TEXT,
      native_explanation TEXT,
      next_review        TEXT,
      review_count       INTEGER DEFAULT 0,
      interval_days      INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_items_space       ON learning_items(language_space);
    CREATE INDEX IF NOT EXISTS idx_items_next_review ON learning_items(next_review);

    CREATE TABLE IF NOT EXISTS sessions (
      id             INTEGER PRIMARY KEY,
      ts             TEXT NOT NULL,
      session_id     TEXT UNIQUE,
      language_space TEXT,
      total_prompts  INTEGER,
      optimized      INTEGER,
      translated     INTEGER,
      corrected      INTEGER,
      fallbacks      INTEGER,
      raws           INTEGER,
      top_errors     TEXT
    );
  `)
}
