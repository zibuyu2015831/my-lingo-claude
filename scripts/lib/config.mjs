import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './storage.mjs'

const DEFAULT_CONFIG = {
  execution_mode: 'english_optimized',
  native_language: 'zh-CN',
  timeout_seconds: 8,
  fallback_policy: 'send_original',
  privacy_mode: 'standard',
  max_prompt_length: 4000,
  circuit_breaker_cooldown_minutes: 5,
  domain_terms: [],
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

  // Layer 3: global config
  const globalPath = path.join(getDataDir(), 'config.json')
  const globalCfg = safeReadJson(globalPath)
  merged = { ...merged, ...globalCfg }

  // Layer 2: active space overrides (from spaces.json)
  const spaces = loadSpaces()
  const activeSpaceName = spaces.active || 'english'
  const spaceObj = (spaces.spaces || {})[activeSpaceName] || {}
  if (spaceObj.overrides && typeof spaceObj.overrides === 'object') {
    merged = { ...merged, ...spaceObj.overrides }
  }
  merged.language_space = activeSpaceName

  // Layer 1 (highest): project-level config
  if (cwd) {
    const projectPath = path.join(cwd, '.claude-my-lingo.json')
    const projectCfg = safeReadJson(projectPath)
    merged = { ...merged, ...projectCfg }
  }

  return merged
}

export function writeConfig(config) {
  const dataDir = getDataDir()
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const configPath = path.join(dataDir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
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
