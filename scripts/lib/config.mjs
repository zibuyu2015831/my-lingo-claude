import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './storage.mjs'

// These fields are only valid from environment variables — never read from or written to files
const CREDENTIAL_FIELDS = new Set(['api_key', 'api_base_url', 'model_fast', 'model_deep'])

const DEFAULT_CONFIG = {
  execution_mode: 'english_optimized',
  native_language: 'zh-CN',
  timeout_seconds: 8,
  fallback_policy: 'send_original',
  privacy_mode: 'standard',
  max_prompt_length: 4000,
  circuit_breaker_cooldown_minutes: 5,
  domain_terms: [],
  display_mode: 'compact',
  target_language: 'en',
  response_language_mode: 'off',
}

const DEFAULT_SPACE = {
  key: 'english',
  display_name: 'English',
  target_language: 'en',
  native_language: 'zh-CN',
  level: 'intermediate',
  display_mode: 'compact',
  auto_generate_learning: true,
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function loadConfig(cwd) {
  // Layer 4 (lowest): defaults
  let merged = { ...DEFAULT_CONFIG }

  // Layer 3: global config (credential fields ignored — env vars are the only source)
  const globalPath = path.join(getDataDir(), 'config.json')
  const rawGlobal = safeReadJson(globalPath)
  const globalCfg = Object.fromEntries(Object.entries(rawGlobal).filter(([k]) => !CREDENTIAL_FIELDS.has(k)))
  merged = { ...merged, ...globalCfg }

  // Layer 2: active space overrides (from spaces.json)
  const spaces = loadSpaces()
  const activeSpaceName = spaces.active || 'english'
  const spaceObj = (spaces.spaces || {})[activeSpaceName] || {}
  // Merge key space fields directly so config.target_language / display_mode / native_language
  // always reflect the active space, not just the global default.
  if (spaceObj.target_language) merged.target_language = spaceObj.target_language
  if (spaceObj.native_language) merged.native_language = spaceObj.native_language
  if (spaceObj.display_mode)    merged.display_mode    = spaceObj.display_mode
  if (spaceObj.overrides && typeof spaceObj.overrides === 'object') {
    merged = { ...merged, ...spaceObj.overrides }
  }
  merged.language_space = activeSpaceName

  // Layer 1: project-level config (credential fields ignored)
  if (cwd) {
    const projectPath = path.join(cwd, '.claude-my-lingo.json')
    const rawProject = safeReadJson(projectPath)
    const projectCfg = Object.fromEntries(Object.entries(rawProject).filter(([k]) => !CREDENTIAL_FIELDS.has(k)))
    merged = { ...merged, ...projectCfg }
  }

  // Layer 0 (highest): environment variable overrides for API credentials
  if (process.env.MY_LINGO_API_KEY)      merged.api_key      = process.env.MY_LINGO_API_KEY
  if (process.env.MY_LINGO_API_BASE_URL) merged.api_base_url = process.env.MY_LINGO_API_BASE_URL
  if (process.env.MY_LINGO_MODEL_FAST)   merged.model_fast   = process.env.MY_LINGO_MODEL_FAST
  if (process.env.MY_LINGO_MODEL_DEEP)   merged.model_deep   = process.env.MY_LINGO_MODEL_DEEP

  return merged
}

export function writeConfig(config) {
  const dataDir = getDataDir()
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const configPath = path.join(dataDir, 'config.json')
  const safeConfig = Object.fromEntries(Object.entries(config).filter(([k]) => !CREDENTIAL_FIELDS.has(k)))
  fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), { mode: 0o600 })
}

export function loadSpaces() {
  const spacesPath = path.join(getDataDir(), 'spaces.json')
  const raw = safeReadJson(spacesPath)
  if (raw.active && raw.spaces) return raw
  return {
    active: 'english',
    spaces: { english: { ...DEFAULT_SPACE } },
  }
}

export function getActiveSpace(spacesData) {
  const spaces = spacesData || loadSpaces()
  const active = spaces.active || 'english'
  return (spaces.spaces || {})[active] || { ...DEFAULT_SPACE }
}

function getSpacesPath() {
  return path.join(getDataDir(), 'spaces.json')
}

function writeSpaces(data) {
  const spacesPath = getSpacesPath()
  const tmp = spacesPath + '.tmp'
  const dir = path.dirname(spacesPath)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, spacesPath)
}

export function setActiveSpace(key) {
  const data = loadSpaces()
  if (!(key in data.spaces)) {
    throw new Error(`Space '${key}' not found. Available: ${Object.keys(data.spaces).join(', ')}`)
  }
  data.active = key
  writeSpaces(data)
}

export function addSpace(key, overrides = {}) {
  const normalKey = key.toLowerCase()
  const data = loadSpaces()
  const now = new Date().toISOString()
  const existing = data.spaces[normalKey] || {}
  const displayName = normalKey.charAt(0).toUpperCase() + normalKey.slice(1)
  const newSpace = {
    display_name: displayName,
    target_language: 'en',
    native_language: 'zh-CN',
    level: 'intermediate',
    display_mode: 'compact',
    auto_generate_learning: true,
    created_at: existing.created_at || now,
    ...overrides,
    key: normalKey,
    updated_at: now,
  }
  data.spaces[normalKey] = newSpace
  writeSpaces(data)
  return newSpace
}

export function removeSpace(key) {
  const data = loadSpaces()
  if (!(key in data.spaces)) return
  delete data.spaces[key]
  writeSpaces(data)
}
