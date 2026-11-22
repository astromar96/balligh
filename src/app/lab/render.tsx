// Dev route /lab/render — test bench for src/render (web). Registers the UI fonts the scene draws with
// (same family names as the app, src/core/fonts.ts), then hands a DOM node to the web bench, which renders
// passages fetched through src/data and exposes window.__renderLab for the headless-Chrome scripts.
import { ReadexPro_400Regular, ReadexPro_500Medium, ReadexPro_600SemiBold } from '@expo-google-fonts/readex-pro'
import { ReemKufi_400Regular, ReemKufi_600SemiBold } from '@expo-google-fonts/reem-kufi'
import { useFonts } from 'expo-font'
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { FONTS } from '../../core/fonts'
import { startBench } from '../../render/lab/bench'

export default function RenderLab() {
  const [fontsLoaded, fontError] = useFonts({
    [FONTS.ui]: ReadexPro_400Regular,
    [FONTS.uiMedium]: ReadexPro_500Medium,
    [FONTS.uiSemiBold]: ReadexPro_600SemiBold,
    [FONTS.display]: ReemKufi_400Regular,
    [FONTS.displaySemiBold]: ReemKufi_600SemiBold,
  })
  const host = useRef<ComponentRef<typeof View>>(null)
  const [status, setStatus] = useState('loading fonts…')

  useEffect(() => {
    if (!fontsLoaded && !fontError) return
    let live = true
    // react-native-web: a View ref is its DOM element
    startBench(host.current as unknown as HTMLElement | null, (s) => {
      if (live) setStatus(s)
    })
    return () => {
      live = false
    }
  }, [fontsLoaded, fontError])

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>render lab</Text>
      <Text testID="lab-status">{status}</Text>
      <View ref={host} />
    </ScrollView>
  )
}
