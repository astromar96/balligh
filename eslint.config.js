// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const gate = require('./scripts/fixture-gate.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    // dist, server/dist: build output; server/data: the server's local database and media; src/vendor: vendored third-party code (harfbuzzjs);
    // lab and research: historical prototypes and research scripts, not app code.
    // Last: files whose fixture data is not in this checkout (the public repository); empty in the full checkout.
    ignores: ['dist/*', 'server/dist/**', 'server/data/**', 'src/vendor/**', 'lab/**', 'research/**', ...gate.missingDataFiles()],
  },
]);
