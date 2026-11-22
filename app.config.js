// Dynamic layer over app.json. Only one thing changes per build: the web sub-path.
// The live site (https://sharequran.app) is served from the domain root, so scripts/deploy-pages.sh leaves
// BALLIGH_BASE_URL empty; a Pages deploy without a custom domain sets BALLIGH_BASE_URL=/<repo>
// (Expo's experiments.baseUrl: https://docs.expo.dev/more/expo-cli/#hosting-with-sub-paths).
// Without the variable the config is exactly app.json.
module.exports = ({ config }) => {
  const baseUrl = process.env.BALLIGH_BASE_URL
  if (!baseUrl) return config
  return { ...config, experiments: { ...config.experiments, baseUrl } }
}
