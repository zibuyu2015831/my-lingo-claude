// UserPromptSubmit hook — stub (Phase 0)
// Full implementation in Phase 5
import process from 'node:process'
import fs from 'node:fs'

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function main() {
  const input = readStdin()
  const prompt = (input.prompt || '').trim()
  if (!prompt) return
  // Phase 0 stub: pass through
}

main()
