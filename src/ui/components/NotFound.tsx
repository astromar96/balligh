// The page for a path the app does not have. GitHub Pages serves it as 404.html for every unknown URL under the
// site, so it says what happened in both languages (a broken link can come from anyone) and leads back to the app.
// Expo Router's Link adds the app's sub-path (/balligh/) on the web; the docs recommend exactly this link to "/"
// (https://docs.expo.dev/router/error-handling/ — unmatched routes).
import { Link } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { translate } from '../i18n'
import { uiPlatform } from '../platform'
import { useTheme } from '../theme'
import { RADIUS, SPACE, TOUCH, TYPE } from '../tokens'

export function NotFoundScreen() {
  const th = useTheme()
  const home = `${translate('ar', 'notFoundHome')} · ${translate('en', 'notFoundHome')}`
  return (
    <View style={[styles.root, { backgroundColor: th.bg }]} {...uiPlatform.rootProps('ar')} testID="not-found">
      <View style={styles.column}>
        <View style={styles.brandRow}>
          <Text style={[TYPE.brand, { color: th.text }]}>{translate('ar', 'appName')}</Text>
          <View style={[styles.rule, { backgroundColor: th.gold }]} />
        </View>
        <Text accessibilityRole="header" style={[TYPE.section, styles.center, { color: th.text }]}>
          {translate('ar', 'notFoundTitle')}
        </Text>
        <Text style={[TYPE.body, styles.center, { color: th.textMuted }]}>{translate('ar', 'notFoundBody')}</Text>
        <View style={styles.english} {...uiPlatform.rootProps('en')}>
          <Text style={[TYPE.title, styles.center, { color: th.text }]}>{translate('en', 'notFoundTitle')}</Text>
          <Text style={[TYPE.small, styles.center, { color: th.textMuted }]}>{translate('en', 'notFoundBody')}</Text>
        </View>
        {/* one flat style object: Link's Slot drops a style function and refuses a style array */}
        <Link href="/" asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={home} style={StyleSheet.flatten([styles.home, { backgroundColor: th.primary }])}>
            <Text style={[TYPE.bodyMedium, { color: th.onPrimary }]}>{home}</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.lg, paddingVertical: SPACE.xxl },
  column: { width: '100%', maxWidth: 440, alignItems: 'center', gap: SPACE.md },
  brandRow: { alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.sm },
  rule: { width: 48, height: 1.5, opacity: 0.8 },
  center: { textAlign: 'center' },
  english: { alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.sm },
  home: { marginTop: SPACE.lg, minHeight: TOUCH, paddingHorizontal: SPACE.xl, borderRadius: RADIUS.control, alignItems: 'center', justifyContent: 'center' },
})
