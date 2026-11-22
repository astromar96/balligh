import { SURAH_LIST } from './__fixtures__/load'
import { filterSurahs, textQuery } from './search'

const numbers = (q: string) => filterSurahs(SURAH_LIST, q).map((s) => s.number)

describe('filterSurahs', () => {
  it('returns everything for an empty query', () => {
    expect(numbers('  ')).toEqual(SURAH_LIST.map((s) => s.number))
  })

  it('finds a surah by number in any digit set, prefix included', () => {
    expect(numbers('112')).toEqual([112])
    expect(numbers('١١٢')).toEqual([112])
    expect(numbers('2')).toEqual([2, 20, 21])
  })

  it('finds Arabic names without harakat, the article or «سورة»', () => {
    expect(numbers('البقرة')).toEqual([2])
    expect(numbers('بقرة')).toEqual([2])
    expect(numbers('سورة البقره')).toEqual([2])
    expect(numbers('الانبياء')).toEqual([21])
    expect(numbers('عمران')).toEqual([3])
  })

  it('finds English names with or without the article and punctuation', () => {
    expect(numbers('al baqara')).toEqual([2])
    expect(numbers('Baqarah')).toEqual([2])
    expect(numbers('cow')).toEqual([2])
    expect(numbers('surah ikhlas')).toEqual([112])
  })

  it('returns nothing for a name that is not there', () => {
    expect(numbers('zzz')).toEqual([])
  })
})

describe('textQuery', () => {
  it('searches the text from three letters, never for a number', () => {
    expect(textQuery(' ال ')).toBeNull()
    expect(textQuery('الصلاة ')).toBe('الصلاة')
    expect(textQuery('١١٢')).toBeNull()
    expect(textQuery('255')).toBeNull()
    expect(textQuery('2:255')).toBe('2:255')
  })
})
