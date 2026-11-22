// Content toggles: tafsir (source picker + full reader), tajweed rules in the selection, translation.
// Short tafsirs are marked «مناسب للمشاركة», long ones «مطوّل — للقراءة», fiqh works «الأحكام الفقهية».
// A partial ayah shows its whole ayah's tafsir/translation, labelled as such (research/features.md §2.7).
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import * as data from '../../data'
import { translationFontFamily } from '../../render'
import { findTafsir, findTranslation, useCompose } from '../compose'
import { useT } from '../hooks'
import type { MessageKey } from '../i18n'
import { describeError } from '../safe'
import { uiPlatform } from '../platform'
import { filterTranslations, readerItems, tafsirGroup, type TafsirGroup } from '../reading'
import { useAppStore } from '../store'
import { useTheme } from '../theme'
import { FAMILY, RADIUS, SPACE, TOUCH, TYPE } from '../tokens'
import { Icon } from './Icon'
import { Button, Hairline, InlineError, Muted, SearchField, SectionTitle, Sheet, SkeletonLine, ToggleRow } from './primitives'

const GROUP_LABEL: Record<TafsirGroup, MessageKey> = { short: 'tafsirShort', long: 'tafsirLong', ahkam: 'tafsirAhkam' }

/** `hideTitle`: the step flow shows its own step heading above the section. */
export function ContentSection({ hideTitle = false }: { hideTitle?: boolean }) {
  const th = useTheme()
  const { t } = useT()
  const [tafsirPicker, setTafsirPicker] = useState(false)
  const [reader, setReader] = useState(false)
  const [translationPicker, setTranslationPicker] = useState(false)
  return (
    <View style={styles.section}>
      {hideTitle ? null : <SectionTitle>{t('content')}</SectionTitle>}
      <TafsirBlock onPick={() => setTafsirPicker(true)} onRead={() => setReader(true)} />
      <Hairline />
      <TajweedBlock />
      <Hairline />
      <TranslationBlock onPick={() => setTranslationPicker(true)} />
      <TafsirPicker visible={tafsirPicker} onClose={() => setTafsirPicker(false)} />
      <TafsirReader visible={reader} onClose={() => setReader(false)} />
      <TranslationPicker visible={translationPicker} onClose={() => setTranslationPicker(false)} />
      <View style={{ height: 1, backgroundColor: th.bg }} />
    </View>
  )
}

function SubTitle({ children }: { children: string }) {
  const th = useTheme()
  return (
    <Text style={[TYPE.subsection, { color: th.textMuted }]} accessibilityRole="header">
      {children}
    </Text>
  )
}

/** A row that shows the chosen source and opens its picker. */
function SourceButton({ title, note, onPress, testID }: { title: string; note?: string; onPress: () => void; testID?: string }) {
  const th = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.source, { borderColor: th.hairline, backgroundColor: pressed ? th.bg : th.surface }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[TYPE.bodyMedium, { color: th.text }]} numberOfLines={1}>
          {title}
        </Text>
        {note ? <Muted numberOfLines={2}>{note}</Muted> : null}
      </View>
      <Icon name="chevronDown" size={18} color={th.textMuted} />
    </Pressable>
  )
}

// ───────────────────────── tafsir ─────────────────────────

