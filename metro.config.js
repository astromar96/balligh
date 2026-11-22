// Metro config: Expo's defaults, plus one rule: production exports leave out the dev-only lab
// routes (src/app/lab/*). The benches behind them import committed Quran Foundation test
// fixtures, and shipping those in the bundle would redistribute QF data (research/00-gaps.md D9).
// The dev server keeps them. To include them in an export for testing: BALLIGH_LABS=1 npx expo export -p web
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

const isExport = process.argv.some((arg) => arg === 'export' || arg === 'export:embed')
if (isExport && process.env.BALLIGH_LABS !== '1') {
  const labDir = path.join(__dirname, 'src', 'app', 'lab')
  const escaped = labDir.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  config.resolver.blockList = [].concat(config.resolver.blockList ?? [], new RegExp(`^${escaped}([\\\\/].*)?$`))
}

// Lab routes whose fixture data is not in this checkout (the public repository carries none) stay out of the dev
// bundle too, or the whole app would fail to load (scripts/fixture-gate.cjs).
const missingRoutes = require('./scripts/fixture-gate.cjs')
  .missingDataFiles(__dirname)
  .filter((f) => f.startsWith('src/app/'))
  .map((f) => new RegExp(`^${path.join(__dirname, f).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`))
if (missingRoutes.length > 0) config.resolver.blockList = [].concat(config.resolver.blockList ?? [], missingRoutes)

module.exports = config
