import path from 'node:path'
import os from 'node:os'

const FALLBACK_DIR = path.join(os.homedir(), '.claude', 'plugins', 'data')

// NOTE: read env at call-time (not module load) for test isolation (D6).
// Lives in its own module so both storage.mjs and db.mjs can import it
// without forming a circular dependency.
export function getDataDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || FALLBACK_DIR
  return path.join(base, 'my-lingo')
}
