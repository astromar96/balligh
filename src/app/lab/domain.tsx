// Dev route /lab/domain — web test bench for src/domain. The bench (src/domain/lab/bench.ts) re-runs the
// key unit-test facts inside the Metro bundle; this page shows them and exposes globalThis.__domainLab for
// the headless-Chrome driver. Uses committed test fixtures (real API payloads): dev only, not the app.
import { useEffect, useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { FONTS } from '../../core/fonts'
import { runDomainLab, type DomainLabResult } from '../../domain/lab/bench'

const INK = '#16222E'
const PAGE = '#FBF8F0'
const DARK_PAGE = '#17212B'
const MALACHITE = '#1D6B57'
const RUBRIC = '#A8382C'
const GOLD = '#C29A3E'

type LabWindow = typeof globalThis & { __domainLab?: { done: boolean; result: DomainLabResult | null; error: string | null } }

export default function DomainLab() {
  const { result, error } = useMemo(() => {
    try {
      return { result: runDomainLab(), error: null }
    } catch (e) {
      return { result: null, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
    }
  }, [])

  useEffect(() => {
    ;(globalThis as LabWindow).__domainLab = { done: true, result, error }
  }, [result, error])

  if (!result) {
    return (
      <View style={styles.page}>
        <Text style={[styles.h1, { color: RUBRIC }]}>domain lab failed</Text>
        <Text style={styles.mono}>{error}</Text>
      </View>
    )
  }
  const passed = result.checks.filter((c) => c.ok).length
  const total = result.timeline.durationMs

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Text style={styles.h1}>domain lab</Text>
      <Text testID="lab-status" style={[styles.status, { color: passed === result.checks.length ? MALACHITE : RUBRIC }]}>
        {passed}/{result.checks.length} checks passed
      </Text>

      <Text style={styles.h2}>Checks (run in this bundle)</Text>
      {result.checks.map((c) => (
        <View key={c.name} style={styles.row}>
          <Text style={[styles.badge, { color: c.ok ? MALACHITE : RUBRIC }]}>{c.ok ? '✓' : '✗'}</Text>
          <View style={styles.flex}>
            <Text style={styles.text}>{c.name}</Text>
            {!c.ok && <Text style={styles.mono}>{c.detail}</Text>}
          </View>
        </View>
      ))}

      <Text style={styles.h2}>Selection labels and warnings (QPC display text, Tanzil marks)</Text>
      {result.labels.map((l) => (
        <View key={l.selection} style={styles.item}>
          <View style={styles.row}>
            <Text style={styles.arabic}>{l.ar}</Text>
            <Text style={styles.text}>{l.en}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.mono}>{l.selection}</Text>
            {l.warnings.map((w) => {
              const tone = w.severity === 'warning' ? RUBRIC : MALACHITE
              return (
                <Text key={`${w.kind}-${w.detail}`} style={[styles.chip, { color: tone, borderColor: tone }]}>
                  {w.severity} · {w.kind} · {w.detail}
                </Text>
              )
            })}
          </View>
        </View>
      ))}

      <Text style={styles.h2}>Share links</Text>
      {result.links.map((l) => (
        <View key={l.query} style={styles.row}>
          <Text style={[styles.badge, { color: l.roundTrip ? MALACHITE : RUBRIC }]}>{l.roundTrip ? '✓' : '✗'}</Text>
          <Text style={[styles.mono, styles.flex]}>{wrapQuery(l.query)}</Text>
        </View>
      ))}

      <Text style={styles.h2}>Timeline: QDC Alafasy 1:2 w2 → 1:4 w2 (one merged clip)</Text>
      <View style={styles.bar}>
        {result.timeline.ayahs.map((a, i) => (
          <View
            key={`${a.ayah}-${a.startMs}`}
            style={[styles.ayahSpan, { width: `${((a.endMs - a.startMs) / total) * 100}%`, backgroundColor: i % 2 ? '#E7DFC9' : '#F3ECDA' }]}
          >
            <Text style={styles.small}>{a.ayah}</Text>
          </View>
        ))}
      </View>
      <View style={styles.bar}>
        {result.timeline.words.map((w) => (
          <View
            key={`${w.ayah}:${w.word}`}
            style={[styles.wordSpan, { start: `${(w.startMs / total) * 100}%`, width: `${((w.endMs - w.startMs) / total) * 100}%` }]}
          />
        ))}
      </View>
      <Text style={styles.small}>
        {toSeconds(total)} · {result.timeline.words.length} words · clip {result.plan.clips[0]?.srcStartMs}–{result.plan.clips[0]?.srcEndMs} ms ·
        estimate {result.estimateMs === null ? 'unknown' : toSeconds(result.estimateMs)} of {toSeconds(result.maxVideoMs)} max
      </Text>

      <Text style={styles.h2}>{"Isti'adha, basmala, 112:1 (Alafasy): clips in play order"}</Text>
      {result.preamble.map((c) => (
        <View key={`${c.ayah}-${c.file}`} style={styles.row}>
          <Text style={[styles.badge, { color: GOLD }]}>{c.ayah}</Text>
          <Text style={[styles.mono, styles.flex]}>
            {c.file} · {c.window}
            {c.trimSilence ? ' · trimSilence' : ''}
          </Text>
        </View>
      ))}

      <Text style={styles.h2}>Tajweed rules (KFGQPC V4 colours, light | dark; explanations in the UI font)</Text>
      {result.rules.map((r) => {
        const sample = r.examples.length ? r.examples.slice(0, 2).join('، ') : r.nameAr
        return (
          <View key={r.id} style={styles.item}>
            <View style={styles.row}>
              <Text style={styles.arabic}>{r.nameAr}</Text>
              <Text style={styles.text}>{r.nameEn}</Text>
              <Text style={styles.mono}>
                {r.id} · {r.group}
              </Text>
            </View>
            <Text style={styles.explanation}>{r.explanationAr}</Text>
            <Text style={styles.explanationEn}>{r.explanationEn}</Text>
            <Text style={[styles.cite, { color: GOLD }]}>{r.citeAr}</Text>
            <View style={styles.swatchPair}>
              <View style={[styles.swatchCell, { backgroundColor: PAGE }]}>
                <View style={[styles.swatch, { backgroundColor: r.color }]} />
                <Text style={[styles.quran, { color: r.color }]}>{sample}</Text>
              </View>
              <View style={[styles.swatchCell, { backgroundColor: DARK_PAGE }]}>
                <View style={[styles.swatch, { backgroundColor: r.colorDark }]} />
                <Text style={[styles.quran, { color: r.colorDark }]}>{sample}</Text>
              </View>
            </View>
          </View>
        )
      })}
    </ScrollView>
  )
}

const toSeconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`
/** A zero-width space after each '&' lets a long share query wrap between parameters (display only). */
const wrapQuery = (query: string) => query.replace(/&/g, '&\u200B')

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F2F4F3' },
  page: { padding: 16, gap: 8, maxWidth: 960, width: '100%', alignSelf: 'center' },
  flex: { flex: 1, minWidth: 0 },
  h1: { fontFamily: FONTS.uiSemiBold, fontSize: 22, color: INK },
  h2: { fontFamily: FONTS.uiMedium, fontSize: 16, color: INK, marginTop: 16 },
  status: { fontFamily: FONTS.uiMedium, fontSize: 15 },
  text: { fontFamily: FONTS.ui, fontSize: 14, color: INK },
  small: { fontFamily: FONTS.ui, fontSize: 11, color: INK },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#3B4A57', flexShrink: 1 },
  arabic: { fontFamily: FONTS.ui, fontSize: 16, color: INK, writingDirection: 'rtl' },
  explanation: { fontFamily: FONTS.ui, fontSize: 15, lineHeight: 26, color: INK, writingDirection: 'rtl', textAlign: 'right' },
  // the explanations quote fully vowelled words: stacks such as «لَٰٓ» need ~1.7× line height or they reach the line above
  explanationEn: { fontFamily: FONTS.ui, fontSize: 14, lineHeight: 24, color: INK },
  cite: { fontFamily: FONTS.uiMedium, fontSize: 12, writingDirection: 'rtl', textAlign: 'right' },
  quran: { fontFamily: FONTS.quran, fontSize: 22, writingDirection: 'rtl', flexShrink: 1 },
  badge: { fontFamily: FONTS.uiSemiBold, fontSize: 16, width: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { fontFamily: FONTS.ui, fontSize: 11, color: RUBRIC, borderColor: RUBRIC, borderWidth: 1, borderRadius: 10, paddingHorizontal: 6 },
  bar: { flexDirection: 'row', height: 22, backgroundColor: PAGE, borderRadius: 4, overflow: 'hidden', position: 'relative' },
  ayahSpan: { height: 22, alignItems: 'center', justifyContent: 'center', borderEndWidth: 1, borderColor: GOLD },
  wordSpan: { position: 'absolute', top: 4, height: 14, backgroundColor: GOLD, borderRadius: 3, borderEndWidth: 1, borderColor: PAGE },
  item: { gap: 4, paddingVertical: 2 },
  swatchPair: { flexDirection: 'row', gap: 8 },
  swatchCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  swatch: { width: 14, height: 14, borderRadius: 7 },
})

