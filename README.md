# بلّغ · Balligh

> «بلّغوا عني ولو آية» — share any passage of the Quran, down to a single word, as a recitation video or an
> image.

Live at **https://sharequran.app/**

Pick a passage (whole ayahs, or from any word to any word), a reciter and a design. Balligh cuts the recitation to
exactly those words, highlights each word as it is recited, and exports an MP4 or PNG for WhatsApp, Instagram,
TikTok and the rest. Everything is built in the browser on the user's own device, and nothing is uploaded.

- **Word-exact cuts** with a pause-mark guard: the app warns when a cut changes the meaning (e.g. 4:43, 107:4).
- **28 reciters**: 15 with word timings (word highlighting), the rest timed by the ayah.
- **Tajweed colours** with a legend of the rules in the selection, tafsir (Al-Mukhtasar, Al-Muyassar, Al-Jalalayn,
  Sa'di, …) and 29 translations in 23 languages.
- **Quran text drawn with HarfBuzz** glyph outlines in Amiri Quran, so tajweed colouring never breaks cursive
  joining or misplaces marks, and the output is identical in every browser.
- **Video encoded on the device** with WebCodecs and [Mediabunny](https://mediabunny.dev): H.264 + AAC, with a
  WASM AAC encoder where the browser has none.

## Run it

Requires Node 24.

```bash
npm install
npx expo start --port 8081      # web at http://localhost:8081
```

Checks:

```bash
npm run typecheck
npx expo lint
npm test
```

Expo SDK 58, React Native with the web as the first target, Expo Router (`src/app/`). Native builds are not
finished yet (see `PLAN.md`).

### About the tests

Many tests run against captured responses from the Quran APIs the app uses. The providers' terms do not allow
republishing that data, so **this repository carries none of it**. The tests that need it, and one dev-only lab
route, are skipped automatically: `scripts/fixture-gate.cjs` lists them, and typecheck, vitest and Metro leave them
out. Everything that runs without captured data still runs here.

## Where the content comes from

Nothing below is stored in this repository. The app fetches it at run time from each provider's public API or CDN,
and credits it in every export and share text.

| Content | Source |
|---|---|
| Quran text, words, tajweed, word timings, translations, tafsir | [Quran Foundation](https://quran.foundation) (api.quran.com, verses.quran.com, quranicaudio.com) under its Developer Terms |
| Recitations (per ayah) | [EveryAyah](https://everyayah.com), Quran Foundation audio hosts |
| Recitations (chapters) and ayah timings | [mp3quran.net](https://mp3quran.net) |
| Word timings for several reciters | [quran-align](https://github.com/cpfair/quran-align) (CC BY 4.0) |
| Tafsir and translations | [QuranEnc](https://quranenc.com), [Quranpedia](https://quranpedia.net), [spa5k/tafsir_api](https://github.com/spa5k/tafsir_api), [alquran.cloud](https://alquran.cloud) (Tanzil) |
| Fonts | Amiri Quran (bundled, OFL), Readex Pro and Reem Kufi (OFL), Noto families via Fontsource (OFL) |
| Background photos (optional) | [Lorem Picsum](https://picsum.photos), or the user's own photo, which never leaves the device |

If you fork Balligh, follow each provider's terms, including Quran Foundation's rules on caching (at most one week),
credit and context.

## Repository layout

```
src/app/      routes (Expo Router)              src/render/   HarfBuzz text, scenes, frames
src/ui/       screens, sheets, stores            src/media/    audio assembly, video/image export, share
src/domain/   pure logic: selection, waqf guard, src/data/     API clients, reciter catalogue, caches
              tajweed, timeline, share links     server/       publishing server (work in progress, see PLAN.md M8)
```

`PLAN.md` holds the product, the decisions and the evidence behind them, and the architecture. The research notes it
cites (`research/*.md`) are kept private because they quote raw third-party data.

## Licence

Balligh is free software under the **GNU Affero General Public License v3.0 only** (`LICENSE`). You may use, change
and share it. If you run a modified version as a website or service, you must offer its users the source code.

Third-party code and fonts keep their own licences. See `THIRD_PARTY.md`.

Copyright © 2026 astromar96 and the Balligh contributors.
