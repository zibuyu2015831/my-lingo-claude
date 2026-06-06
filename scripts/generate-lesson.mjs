import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, loadSpaces, getActiveSpace } from './lib/config.mjs'
import { listCorrectionMonths, readCorrections, readTurnsLastNDays, getDataDir } from './lib/storage.mjs'
import { buildLessonMessages } from './lib/lesson.mjs'
import { callDeepModel } from './lib/analysis.mjs'

const args = process.argv.slice(2)
const daysIdx = args.indexOf('--days')
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7

const config = loadConfig(process.cwd())
const spaces = loadSpaces()
const space = getActiveSpace(spaces)
const spaceKey = spaces.active || 'english'

const today = new Date().toISOString().slice(0, 10)
const lessonDir = path.join(getDataDir(), 'learning', spaceKey)
const lessonFile = path.join(lessonDir, `lessons-${today}.md`)

// Check if today's lesson already exists (D7 lesson cooldown)
if (fs.existsSync(lessonFile)) {
  const existing = fs.readFileSync(lessonFile, 'utf8')
  process.stdout.write(existing)
  process.exit(0)
}

// Read corrections for the specified days
const cutoff = new Date()
cutoff.setDate(cutoff.getDate() - days)
const cutoffMonth = cutoff.toISOString().slice(0, 7)
const allMonths = listCorrectionMonths(spaceKey)
const relevantMonths = allMonths.filter(m => m >= cutoffMonth)
const corrections = readCorrections(spaceKey, relevantMonths)

// Read recent turns
const turns = readTurnsLastNDays(days)

const data = {
  corrections,
  turns,
  level: space.level || 'intermediate',
  space_name: space.display_name || spaceKey,
}

const payload = buildLessonMessages(data, config)
const content = callDeepModel(payload, config, { jsonMode: false })

if (!content || content.trim() === '') {
  process.stderr.write('[generate-lesson] Failed to generate lesson: empty response\n')
  process.exit(1)
}

// Write lesson to file
try {
  fs.mkdirSync(lessonDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(lessonFile, content, { mode: 0o600 })
} catch (e) {
  process.stderr.write(`[generate-lesson] Warning: could not write lesson file: ${e.message}\n`)
}

process.stdout.write(content)
