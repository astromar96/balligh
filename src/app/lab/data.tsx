// Dev route /lab/data — live web bench for src/data. Runs every public data function against the real services
// from the browser (CORS, Cache Storage and its purge, abort, provider chains) and shows the results; ?full=1 adds
// the whole-Quran audit (QPC display, both pause-mark systems). Exposes globalThis.__dataLab for the headless-Chrome
// driver. Dev only, not the app.
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { FONTS } from '../../core/fonts'
import { runDataLab, type DataLabResult } from '../../data/lab/bench'

const INK = '#16222E'
const PAGE = '#FBF8F0'
const MALACHITE = '#1D6B57'
const RUBRIC = '#A8382C'
const MUTED = '#3B4A57'

/** Approximate rule colours, only to see that runs land on the right letters. */
const RULE_COLOR: Readonly<Record<string, string>> = {
  ham_wasl: '#8A8A8A',
  slnt: '#8A8A8A',
  laam_shamsiyah: '#8A8A8A',
  madda_normal: '#C1782B',
  madda_permissible: '#C1782B',
  madda_necessary: '#9E2A2B',
  madda_obligatory: '#B0413E',
  qalaqah: '#1F6FB2',
  ikhafa: '#7A3E9D',
  ikhafa_shafawi: '#7A3E9D',
  idgham_ghunnah: '#2E7D32',
  idgham_wo_ghunnah: '#2E7D32',
  idgham_shafawi: '#2E7D32',
  idgham_mutajanisayn: '#2E7D32',
  idgham_mutaqaribayn: '#2E7D32',
  iqlab: '#00838F',
  ghunnah: '#D35400',
}

type LabWindow = typeof globalThis & { __dataLab?: { done: boolean; progress: string; result: DataLabResult | null; error: string | null } }

export default function DataLab() {
  const params = useLocalSearchParams<{ full?: string }>()
  const full = params.full === '1'
  const [progress, setProgress] = useState('starting')
  const [result, setResult] = useState<DataLabResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const w = globalThis as LabWindow
    w.__dataLab = { done: false, progress: 'starting', result: null, error: null }
    let live = true
    runDataLab({ full }, (p) => {
      if (!live) return
      setProgress(p)
      if (w.__dataLab) w.__dataLab.progress = p
    }).then(
      (r) => {
        if (!live) return
        setResult(r)
        w.__dataLab = { done: true, progress: 'done', result: r, error: null }
      },
      (e: unknown) => {
        if (!live) return
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        setError(msg)
        w.__dataLab = { done: true, progress: 'failed', result: null, error: msg }
      },
    )
    return () => {
      live = false
    }
  }, [full])

  if (error) {
    return (
      <View style={styles.page}>
        <Text style={[styles.h1, { color: RUBRIC }]}>data lab failed</Text>
        <Text style={styles.mono}>{error}</Text>
      </View>
    )
  }
  if (!result) {
    return (
      <View style={styles.page}>
        <Text style={styles.h1}>data lab</Text>
        <Text testID="lab-status" style={styles.status}>
          running: {progress}…
        </Text>
      </View>
    )
  }
  const passed = result.checks.filter((c) => c.ok).length
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Text style={styles.h1}>data lab{full ? ' · full audit' : ''}</Text>
      <Text testID="lab-status" style={[styles.status, { color: passed === result.checks.length ? MALACHITE : RUBRIC }]}>
        {passed}/{result.checks.length} live checks passed
      </Text>

      <Text style={styles.h2}>Checks (live, from this browser)</Text>
      {result.checks.map((c) => (
        <View key={c.name} style={styles.row}>
          <Text style={[styles.badge, { color: c.ok ? MALACHITE : RUBRIC }]}>{c.ok ? '✓' : '✗'}</Text>
          <View style={styles.flex}>
            <Text style={styles.text}>
              {c.name} <Text style={styles.small}>{c.ms} ms</Text>
            </Text>
            <Text style={styles.mono}>{c.detail}</Text>
          </View>
        </View>
      ))}

      {result.audit && (
        <>
          <Text style={styles.h2}>Whole-Quran audit</Text>
          <Text style={styles.mono}>{JSON.stringify(result.audit)}</Text>
        </>
      )}

      <Text style={styles.h2}>Words (QPC display), printed pause marks and projected tajweed runs</Text>
      {result.samples.map((s) => (
        <View key={s.key} style={styles.sample}>
          <Text style={styles.mono}>
            {s.key} · guard (Tanzil):{' '}
            {s.words
              .map((w, i) => (w.waqf ? `w${i + 1} ${w.waqf}${w.waqfChar ? '' : ' (not printed)'}` : null))
              .filter(Boolean)
              .join(', ') || '—'}
          </Text>
          <Text style={styles.quran}>
            {s.words.map((w, i) => (
              <Text key={i}>
                {runs(w.text, w.rules)}
                {w.waqfChar ? <Text style={{ color: RUBRIC }}>{` ${w.waqfChar}`}</Text> : null}
                {i < s.words.length - 1 ? ' ' : ''}
              </Text>
            ))}
          </Text>
        </View>
      ))}

      <Text style={styles.h2}>Audio (112:1–4, basmala = ayah 0, Tunaiji ch 14)</Text>
      {result.audio.map((a, i) => (
        <Text key={i} style={styles.mono}>
          {a.reciter} [{a.cls}] {a.ayah}: {a.fileKind} {a.window} · {a.timing} · {a.words}/{a.wordCount} words · {a.url}
          {a.perAyahUrl ? ` · per-ayah fallback ${a.perAyahUrl}` : ''}
        </Text>
      ))}
      <Text style={styles.h3}>First bytes over CORS (Range: bytes=0-15)</Text>
      {result.audioBytes.map((b) => (
        <Text key={b.reciter} style={[styles.mono, { color: b.mp3 ? MALACHITE : RUBRIC }]}>
          {b.reciter}: HTTP {b.status} {b.mp3 ? 'MP3' : 'not MP3'} {b.error ?? ''}
        </Text>
      ))}

      <Text style={styles.h2}>Tafsir</Text>
      {result.tafsir.map((t) => (
        <View key={t.id} style={styles.item}>
          <Text style={styles.mono}>
            {t.id} {t.ayah} ← {t.provider} · {t.entries}
          </Text>
          <Text style={styles.arabic}>{t.head}…</Text>
          <Text style={styles.credit}>{t.credit}</Text>
        </View>
      ))}

      <Text style={styles.h2}>Translations (112:1) · declared script/dir → detected from the text</Text>
      {result.translations
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((t) => (
          <Text key={t.id} style={[styles.mono, { color: t.ok ? MUTED : RUBRIC }]}>
            {t.id} {t.lang} [{t.script} {t.dir} → {t.detected}]: {t.head}
          </Text>
        ))}

      <Text style={styles.h2}>Search</Text>
      {result.search.map((s) => (
        <Text key={s.query} style={styles.mono}>
          «{s.query}» → {s.hits} · {s.first}
        </Text>
      ))}

      <Text style={styles.h2}>Cache Storage</Text>
      <Text style={styles.mono}>{JSON.stringify(result.cache)}</Text>
    </ScrollView>
  )
}