function TafsirBlock({ onPick, onRead }: { onPick: () => void; onRead: () => void }) {
  const th = useTheme()
  const { t, lang } = useT()
  const tafsirId = useAppStore((s) => s.tafsirId)
  const lastId = useAppStore((s) => s.lastTafsirId)
  const setTafsir = useAppStore((s) => s.setTafsir)
  const slot = useCompose((s) => s.tafsir)
  const partial = useCompose((s) => !!s.model && (s.model.partialStart || s.model.partialEnd))
  const retry = useCompose((s) => s.retryContent)
  const source = findTafsir(tafsirId ?? lastId)
  const on = tafsirId !== null

  return (
    <View style={{ gap: SPACE.sm }}>
      <SubTitle>{t('tafsir')}</SubTitle>
      <ToggleRow label={t('addTafsir')} value={on} onChange={(v) => setTafsir(v ? lastId : null)} testID="tafsir-toggle" />
      {on ? (
        <View style={{ gap: SPACE.sm }}>
          <SourceButton
            testID="tafsir-source"
            title={source ? (lang === 'ar' ? source.nameAr : source.nameEn) : (tafsirId ?? '')}
            note={source ? `${t(GROUP_LABEL[tafsirGroup(source)])}. ${source.noteAr}` : undefined}
            onPress={onPick}
          />
          {partial ? <Muted>{t('tafsirWholeAyah')}</Muted> : null}
          {slot.status === 'loading' ? (
            <View style={{ gap: SPACE.sm }}>
              <SkeletonLine width="100%" />
              <SkeletonLine width="86%" />
            </View>
          ) : slot.status === 'error' ? (
            <InlineError message={describeError(lang, 'whatTafsir', slot.error)} actionLabel={t('retry')} onAction={retry} testID="tafsir-error" />
          ) : slot.status === 'ready' && slot.value ? (
            slot.value.entries.length === 0 ? (
              <Muted>{t('tafsirNoEntry')}</Muted>
            ) : (
              <View style={{ gap: SPACE.sm }}>
                <Text style={[TYPE.small, { color: th.text, fontFamily: uiPlatform.withQuranFallback(FAMILY.ui) }]} numberOfLines={4} testID="tafsir-excerpt">
                  {slot.value.entries[0].text}
                </Text>
                {/* the provider that actually served the text, with its edition (licence terms) */}
                <Text style={[TYPE.caption, { color: th.textFaint }]} testID="tafsir-credit">
                  {t('tafsirSource', { credit: slot.value.creditAr })}
                </Text>
                <Button compact variant="secondary" label={t('readTafsir')} onPress={onRead} testID="tafsir-read" style={{ alignSelf: 'flex-start' }} />
              </View>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function TafsirPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const th = useTheme()
  const { t, lang } = useT()
  const list = data.TAFSIRS
  const current = useAppStore((s) => s.tafsirId)
  const setTafsir = useAppStore((s) => s.setTafsir)
  const groups: TafsirGroup[] = ['short', 'long', 'ahkam']
  return (
    <Sheet visible={visible} onClose={onClose} title={t('tafsir')} testID="tafsir-picker" closeLabel={t('close')}>
      <Muted style={{ marginBottom: SPACE.lg }}>{t('tafsirUncut')}</Muted>
      {groups.map((g) => {
        const items = list.filter((s) => tafsirGroup(s) === g)
        if (items.length === 0) return null
        return (
          <View key={g} style={{ gap: SPACE.xs, marginBottom: SPACE.lg }}>
            <Text style={[TYPE.label, { color: th.textMuted }]} accessibilityRole="header">
              {t(GROUP_LABEL[g])}
            </Text>
            {items.map((s) => {
              const selected = s.id === current
              const choose = () => {
                setTafsir(s.id)
                onClose()
              }
              return (
                <Pressable
                  key={s.id}
                  testID={`tafsir-${s.id}`}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  onPress={choose}
                  {...uiPlatform.spaceToPress(choose)}
                  style={({ pressed }) => [styles.option, { borderColor: selected ? th.text : th.hairline }, pressed && { backgroundColor: th.primaryTint }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[TYPE.bodyMedium, { color: th.text }]}>{lang === 'ar' ? s.nameAr : s.nameEn}</Text>
                    <Muted>{s.noteAr}</Muted>
                  </View>
                  {selected ? <Icon name="check" size={18} color={th.text} /> : null}
                </Pressable>
              )
            })}
          </View>
        )
      })}
    </Sheet>
  )
}

function TafsirReader({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const th = useTheme()
  const { t, n, lang } = useT()
  const tafsirId = useAppStore((s) => s.tafsirId)
  const slot = useCompose((s) => s.tafsir)
  const source = findTafsir(tafsirId)
  const items = useMemo(
    () =>
      slot.value
        ? readerItems(
            slot.value.entries,
            (e) => (e.ayahFrom === e.ayahTo ? `${lang === 'ar' ? 'الآية' : 'Verse'} ${n(e.ayahFrom)}` : `${lang === 'ar' ? 'الآيات' : 'Verses'} ${n(e.ayahFrom)}–${n(e.ayahTo)}`),
            t('tafsirSource', { credit: slot.value.creditAr || source?.creditAr || '' }),
          )
        : [],
    [slot.value, source, lang, n, t],
  )
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={source ? (lang === 'ar' ? source.nameAr : source.nameEn) : t('tafsir')}
      scroll={false}
      testID="tafsir-reader"
      closeLabel={t('close')}
    >
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xl, gap: SPACE.md }}
        initialNumToRender={12}
        renderItem={({ item }) =>
          item.kind === 'heading' ? (
            <Text style={[TYPE.title, { color: th.text, marginTop: SPACE.sm }]} accessibilityRole="header">
              {item.text}
            </Text>
          ) : item.kind === 'credit' ? (
            <Muted style={{ marginTop: SPACE.md }}>{item.text}</Muted>
          ) : (
            <Text style={[styles.readerPara, { color: th.text }]} selectable>
              {item.text}
            </Text>
          )
        }
      />
    </Sheet>
  )
}

// ───────────────────────── tajweed ─────────────────────────

function TajweedBlock() {
  const th = useTheme()
  const { t, lang } = useT()
  const design = useAppStore((s) => s.design)
  const setDesign = useAppStore((s) => s.setDesign)
  const rules = useCompose((s) => s.rules)
  const shown = rules.filter((r) => !r.rule.fallback)
  return (
    <View style={{ gap: SPACE.sm }} testID="tajweed-block">
      <SubTitle>{t('tajweed')}</SubTitle>
      <ToggleRow label={t('showTajweed')} value={design.showTajweed} onChange={(v) => setDesign({ showTajweed: v, showRulesLegend: v ? design.showRulesLegend : false })} testID="tajweed-toggle" />
      {design.showTajweed ? (
        <ToggleRow label={t('showRulesLegend')} value={design.showRulesLegend} onChange={(v) => setDesign({ showRulesLegend: v })} testID="legend-toggle" />
      ) : null}
      {shown.length === 0 ? (
        <Muted>{t('noRules')}</Muted>
      ) : !design.showTajweed ? (
        // colouring off: only which rules occur, as a quiet key; the explanations come with the colours
        <View style={styles.ruleKey} testID="rule-key" accessibilityLabel={t('rulesInPassage')}>
          {shown.map(({ rule }) => (
            <View key={rule.id} style={styles.ruleKeyItem}>
              <View style={[styles.swatchSmall, { backgroundColor: th.dark ? (rule.colorDark ?? rule.color) : rule.color }]} />
              <Text style={[TYPE.caption, { color: th.textMuted }]}>{lang === 'ar' ? rule.nameAr : rule.nameEn}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: SPACE.md, marginTop: SPACE.xs }}>
          {shown.map(({ rule, examples }) => {
            const color = th.dark ? (rule.colorDark ?? rule.color) : rule.color
            return (
              <View key={rule.id} style={styles.rule} testID={`rule-${rule.id}`}>
                <View style={[styles.swatch, { backgroundColor: color }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.ruleHead}>
                    <Text style={[TYPE.label, { color: th.text }]}>{lang === 'ar' ? rule.nameAr : rule.nameEn}</Text>
                    {examples.length > 0 ? (
                      <Text {...uiPlatform.quranProps} style={[styles.examples, { color }]} numberOfLines={1}>
                        {examples.join('   ')}
                      </Text>
                    ) : null}
                  </View>
                  {/* vowelled examples need ≥ 1.7× leading or their marks collide (styles.explanation) */}
                  <Text {...uiPlatform.dirProps(lang === 'ar' ? 'rtl' : 'ltr')} style={[styles.explanation, { color: th.textMuted }]}>
                    {lang === 'ar' ? rule.explanationAr : rule.explanationEn}
                  </Text>
                  {rule.citeAr ? (
                    <Text style={[styles.cite, { color: th.textFaint }]} testID={`rule-cite-${rule.id}`}>
                      {t('ruleReference', { cite: rule.citeAr })}
                    </Text>
                  ) : null}
                </View>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

// ───────────────────────── translation ─────────────────────────

function TranslationBlock({ onPick }: { onPick: () => void }) {
  const th = useTheme()
  const { t, lang } = useT()
  const translationId = useAppStore((s) => s.translationId)
  const lastId = useAppStore((s) => s.lastTranslationId)
  const setTranslation = useAppStore((s) => s.setTranslation)
  const slot = useCompose((s) => s.translation)
  const partial = useCompose((s) => !!s.model && (s.model.partialStart || s.model.partialEnd))
  const retry = useCompose((s) => s.retryContent)
  const on = translationId !== null
  const source = findTranslation(translationId ?? lastId)
  return (
    <View style={{ gap: SPACE.sm }}>
      <SubTitle>{t('translation')}</SubTitle>
      <ToggleRow label={t('addTranslation')} value={on} onChange={(v) => setTranslation(v ? lastId : null)} testID="translation-toggle" />
      {on ? (
        <View style={{ gap: SPACE.sm }}>
          <SourceButton
            testID="translation-source"
            title={source ? `${source.langName}: ${source.name}` : t('chooseTranslation')}
            onPress={onPick}
          />
          {partial ? <Muted>{t('translationWholeAyah')}</Muted> : null}
          {slot.status === 'loading' ? (
            <SkeletonLine width="90%" />
          ) : slot.status === 'error' ? (
            <InlineError message={describeError(lang, 'whatTranslation', slot.error)} actionLabel={t('retry')} onAction={retry} testID="translation-error" />
          ) : slot.status === 'ready' && slot.value && slot.value.length > 0 ? (
            <Text
              {...(source ? uiPlatform.dirProps(source.dir) : {})}
              style={[TYPE.small, { color: th.text, writingDirection: source?.dir ?? 'ltr', fontFamily: translationFamily(source?.script) }]}
              numberOfLines={4}
              testID="translation-excerpt"
            >
              {slot.value.map((e) => e.text).join(' ')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function TranslationPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const th = useTheme()
  const { t } = useT()
  const list = data.TRANSLATIONS
  const current = useAppStore((s) => s.translationId)
  const setTranslation = useAppStore((s) => s.setTranslation)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterTranslations(list, query), [list, query])
  return (
    <Sheet visible={visible} onClose={onClose} title={t('chooseTranslation')} scroll={false} tall testID="translation-picker" closeLabel={t('close')}>
      <View style={{ paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm }}>
        <SearchField value={query} onChangeText={setQuery} placeholder={t('searchTranslations')} testID="translation-search" />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(s) => String(s.id)}
        style={{ flexGrow: 0 }}
        initialNumToRender={20}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Muted style={{ padding: SPACE.lg }}>{t('noResults')}</Muted>}
        renderItem={({ item }) => {
          const selected = item.id === current
          const choose = () => {
            setTranslation(item.id)
            onClose()
          }
          return (
            <Pressable
              testID={`translation-${item.id}`}
              accessibilityRole="radio"
              aria-checked={selected}
              onPress={choose}
              {...uiPlatform.spaceToPress(choose)}
              style={({ pressed }) => [styles.tRow, pressed && { backgroundColor: th.primaryTint }, selected && { backgroundColor: th.bg }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[TYPE.bodyMedium, { color: th.text }]}>{item.name}</Text>
                <Muted>{item.langName}</Muted>
              </View>
              {selected ? <Icon name="check" size={18} color={th.text} /> : null}
            </Pressable>
          )
        }}
      />
    </Sheet>
  )
}

/** The Noto family of the translation's script (loaded by compose before the text shows), then the UI font. */
function translationFamily(script: string | undefined): string {
  const noto = translationFontFamily(script)
  return noto ? uiPlatform.fontStack(noto, FAMILY.ui) : FAMILY.ui
}

const styles = StyleSheet.create({
  section: { gap: SPACE.md },
  source: { borderWidth: 1, borderRadius: RADIUS.control, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: TOUCH + 8 },
  option: { borderWidth: 1, borderRadius: RADIUS.control, padding: SPACE.md, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  readerPara: { fontFamily: uiPlatform.withQuranFallback(FAMILY.ui), fontSize: 16.5, lineHeight: 30 },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm + 2 },
  ruleHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: SPACE.md },
  swatch: { width: 12, height: 12, borderRadius: 6, marginTop: 6 },
  swatchSmall: { width: 8, height: 8, borderRadius: 4 },
  ruleKey: { flexDirection: 'row', flexWrap: 'wrap', columnGap: SPACE.md, rowGap: SPACE.xs },
  ruleKeyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  examples: { fontFamily: FAMILY.quran, fontSize: 19, lineHeight: 36, writingDirection: 'rtl', flexShrink: 1 },
  explanation: { fontFamily: uiPlatform.withQuranFallback(FAMILY.ui), fontSize: 13, lineHeight: 23 },
  cite: { fontFamily: FAMILY.ui, fontSize: 12, lineHeight: 20 },
  tRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm, minHeight: 56 },
})
