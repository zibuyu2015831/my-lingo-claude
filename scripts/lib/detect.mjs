// Language detection and skip logic — Phase 1

export function detectLanguage(text) {
  if (!text || text.trim().length === 0) {
    return { lang: 'en', ratio: 100 }
  }
  const chars = [...text]
  const total = chars.length
  const asciiCount = chars.filter(c => {
    const code = c.charCodeAt(0)
    return code >= 0x20 && code <= 0x7e
  }).length
  const ratio = Math.round((asciiCount / total) * 100)
  return {
    lang: ratio >= 85 ? 'en' : 'non-english',
    ratio,
  }
}

export function shouldSkip(prompt) {
  if (!prompt) return true

  // 1. slash commands
  if (prompt.startsWith('/')) return true

  // 2. shell commands (! prefix)
  if (prompt.startsWith('!')) return true

  // 3. too short
  const charCount = [...prompt].length
  const wordCount = prompt.split(/\s+/).filter(Boolean).length
  if (charCount < 8 && wordCount < 3) return true

  // 4. pure code block
  if (/^```/.test(prompt.trim())) return true

  // 5. URL and common shell command prefixes
  if (/^(https?:|git@|ssh:\/\/|npm |pip |cargo |brew |sudo |cd |ls |cat |grep |docker |kubectl )/i.test(prompt)) {
    return true
  }

  return false
}

// detectMode: composite helper used by tests and tools (not the production hook path)
export function detectMode(prompt) {
  if (shouldSkip(prompt)) {
    return { mode: 'skip', lang: 'en', ratio: 100, text: prompt }
  }
  const detection = detectLanguage(prompt)
  const mode = detection.lang === 'en' ? 'english' : 'non-english'
  return { mode, lang: detection.lang, ratio: detection.ratio, text: prompt }
}
