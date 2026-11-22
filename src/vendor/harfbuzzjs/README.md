# harfbuzzjs 1.6.4 (vendored, patched)

Copied from the npm package `harfbuzzjs@1.6.4` (MIT, see LICENSE) with two changes so it bundles under
Metro (Expo web), which has no top-level `await` and no `import.meta.url`:

1. `index.mjs`: the module-level `init(await createHarfBuzz())` became an exported `loadHarfBuzz(options)`
   that initialises once and returns the same promise afterwards.
2. `harfbuzz.js`: `import.meta.url` → `globalThis.location.href` (unused when `wasmBinary` is passed).

The wasm is served from `public/harfbuzz.wasm`; callers fetch it and pass `{ wasmBinary }`.
Verified in an Expo SDK 58 web export (headless Chrome): shaping + glyph outlines work.
