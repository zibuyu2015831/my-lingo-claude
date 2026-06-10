import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// Fixed, env-independent location of the install pointer. The privileged hook
// process (which alone sees CLAUDE_PLUGIN_DATA) writes the resolved data dir +
// plugin root here so that env-blind slash-command subprocesses — which see
// NEITHER CLAUDE_PLUGIN_ROOT NOR CLAUDE_PLUGIN_DATA — can locate both. This is
// the structural fix for the data-dir split; see dev_docs/14 §六-F / §十.
// Computed at call-time (not module load) so tests can redirect $HOME (D6).
function pointerFile() {
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json')
}

// Plugin root derived from this file's OWN location — 100% reliable inside any
// node process and independent of every environment variable. CLAUDE_PLUGIN_ROOT
// is NOT a real env var in hook/command subprocesses (hooks.json only template-
// expands it into the command string); see dev_docs/14 §0.5 测点4 / B11.
// paths.mjs lives at <root>/scripts/lib/paths.mjs → root is three levels up.
function pluginRoot() {
  return path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
}

function readPointer() {
  try {
    return JSON.parse(fs.readFileSync(pointerFile(), 'utf8'))
  } catch {
    return null
  }
}

// NOTE: read env at call-time (not module load) for test isolation (D6).
// Lives in its own module so both storage.mjs and db.mjs can import it
// without forming a circular dependency.
export function getDataDir() {
  // ① Privileged process (hook / proper plugin install): CLAUDE_PLUGIN_DATA is
  //    already the per-plugin data dir — do NOT append the plugin name, or proper
  //    installs would nest as …/data/my-lingo/my-lingo (dev_docs/14 §10.3-①).
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA
  // ② env-blind process (slash command): read the pointer the hook wrote.
  const ptr = readPointer()
  if (ptr && ptr.data_dir) return ptr.data_dir
  // ③ No silent fallback. A wrong-but-quiet directory ("0 turns" with no error)
  //    is exactly the original bug, so failure must be loud and actionable.
  throw new Error('[my-lingo] data dir unresolved: send one message to initialize the plugin, then retry.')
}

// Called by hook entry points. Writes the install pointer atomically and only
// when its content changed, so it is cheap to call on every prompt (B12).
// Never throws (D3): the pointer is a convenience for commands, not load-bearing
// for the hook itself.
export function writeInstallPointer() {
  try {
    const dataDir = process.env.CLAUDE_PLUGIN_DATA
    if (!dataDir) return // only the privileged hook knows the truth; never write a guess
    const pointer = pointerFile()
    const payload = JSON.stringify({ plugin_root: pluginRoot(), data_dir: dataDir }, null, 2)
    try {
      if (fs.readFileSync(pointer, 'utf8') === payload) return // already current
    } catch {}
    fs.mkdirSync(path.dirname(pointer), { recursive: true })
    const tmp = pointer + '.tmp'
    fs.writeFileSync(tmp, payload)
    fs.renameSync(tmp, pointer)
  } catch {}
}
