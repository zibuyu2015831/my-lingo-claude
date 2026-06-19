// Manifest validator — run in CI to catch broken plugin/marketplace metadata
// before it ships. Checks JSON validity, required fields, and version
// consistency across plugin.json, marketplace.json, and package.json.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import process from 'node:process'

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')

const errors = []
const fail = (msg) => errors.push(msg)

function readJson(relPath) {
  const abs = path.join(root, relPath)
  let raw
  try {
    raw = fs.readFileSync(abs, 'utf8')
  } catch {
    fail(`${relPath}: file not found`)
    return null
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    fail(`${relPath}: invalid JSON — ${e.message}`)
    return null
  }
}

const pkg = readJson('package.json')
const plugin = readJson('.claude-plugin/plugin.json')
const market = readJson('.claude-plugin/marketplace.json')

// plugin.json — required fields
if (plugin) {
  for (const field of ['name', 'version', 'description']) {
    if (!plugin[field]) fail(`.claude-plugin/plugin.json: missing required field "${field}"`)
  }
  if (plugin.version && !/^\d+\.\d+\.\d+/.test(plugin.version)) {
    fail(`.claude-plugin/plugin.json: version "${plugin.version}" is not semver`)
  }
}

// marketplace.json — required fields and plugin entries
if (market) {
  if (!market.name) fail('.claude-plugin/marketplace.json: missing required field "name"')
  if (!market.owner?.name) fail('.claude-plugin/marketplace.json: missing required field "owner.name"')
  if (!Array.isArray(market.plugins) || market.plugins.length === 0) {
    fail('.claude-plugin/marketplace.json: "plugins" must be a non-empty array')
  } else {
    market.plugins.forEach((p, i) => {
      for (const field of ['name', 'source', 'description']) {
        if (!p[field]) fail(`.claude-plugin/marketplace.json: plugins[${i}] missing "${field}"`)
      }
    })
  }
}

// Cross-file consistency
if (plugin && pkg && plugin.version !== pkg.version) {
  fail(`version mismatch: plugin.json "${plugin.version}" != package.json "${pkg.version}"`)
}
if (plugin && market?.plugins?.length) {
  const named = market.plugins.some((p) => p.name === plugin.name)
  if (!named) fail(`marketplace.json lists no plugin named "${plugin.name}" (from plugin.json)`)
}

if (errors.length) {
  console.error('✗ Manifest validation failed:')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log(`✓ Manifests valid — ${plugin?.name}@${plugin?.version} in marketplace "${market?.name}"`)
