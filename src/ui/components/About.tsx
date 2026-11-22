// «عن بلّغ والمصادر»: what is made where (on the device), then every source and licence the clips rely on,
// grouped the way the app uses them. Names open the source's own site; type and hairlines carry the hierarchy.
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import * as data from '../../data'
import { aboutGroups, type SourceItem } from '../about'
import { useT } from '../hooks'
import { uiPlatform } from '../platform'
import { useTheme } from '../theme'
import { SPACE, TYPE } from '../tokens'
import { Hairline, Sheet } from './primitives'

export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const th = useTheme()
  const { t, lang } = useT()
  const groups = useMemo(() => aboutGroups(lang, data.RECITERS, data.TAFSIRS), [lang])
  return (
    <Sheet visible={visible} onClose={onClose} title={t('about')} testID="about-sheet" closeLabel={t('close')}>
      <View style={styles.lead}>
        <Text style={[TYPE.title, { color: th.text }]}>{t('aboutLead')}</Text>
        <Text style={[TYPE.body, { color: th.textMuted }]}>{t('aboutIntro')}</Text>
        <Text style={[TYPE.small, { color: th.textMuted }]}>{t('aboutQfTerms')}</Text>
      </View>
      {groups.map((g) => (
        <View key={g.title} style={styles.group} testID={`about-${g.title}`}>
          <Hairline />
          <Text style={[TYPE.subsection, { color: th.text }]} accessibilityRole="header">
            {t(g.title)}
          </Text>
          {g.note ? <Text style={[TYPE.small, { color: th.textMuted }]}>{g.note}</Text> : null}
          <View style={styles.items}>
            {g.items.map((it) => (
              <SourceRow key={it.name} item={it} />
            ))}
          </View>
        </View>
      ))}
      <Text style={[TYPE.caption, styles.hadith, { color: th.textFaint }]}>{`«${t('hadith')}» — ${t('hadithSource')}`}</Text>
    </Sheet>
  )
}

function SourceRow({ item }: { item: SourceItem }) {
  const th = useTheme()
  const { t } = useT()
  return (
    <View style={styles.item}>
      {item.url ? (
        <Text
          {...uiPlatform.linkProps(item.url)}
          accessibilityLabel={t('aboutOpen', { name: item.name })}
          style={[TYPE.bodyMedium, styles.startAligned, { color: th.link }]}
        >
          {item.name}
        </Text>
      ) : (
        <Text style={[TYPE.bodyMedium, styles.startAligned, { color: th.text }]}>{item.name}</Text>
      )}
      <Text style={[TYPE.small, { color: th.textMuted }]}>{item.role}</Text>
      {item.licence ? (
        item.licenceUrl ? (
          <Text {...uiPlatform.linkProps(item.licenceUrl)} style={[TYPE.caption, styles.startAligned, { color: th.textFaint, textDecorationLine: 'underline' }]}>
            {item.licence}
          </Text>
        ) : (
          <Text style={[TYPE.caption, styles.startAligned, { color: th.textFaint }]}>{item.licence}</Text>
        )
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  lead: { gap: SPACE.sm, paddingBottom: SPACE.lg },
  group: { gap: SPACE.sm, paddingBottom: SPACE.lg },
  items: { gap: SPACE.md, marginTop: SPACE.xs },
  item: { gap: 2 },
  // a Latin name or licence in the Arabic sheet sits on the reading side like the Arabic lines, not at the far edge
  startAligned: { alignSelf: 'flex-start' },
  hadith: { paddingTop: SPACE.sm, paddingBottom: SPACE.md },
})
