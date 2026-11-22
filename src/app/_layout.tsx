import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Platform, View } from 'react-native'
import { registerServiceWorker } from '../pwa'
import { DARK, FONT_SOURCES, LIGHT, useAppStore, useColorSchemeSafe } from '../ui'

// PWA: the service worker (web production builds only; after the load event; a no-op on native and in Node).
// The update notice speaks the UI language at the moment it appears.
registerServiceWorker({ language: () => useAppStore.getState().language })

// Root layout: registers the fonts (names from core/fonts.ts; static rendering embeds them in the HTML
// because useFonts runs synchronously here) and hosts the single screen.
export default function RootLayout() {
  const [loaded, error] = useFonts(FONT_SOURCES)
  const theme = useColorSchemeSafe() === 'dark' ? DARK : LIGHT
  // native: wait for the fonts (no Arabic fallback flash); web: the @font-face rules are already in the page
  if (!loaded && !error && Platform.OS !== 'web') return <View style={{ flex: 1, backgroundColor: theme.bg }} />
  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
    </>
  )
}
