# بلّغ · Balligh — plan

> «بلّغوا عني ولو آية» — share any passage of the Quran, down to a single word,
> as a recitation video or an image, built entirely on the user's device.

## Product (v1)

1. **Pick the passage.** Surah → ayah range, or tap a first and a last *word*
   anywhere in the surah (a selection may span ayahs). Pause marks (ۖ ۗ ۚ ۛ ۙ ۘ ۜ)
   guide the cut: "snap to pauses" is on by default and the app warns when a cut
   lands mid-phrase or on ۙ (meaning can change, e.g. 4:43, 107:4).
2. **Pick the reciter.** 28 live-verified reciters (`research/fixtures/audio-timing/reciters.json`).
   Class A (12) have exact per-word timings → word cuts + word highlighting; class B (3)
   have word timings inside chapter files (Range-sliced); class C has ayah timing only →
   selections snap to whole ayahs and the picker says so.
3. **Design.** Aspect (9:16 · 4:5 · 1:1 · 16:9), background (generated presets or
   the user's own photo, with dim/blur), text tone and size, toggles for surah
   header, ayah numbers, pause marks, reciter name, watermark.
4. **Content toggles.** Tafsir of the selected ayahs (Al-Mukhtasar default — about one
   passage per ayah, median 2 lines; Al-Muyassar; Al-Jalalayn which can be cut to the exact
   selected words; Sa'di; long ones — Ibn Kathir, Tabari, Baghawi, Al-Wasit — in the reader;
   Al-Qurtubi «الجامع لأحكام القرآن» and the Ahkam al-Quran books for fiqh rulings) · tajweed
   colours + a legend/explanation of the rules that occur in the selection («أحكام التجويد») ·
   a translation line. A partial ayah shows its whole ayah's tafsir/translation, labelled as such.
5. **Export & share.** MP4 (H.264 + AAC) with the recitation cut to the words and
   the current word highlighted, or PNG. Share via the system share sheet (Web
   Share API Level 2) or download; also a deep link that reopens the same
   selection and design (all state lives in the URL — no backend).

No backend, ever: every byte comes from public CORS-enabled APIs/CDNs and every
frame is drawn and encoded in the browser. **One exception (2026-11-22): publishing to Balligh's own
«Share Quran» pages (M8)** runs on a server, because platform tokens cannot live in a browser. A user's own
export, share and download stay on the device.

## Decisions and the evidence behind them

| Decision | Why | Evidence |
|---|---|---|
| Web app (PWA), React 19 + TS 7 + Vite 8 + Tailwind 4 + zustand | "build on the user's machine, no backend", one codebase for Android/iOS/desktop, Web Share sends files to WhatsApp/Instagram | `research/media-pipeline.md` |
| Quran data from `api.quran.com/api/v4` | public, `access-control-allow-origin: *`, words + tajweed + per-ayah audio + word segments + tafsir + translations in one API | probes 2026-11-21, `research/quran-text-api.md` |
| Canonical text = `words[].text_uthmani`; tajweed runs taken from `text_uthmani_tajweed` and **aligned** onto it | the tajweed text differs: pause marks glued with ZWNJ (`…ٱلْقَيُّومُ‌ۚ`), U+0672 where the word text has U+0670, word text has U+06ED (small low meem) the verse text lacks | `lab/` probe, see "Text gotchas" |
| Quran text drawn with **HarfBuzz (harfbuzzjs) glyph outlines**, font **Amiri Quran** (OFL) | only technique that colours tajweed runs exactly without breaking cursive joining or misplacing marks; identical output on every browser; exact word boxes for highlighting | `lab/index.html` A/B/C/D/E comparison |
| Audio = per-ayah MP3 from `https://verses.quran.com/` cut by `verse.audio.segments` | CORS `*`, small files; chapter files are huge (Abdul Basit Mujawwad surah 4 = 161 MB) | probes, `research/audio-timing.md` |
| Video = Mediabunny (MPL-2.0) on WebCodecs → MP4 H.264/AAC | proven in `lab/video.html`: 349 frames 720×1280 encoded in 3.3 s (≈3.5× real time), ffprobe-valid | lab run 2026-11-21 |
| ~~Fallback video path = MediaRecorder~~ → replaced: lazy AAC WASM encoder (see Media below) | MediaRecorder measured unreliable | `research/media-pipeline.md` §0 |
| Publish to Balligh's own pages from a **server that renders the clip itself from the share link** (M8) | the client never uploads a video, so only a genuine Balligh clip can reach the pages (a link never carries an uploaded background); instant, no human review | chat decision 2026-11-22; M8 below |

## Completeness review — wins over every other section (`research/00-gaps.md`, 2026-11-21)

`00-gaps.md` §0 lists 13 corrections that change code; §5 lists where this plan drifted. In short:
1. **Display text = `qpcToStandard(words[].text_qpc_hafs)` in Amiri Quran**, not `text_uthmani`
   (Amiri draws a stray small meem on 6,678 `text_uthmani` words). `text_uthmani` is kept only for the
   §3.7 tajweed grouping and the waqf guard. Tajweed = verse-level `text_uthmani_tajweed` → §3.7 grouping
   → projection onto the display text (00-gaps §2.1; 1 class lost in 77,429 words). Never the word-level `<rule>` field.
2. **Waqf (D1, default taken):** the boundary guard reads **Tanzil marks** (`text_uthmani`, keeps ۙ); the
   screen shows **QPC marks**. Warnings never point at a glyph («الوقف هنا ممنوع»).
3. **MP3 windowing by file kind** (00-gaps §2.7): Info-tagged CBR → `fetchMp3WindowFixed` (media N1);
   untagged CBR → raw-frame `fetchSlice` (audio-timing §7, frame-exact over 7,247 s); Xing VBR → never
   window (fall back to per-ayah files, ayah-level highlight). Chapter files always windowed, per-ayah
   files always whole; sizes from HEAD `content-length`. Priming: media-pipeline N3 policy.
4. **Class B** (Khalifa 161): validate every verse; corrupt labels → ayah-level for that verse (D8), missing words → interpolate.
5. **Basmala / isti'adha** from the per-reciter table (00-gaps §6.3), not blindly `001001.mp3`
   (Tunaiji's is Minshawi's; Ali Jaber's is isti'adha + basmala). Isti'adha recorded by someone else → disabled (D7).
6. **QF terms:** QF **audio hosts** too; cache ≤ **6 days** + purge at start-up; exports not kept in the
   app; credit QF + reciter in every export; no QF data in a public repo or the bundle (the 22 MB dump is gitignored).
7. **`per_page=50`** + `pagination.next_page` everywhere.
8. **Translations:** direction from the text; Readex Pro is Arabic + Latin only → **Noto per script** (00-gaps §6.4).
9. **Audio constants:** planner fades (8/20 in, 25/60 out — no extra fixed fade), `offset_ms` 26, `Number()` every segment value.
10. **Never truncate licensed tafsir with "…"** — page it (D6). Still image: ≤ 10 PNG pages; video: pages in sync with the audio.
11. **Long selections (D3):** estimate duration before fetching audio; warn at 60/90/180 s; hard cap video at 300 s.
12. **Highlight without word timings (D4):** ayah-level only (estimates are off by a median 598 ms); say so in the reciter picker.
13. **Ornament (D5):** ۝N only when the ayah's last word is selected, else «جزء من الآية N» in the reference line.
14. HarfBuzz cluster level 2 (CHARACTERS); Mediabunny always writes an audio `elst` (accepted); PWA = Workbox over `npx expo export -p web`.

Defaults taken for Omar's open decisions D1–D10 are the review's recommendations (00-gaps §3); D2 keeps Amiri.

## Research outcomes that override anything above (2026-11-21)

Read the doc section named before implementing the matching piece. Each was verified live and
most were re-checked by an independent skeptic (see each doc's "Independent verification").

**Text & tajweed** (`research/quran-text-api.md`, `research/fonts-rendering.md`)
- `api.quran.com/api/v4` is QF's "older unauthenticated API": no sunset date, but the new QF API is
  backend-only, so this host is the only client-side source. Hide it behind a `QuranDataSource`
  interface; fallback for text + tajweed is `api.alquran.cloud` (same tajweed text in 6,235/6,236 verses).
- QF Developer Terms: cache QF content ≤ 7 days, do **not** bundle QF data in the app, credit
  "Quran.com / Quran Foundation" and the reciter in every exported image/video.
- `per_page` up to 286 works (no cap of 50); `by_range` does not exist.
- **Never draw a tajweed string.** It encodes sukun and the silent-letter circle with the same code
  point. Project its rule classes onto the display text with the word-range alignment of
  quran-text-api §3.7 (validated 6,236/6,236 verses, confirmed by an independent diff-based aligner).
- Display text = `words[].text_uthmani` drawn with **Amiri Quran** (OFL; `text_uthmani` is the encoding
  OFL fonts expect). The KFGQPC Hafs font + `text_qpc_hafs` (Madani-Mushaf look) is a later option
  pending a licence decision (fonts-rendering §0.8).
- Ayah number token = U+06DD + Arabic-Indic digits, **shaped as an LTR run** (RTL shaping reverses the digits).
- 216 token merges exist (۞ U+06DE inside the first word of 199 quarter starts, ۩ sajdah sign in 15
  words, 8:6, 37:130) — the alignment handles them; the code must not assume token == word blindly.
- Search is client-side over the bulk `text_imlaei_simple` (+ `text_uthmani_simple`) with the
  normaliser of quran-text-api §4.3; server `/search` is poor for phrases and 204s for `language=ar`.

**Audio & timing** (`research/audio-timing.md`, reference planner `research/scripts/audio-timing/cut-planner.ts`)
- Segments for a whole surah in one request: `GET /api/v4/recitations/{id}/by_chapter/{surah}?fields=segments&per_page=all`.
  Segment = `[wordStart0, wordEndExclusive, startMs, endMs]`, ms relative to the per-ayah file.
- The v4 segments are the cpfair/quran-align data (CC BY 4.0) computed on EveryAyah files; 11 of
  the 12 v4 files are byte-identical to EveryAyah's.
- Class B reciters: QDC chapter-level segments `[wordPosition1, startMs, endMs]` in chapter time +
  HTTP Range slices of CBR chapter files (sample-exact in Chromium and WebKit; never slice VBR files).
- Class C: no browser-reachable word timings; text-only estimates are off by a median 598 ms → whole ayahs.
- Unusable from a browser: `cdn.islamic.network` audio, `everyayah.com/data/recitations.js`, the quran-align
  release zip (no CORS).

**Tafsir & translation** (`research/tafsir-translation.md`)
- Sources and URL templates: the doc's §1 table (all CORS `*`). Mukhtasar from QuranEnc
  `arabic_mokhtasar` (+ fallbacks); Qurtubi complete from spa5k (Quran.com id 90 truncates at 65,535 bytes).
- Grouped passages come in 3 shapes and some ayahs have gaps (Sa'di: 59 incl. 2:286) — handle all.
- jsDelivr intermittently answers 403 "Package size exceeded" — always have a fallback host.
- Licences forbid modifying tafsir text and require naming the publisher/source (+ QuranEnc version).
- Translations: `GET /quran/translations/{id}?verse_key=s:a` (126 translations, 66 languages); The Clear Quran (131) is **not** public.

**Media** (`research/media-pipeline.md`, sketch `research/scripts/media-pipeline/export-sketch.ts`)
- Mediabunny 1.66.2 on WebCodecs: 3.5–11.7× real time on desktop; A/V offset measured at 0 samples
  (Mediabunny writes the AAC priming edit list).
- AAC: native where present (Chrome Win/macOS/Android, Edge, Safari 26+); otherwise lazy-load
  `@mediabunny/aac-encoder` (installed, ~284 KiB gzip) — Firefox, Chrome Linux/ChromeOS, Safari 16.4–18.
- **No MediaRecorder and no ffmpeg.wasm** (real-time only, VFR, dropped starts, A/V offsets / 32 MB GPL).
  Firefox Android has no WebCodecs → PNG export only, with a clear note.
- Decode with `decodeAudioData` on a 48 kHz `OfflineAudioContext`; cut + concat + fade in one offline pass.
  The CDN MP3s are LAME-tagged → 0 samples of priming offset in Chrome and WebKit.
  Files > 2 MB: fetch only the window with HTTP Range and prepend the file's own Info frame (sample-exact).
- Share from a **fresh tap** after the render (transient activation lasts 5 s in all engines);
  `.mp4`/`.png` are allowed; Chromium caps a share at 10 files / 50 MiB → download fallback.
- Defaults: 720×1280 30 fps, H.264 2.5 Mbps, AAC 128 kbps 48 kHz stereo, keyframe 2 s; 1080p opt-in
  ≤ 4.5 Mbps; total bitrate ≤ 0.9 × 50 MiB × 8 / duration.
- PWA: vite-plugin-pwa 2.0.0 / Workbox 7.4.1 (installed). CacheFirst for CORS audio, statuses [200] +
  rangeRequests, never cache 206/opaque; QF JSON ≤ 7 days; no COOP/COEP.

**Product** (`research/features.md`)
- Word-range selection is unique among ~30 competitors and is the biggest integrity risk → ship the
  pause-mark boundary guard with it. The top competitor complaint is export that fails/crashes.
- Never add music. Preset backgrounds: no people, nothing depicting the unseen.
- Warn before export about platform limits: WhatsApp Status 90 s, Instagram Stories 60 s, Shorts 180 s
  (and Content ID claims on recitation audio).
- Backgrounds without keys: upload, procedural, Lorem Picsum, Wikimedia Commons, Openverse — never Unsplash/Pexels/Pixabay APIs.

### Text gotchas (verified)

- `words[]` (`char_type_name == "word"`) positions 1..N are the indices audio segments use.
  The last entry has `char_type_name == "end"` (ayah number) — skip it.
- A word's `text_uthmani` may end with `" ۚ"` (space + pause mark). Split it off → `Word.waqf`.
- `text_uthmani_tajweed`: tokens split on spaces align 1:1 with `words[]`; pause marks are glued
  to the previous token with U+200C; `<span class=end>N</span>` closes the verse; some U+0670
  appear as U+0672 (Amiri Quran has no U+0672 glyph — normalise).
- Amiri Quran renders `U+06DD` + Arabic-Indic digits as the enclosed ayah-end ornament (HarfBuzz verified).

### Audio gotchas (verified)

- `GET /verses/by_chapter/{s}?audio={recitation_id}` → `verse.audio = { url, segments }`.
  `url` is relative to `https://verses.quran.com/`.
- A segment is `[fromIndex0, toPosition, startMs, endMs]`: words `fromIndex0+1 .. toPosition`.
  Usually one word (`[2,3,…]` = word 3); sometimes several (`[11,13,…]` = words 12–13).
- Recitation 3 (Sudais) sends the numbers as **strings** — coerce.
- Some segment lists miss a word (Minshawi 4:43: 47 of 48) — interpolate, never crash.
- Per-ayah files do **not** include the basmala (112:1 starts at 30 ms) → optional basmala
  clip from the reciter's 1:1 file.
- Cuts inside an ayah only sound clean at pauses; that is why snapping to pause marks is the default.

### Tafsir (verified)

`GET /tafsirs/{id}/by_ayah/{key}` → `{ tafsir: { verses: {"2:255": …}, text: <html> } }`, CORS `*`.
Arabic ids: 16 Muyassar (2:255 = 688 chars, fits a card) · 93 Al-Wasit · 91 Sa'di (2,881) ·
14 Ibn Kathir (2:3 = 9,095) · 15 Tabari · 90 Qurtubi (4:43 = 37,099) · 94 Baghawi.
Exports show the short tafsir in full and truncate long ones with an ellipsis + source line;
the in-app reader shows everything.

## Architecture — React Native (Expo SDK 58) with the web as the first target

The app is built in **React Native with Expo** so it can ship to Android/iOS later from the same
code. Today it runs on the web (react-native-web, Expo Router, static export, PWA). Everything that
cannot run identically on native sits behind a **platform adapter**: a `platform.web.ts` that is
implemented now, and a `platform.ts` (native) stub whose header says exactly what to build later.

```
src/
  app/                 Expo Router routes only (_layout.tsx, index.tsx, +html.tsx, lab/* web test benches)
  core/types.ts        shared contract incl. the Painter drawing contract (owner: lead)
  data/                fetch-only network layer (works on web + native): Quran.com client, tajweed
                       projection, reciter catalogue + timing adapters, tafsir/translation providers, cache
  domain/              pure logic: selection, pause-mark snapping/warnings, audio planner + timeline,
                       tajweed rule catalogue, share-link state, Arabic helpers
  render/              scene composition over Painter (platform-neutral) · platform.web.ts = Canvas 2D +
                       HarfBuzz wasm · platform.ts = native stub (React Native Skia + non-wasm shaper later)
  media/               index.ts contract · platform.web.ts = Web Audio + Mediabunny/WebCodecs + Web Share ·
                       platform.ts = native stub (react-native-audio-api, native encoder module, expo-sharing later)
  ui/                  React Native components (View/Text/Pressable…), store, theme, i18n; web-only
                       pieces as *.web.tsx (e.g. the preview <canvas>) with a native *.tsx counterpart
  vendor/harfbuzzjs/   harfbuzzjs 1.6.4 patched for Metro (no top-level await) — see its README
assets/fonts/          AmiriQuran-Regular.ttf (+ OFL) — loaded by expo-font for Text and fetched for HarfBuzz
public/                web-only static files (harfbuzz.wasm, manifest/service worker later)
```

What runs where today:

| Piece | Web | Native (later) |
|---|---|---|
| UI, store, selection, reading, tafsir, tajweed panel | ✅ | ✅ same code (RN components) |
| data/, domain/ | ✅ | ✅ same code |
| Preview + PNG/MP4 export | ✅ Canvas 2D + HarfBuzz + WebCodecs | stub → Skia Painter + native encoder |
| Audio decode/cut/play | ✅ Web Audio | stub → react-native-audio-api |
| Share | ✅ Web Share / download | stub → expo-sharing |

Data flow:

```
fetchAyahs ─┐
            ├─ Selection ─ trimToSelection ─┐
fetchAyahAudio ─ planAudio ─ assembleAudio ─┼─ buildTimeline ─┐
fetchTafsir / fetchTranslation ─────────────┤                 ├─ RenderModel ─ createScene ─ Scene.draw(painter, t)
rulesInAyahs ───────────────────────────────┘                 │        ├─ preview (web: <canvas> + createCanvasPainter, player clock)
                                                              │        ├─ exportImage → PNG
                                                              └────────┴─ exportVideo(scene, audio) → MP4 → shareFile
```

Each module's public API is its `index.ts`; the stub bodies there are the contract.

## Conventions

- **Expo SDK 58 / React Native 0.88 / React 19.3 / TypeScript 6.0** (Expo pins it). Read `AGENTS.md`
  (Expo's own agent guide): versioned docs at https://docs.expo.dev/versions/v58.0.0/, never Expo APIs
  from memory, `npx expo install <pkg>` for any Expo/RN package, routes only in `src/app/`.
- `erasableSyntaxOnly` + `verbatimModuleSyntax`: **no `enum`, no namespaces, no constructor parameter
  properties**; `import type` for types.
- Imports between modules only through `src/<module>/index.ts`. `core/` imports nothing.
  Exception: web-only files (`*.web.ts(x)`) may import `createCanvasPainter` from `src/render/platform.web`.
- Platform files: `x.web.ts` (Metro picks it on web) and `x.ts` (native/default, also what TypeScript and
  Vitest resolve). Both export the same typed object (`RenderPlatform`, `MediaPlatform`, …).
- RTL: web `<html dir="rtl">` (`src/app/+html.tsx`); native forced RTL via the expo-localization plugin.
  Use logical styles (`marginStart`, `paddingEnd`, `start`/`end`), never left/right, in UI code.
- No new runtime dependency without a note in the commit message saying why.
- Unit tests: `src/**/*.test.ts`, Vitest, node environment, **no network** (fixtures in
  `src/<module>/__fixtures__/`, captured once from the real APIs). `npm test`, `npm run typecheck`.
- All user-visible strings in Arabic first (English via `ui/i18n`). Numbers shown with Arabic-Indic digits in Arabic UI.

## Design brief (UI)

- **Subject & audience:** Arabic-speaking Muslims sharing a passage to WhatsApp Status /
  Instagram / Facebook from their phone. Job: from "this ayah" to a beautiful clip in under a minute.
- **Concept:** the app is a Mushaf page you can cut from. The surah text panel is the hero:
  words are tapped like marking a page with a gilded reed pen; the selection is a gold
  band. The preview stage is the second hero. Everything else is quiet.
- **Palette:** ink `#16222E` · page `#FBF8F0` (only the Mushaf panel) · chrome `#F2F4F3` ·
  malachite `#1D6B57` (primary actions: export/share — the green of the Madani Mushaf frame) ·
  gold leaf `#C29A3E` (selection band, highlights) · lapis `#2A4A7F` (focus, links) ·
  rubric `#A8382C` (warnings). Dark: chrome `#0F1820`, page `#17212B`, text `#ECE6D8`.
  Colour only where it means something; tajweed colours appear only on tajweed text.
- **Type:** Amiri Quran (Quran text only) · Reem Kufi (app name and section titles, sparingly —
  Kufic is the script of the earliest Mushafs) · Readex Pro (all UI text). Sentence case, no
  all-caps labels, no eyebrow labels.
- **Layout:** phones (< 1024 px, most users) get a five-step flow, one screen per step and no page scroll
  (Omar, 2026-11-22: "stepper not vertical scroll"): الآيات → القارئ → الإضافات → التصميم → المعاينة, with a step
  indicator under a compact header and Back / Next in the bottom bar («صدّر المقطع» on the last step); browser and
  Android back walk the steps (`src/ui/stepper.ts`, `stepNav.ts`, `components/Stepper.tsx`);
  wide screens (`useWindowDimensions().width >= 1024`): two columns — Mushaf panel on the right (reading side), stage + options on the left.
  The Mushaf panel's margin shows juz/page like a real Mushaf margin (information, not decoration).
- **Motion:** only in answer to actions (selection band growing, sheet opening, export progress).
  Reduced motion respected (`AccessibilityInfo.isReduceMotionEnabled`).
- **Platform:** React Native primitives only (View, Text, Pressable, ScrollView/FlatList, Modal, TextInput);
  StyleSheet + a tokens module (no CSS files); icons from `@expo/vector-icons`; fonts via expo-font
  (`@expo-google-fonts/readex-pro`, `@expo-google-fonts/reem-kufi`, and assets/fonts/AmiriQuran-Regular.ttf).
- **Copy:** plain Arabic verbs that say what happens: «شارك الفيديو», «حمّل الصورة», «اختر القارئ».
  Errors say what happened and what to do; no apologies.

## Milestones

- **M0** scaffold + rendering/video labs — done (767962b)
- **M1** research docs (`research/*.md`, live-verified) + contracts (`core/types.ts`, module stubs, this plan) — done (95c960d)
- **M1b** switch to React Native (Expo SDK 58, web first) with platform adapters; harfbuzzjs vendored for Metro — done (1cdf38f)
- **M2** data + domain implemented with unit tests — done (f834b99, 53d0a60; review corrections e49072a, 080081c)
- **M3** render engine + image export — done (e2b483d; paging, isti'adha, Noto 4cc9bca)
- **M4** media: audio assembly, preview player, video export, share — done (c284bef, a81984f)
- **M5** UI: picker, reciter, design, content toggles, preview, export sheet, deep links — done (0bf33cb, 9946054)
- **M6** PWA — done (4298515); end-to-end run partly done (fixes 0bf87b6, report not finished — see Pending)
- **M7** multi-angle review + fixes — **not started** (see Pending)
- **M8** publishing to the «Share Quran» pages + «ادعمنا» — **in progress**: render route and server with all six
  publishers done (786398b, fba7386, b1c38a5, 6ba9027); Docker, the app UI and docs left (see M8 below)
- **Deploy:** `scripts/deploy-pages.sh` → https://sharequran.app/ (repo astromar96/sharequran, gh-pages, build
  only). Domain bought 2026-11-21 at Cloudflare Registrar (Omar's account; auto-renews every
  21 Nov at $14.20); DNS at Cloudflare, all records "DNS only" (apex A/AAAA → GitHub Pages, `www` CNAME →
  astromar96.github.io); verified in GitHub Settings → Pages (TXT `_github-pages-challenge-astromar96`).
  The first address, https://astromar96.github.io/balligh/ (branch `gh-pages` of astromar96/balligh), is left as it
  was: an old build, not maintained, with no redirect (Omar's call: old links don't matter).
- **Open source (Omar, 2026-11-22):** AGPL-3.0-only (`LICENSE`, `README.md`, `THIRD_PARTY.md`). The public source is
  branch `main` of astromar96/balligh, built by `scripts/export-public.sh`: this repository's HEAD without
  `research/` and without fixture data (captured provider responses may not be republished), in a fresh history,
  because earlier commits contain that data. The full history stays local. Where fixture data is missing,
  `scripts/fixture-gate.cjs` leaves the tests and labs that need it out of tsc, ESLint, vitest and Metro, and app code
  may never be left out. To publish again: export into an empty dir, run the checks there, and commit on top of
  the public `main`.

## M8 — publishing to the «Share Quran» pages (2026-11-22, in progress)

The user taps one button, picks platforms, and gets back the link of a post on Balligh's own account, instead of
downloading the MP4 and uploading it again. Approved plan: `~/.claude/plans/modular-hatching-quokka-of-7b194cb9-…md`.

**Decisions (Omar, 2026-11-22)**
- Platforms: **Instagram, Facebook, Threads, Telegram channel, YouTube Shorts, X**. TikTok is out: its audit rejects
  "a tool that uploads to accounts you or your team manage", and unaudited posts are private-only.
- **Instant, no human review.** Safe because the server renders the clip from the share link itself; the request
  carries no video. A cut the guard rates 'warning' is refused (`domain.selectionWarnings`).
- Per-account daily limits are respected, never dodged with extra accounts (Meta Developer Policies). When a
  platform is full, the sheet says so and «شارك» (the user's own account) still works.
- Optional **publisher credit**: «اسمك» → «نشرها: فلان» in the caption (letters only, ≤ 30, blocklist, reserved names);
  «حسابك على إنستجرام» → a collaborator invite on the reel (the reel can then show on their profile too) and an
  @mention on Threads. Kept only for the job. An Instagram username always makes a new Instagram post.
- **Money: a free «ادعمنا» link** (Ko-fi → Omar's PayPal). Paying unlocks nothing, which keeps Balligh
  non-commercial for the reciter/translation licences (00-gaps U7). Say «ادعمنا», not «تبرّع» (Egypt's NGO law
  149/2019 regulates collecting donations). Stripe takes no Egyptian merchants.
- **No production deploy** of the site or the server unless Omar asks.

**Done**
- `/render` route (`src/ui/RenderJob.tsx`, noindex): opens a share link, waits for recitation/fonts/tafsir/
  translation, refuses a 'warning' cut or < 3 s, encodes at 1080p (`q=fullhd`), exposes file + caption parts on
  `window.__ballighRender`. Shared helpers lifted out of the export sheet: `shareText.ts`, `exportVideo.ts`,
  `bootstrap.ts`. Verified headless: 1080×1920 H.264/AAC, Al-Fatiha 1–3 in 30 s on a Mac.
- `src/domain/publish.ts`: the six platforms' limits (`PLATFORM_RULES`), `platformRefusal`, publisher-credit checks
  — shared by the app and the server.
- `server/` (Node 24, node:sqlite, playwright-core + Google Chrome, esbuild): `POST /publish`, `GET /publish/:id`,
  `GET /status`, one-time `/media/:token.mp4`; canonical link (aspect forced 9:16) = dedupe key; one render at a
  time; 3 renders/address/hour; optional Turnstile; MP4 deleted when the job ends (QF terms); per-platform captions
  (X gets no URL: $0.015 a post instead of $0.20). Publishers: Instagram, Facebook, Threads, Telegram, YouTube, X,
  plus dry-run. `npm run auth -- youtube|x` prints the refresh token for `.env`. 49 server tests.
- Verified end to end in dry-run against the dev server: one render, six captions, MP4 deleted, repeat = instant
  dedupe.

**Findings that changed the plan (live docs, 2026-11-22)**
- Instagram and Threads specs forbid MP4 edit lists; our export writes one (AAC priming). `server/src/mp4.ts` gives
  those two a copy without it (audio 44 ms late; checked with ffprobe/ffmpeg).
- YouTube: unverified API projects are **no longer** locked to private; `videos.insert` = 100 calls/day in its
  own bucket. No audit wait. Google OAuth apps left in "Testing" get refresh tokens that expire after 7 days:
  publish the consent screen to "In production".
- X: standard accounts take videos up to 20 min (not 140 s). Facebook: no endpoint for the 30-reels count, so the
  server counts its own posts.

**Left (checkpoints of the approved plan)**
5. `server/Dockerfile` (Playwright noble + Google Chrome stable, amd64), `compose.yml` (+ Caddy), `.env.example`,
   `server/README.md` with Omar's setup per platform; verify the image under a colima x86_64 profile (Linux Chrome's
   OpenH264 + the WASM AAC fallback, never tried headless on Linux).
6. App UI: «انشر على صفحات Share Quran» in the export sheet (`src/ui/publish.ts` client, name/username fields,
   six chips with reasons, progress, per-platform links), «ادعمنا» link; hidden until `EXPO_PUBLIC_PUBLISH_API` /
   `EXPO_PUBLIC_SUPPORT_URL` are set; ar/en strings.
7. Docs: this section to "done", AGENTS.md server commands. **No site deploy** (Omar).
8. Blocked on Omar: Facebook Page + Instagram professional account in a Meta Business portfolio, Meta app + system
   user token; Threads token; Telegram channel + bot; YouTube channel + Google Cloud project (Desktop OAuth client);
   X account + credits; Ko-fi page; an x86 VPS + DNS `api.sharequran.app`.

**Run it locally (dry run):** dev server on :8081, then
`cd server && npm install && npm run build && DRY_RUN=1 APP_URL=http://localhost:8081 ALLOWED_ORIGINS=http://localhost:8081 npm start`
→ `POST http://localhost:8787/publish {"query":"v=1&s=1&a=1-3&r=alafasy","platforms":["instagram","x"],"name":"عمر"}`;
the MP4 and captions land in `server/data/dry-run/`.

## Pending work (2026-11-21, published as-is at Omar's request)

State at publish: tsc 0 errors, ESLint clean, 701 unit tests pass; module labs verified exports in
Chrome + Playwright WebKit (H.264 + AAC, exact frame counts, A/V lag 0).

**Not finished in this run**
1. M7 adversarial review (Quran-text integrity, audio sync, licences/credits, a11y/RTL, robustness) — not run.
2. The integrator's end-to-end run (flows: Fatiha video+PNG, 2:255–256 partial with Yasser + tafsir + English,
   112 with basmala + isti'adha, class C 36:1–5, class D 18:1–3, multi-page still, Urdu still; WebKit; deep-link
   round trip; keyboard path) was stopped before its report. Its last open check: after moving focus to «شارك» on
   mount, one download did not arrive — re-run the export-sheet download path.
3. PWA browser checks (offline reload, sub-path) were being re-run when stopped — verify on the live site.

**Needs a real device or a person**
4. Share sheet and export on iPhone / Android / Firefox (00-gaps U1–U4); messengers and the audio `elst` (U5).
5. Tajweed teacher review (D10): the 19 `explanationEn`, the slnt/iqlab Arabic wording, the madd labels, the
   idgham_shafawi colour.
6. Listen once: QDC/mp3quran preambles (U12), the isti'adha files of Husary/Shatri/Hudhaify/Ali Jaber (U13).

**Omar's decisions (defaults taken, 00-gaps §3)**
7. D1 waqf guard (Tanzil) vs printed marks (QPC) · D2 Amiri vs KFGQPC Hafs · D3 300 s video / 10 images ·
   D6 cutting Jalalayn to the selected words · D7 isti'adha only in the reciter's own voice ·
   D9 QF terms (register a QF Developer Console account; ask about purge-on-launch and private fixtures) ·
   U7 licences: keep Balligh free and non-commercial, email EveryAyah and mp3quran.

**Known gaps in the product**
8. Video: a long tafsir on a short ayah pages faster than anyone can read; nothing warns.
9. Readex Pro draws the Arabic-Indic zero as a dot (clock, numbers).
10. Several images download as separate files (Chrome's multi-download prompt); no zip.
11. Duration estimate for class C and the isti'adha uses a floor (550 ms/word, 8 s) — needs AyahAudio.durationMs.
12. Pause between class C ayahs is 160–330 ms; a "breath" gap option may be wanted.
13. No Thaana translation in TRANSLATIONS (render supports it).
14. The speech-verb guard over-fires (e.g. a start after 5:73's «يَقُولُونَ»); it only warns.
15. WebKit encodes H.264 Constrained Baseline (valid, a little less efficient).
16. Native app: render (Skia + a non-wasm shaper), media (react-native-audio-api + native encoder), multi-file
    share (expo-sharing shares one file), persistent cache (expo-file-system) are stubs.

**Housekeeping**
17. Delete `research/tmp/` (6.2 GB of research downloads) and, per the QF terms, the local 22 MB crawl
    `research/fixtures/quran-text-api/all-verses.json` once the corpus tests are no longer needed.