/** Splits a word into coloured runs (display only). */
function runs(text: string, rules: { start: number; end: number; rule: string }[]) {
  const out: { t: string; c?: string }[] = []
  let pos = 0
  for (const r of rules) {
    if (r.start > pos) out.push({ t: text.slice(pos, r.start) })
    out.push({ t: text.slice(r.start, r.end), c: RULE_COLOR[r.rule] ?? GOLDISH })
    pos = r.end
  }
  if (pos < text.length) out.push({ t: text.slice(pos) })
  return out.map((p, i) => (
    <Text key={i} style={p.c ? { color: p.c } : undefined}>
      {p.t}
    </Text>
  ))
}

const GOLDISH = '#C29A3E'

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F2F4F3' },
  page: { padding: 16, gap: 6, maxWidth: 960, width: '100%', alignSelf: 'center' },
  flex: { flex: 1, minWidth: 0 },
  h1: { fontFamily: FONTS.uiSemiBold, fontSize: 22, color: INK },
  h2: { fontFamily: FONTS.uiMedium, fontSize: 16, color: INK, marginTop: 14 },
  h3: { fontFamily: FONTS.uiMedium, fontSize: 13, color: INK, marginTop: 6 },
  status: { fontFamily: FONTS.uiMedium, fontSize: 15, color: INK },
  text: { fontFamily: FONTS.ui, fontSize: 14, color: INK },
  small: { fontFamily: FONTS.ui, fontSize: 11, color: MUTED },
  mono: { fontFamily: 'monospace', fontSize: 11, color: MUTED, flexShrink: 1 },
  arabic: { fontFamily: FONTS.ui, fontSize: 14, color: INK, writingDirection: 'rtl', textAlign: 'right' },
  credit: { fontFamily: FONTS.ui, fontSize: 11, color: MUTED, writingDirection: 'rtl', textAlign: 'right' },
  quran: { fontFamily: FONTS.quran, fontSize: 26, lineHeight: 52, color: INK, writingDirection: 'rtl', textAlign: 'right' },
  badge: { fontFamily: FONTS.uiSemiBold, fontSize: 16, width: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  item: { gap: 2, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#D5D9D6' },
  sample: { backgroundColor: PAGE, borderRadius: 6, padding: 8, gap: 2 },
})
