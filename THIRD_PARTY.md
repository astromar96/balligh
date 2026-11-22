# Third-party code, fonts and data

Balligh's own code is AGPL-3.0-only (`LICENSE`). The parts below keep their own licences.

## In this repository

| What | Where | Licence |
|---|---|---|
| harfbuzzjs (HarfBuzz compiled to WebAssembly) | `src/vendor/harfbuzzjs/` | MIT (`src/vendor/harfbuzzjs/LICENSE`) |
| Amiri Quran font, by Khaled Hosny | `assets/fonts/AmiriQuran-Regular.ttf` | SIL Open Font License 1.1 (`assets/fonts/AmiriQuran-OFL.txt`) |

## npm dependencies (installed, not committed)

The main ones are listed below. `npm ls` shows the full tree, and each package carries its own licence.

| Package | Licence |
|---|---|
| mediabunny, @mediabunny/aac-encoder | MPL-2.0 |
| expo and expo-* modules, expo-router, react, react-native, react-native-web, zustand | MIT |
| @expo-google-fonts/readex-pro, @expo-google-fonts/reem-kufi | MIT (code), OFL-1.1 (fonts) |
| playwright-core (`server/` only) | Apache-2.0 |

## Fetched at run time (never stored here)

Quran text and word data, recitations, timings, tafsir, translations and Noto fonts come from their providers'
public APIs and CDNs. The README table lists them, each under its provider's terms. The app shows the required
credits in every export and share text.
