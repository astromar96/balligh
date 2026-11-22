// Test-only helpers (never imported by app code): read files from disk without Node typings in the app's
// tsconfig, and the LIVE switch for the network suite (`LIVE=1 npx vitest run src/data`).
//
// Fixture provenance (all real responses, kept small; never bundled with the app):
// - qc-*, aqc-*, qdc-*, mp3quran-*, qenc-*: captured 2026-11-21 from the exact URLs data/ requests
//   (qc-verses-*: words trimmed to the requested fields; qc-verses-special: by_key for the edge-case verses;
//   *-excerpt: a handful of verses cut from the bulk responses).
// - qdc-anomalies, qdc-8-ch36-unsorted, qdc-173-ch1-zero-length, qc-tafsir-14/16/91-2_23*, qp-2003*, qenc-sura-
//   arabic_moyassar*, qenc-aya-indonesian*, qc-tr-131-empty, qc-verses-2_255-translation-markup, spa5k-*:
//   copied from research/fixtures (texts marked "[TRIMMED …]" were shortened by the researcher).
// - qp-3-103_2-two-groups: Quranpedia's real response with each page text cut to 400 characters.
type Fs = { existsSync(p: URL): boolean; readFileSync(p: URL, encoding: 'utf8'): string } & { readFileSync(p: URL): Uint8Array }

let fsModule: Promise<Fs> | null = null
const fs = (): Promise<Fs> => (fsModule ??= import('node:fs' as string) as Promise<Fs>)

/** A path relative to the repository root. */
export const repoFile = (rel: string): URL => new URL(`../../../${rel}`, import.meta.url)

/** Parsed JSON, or null when the file does not exist (local research downloads are optional). */
export async function readJsonIfPresent<T = unknown>(url: URL): Promise<T | null> {
  const f = await fs()
  if (!f.existsSync(url)) return null
  return JSON.parse(f.readFileSync(url, 'utf8')) as T
}

/** Raw bytes, or null when the file does not exist. */
export async function readBytesIfPresent(url: URL): Promise<Uint8Array | null> {
  const f = await fs()
  if (!f.existsSync(url)) return null
  return f.readFileSync(url)
}

/** Text, or null when the file does not exist. */
export async function readTextIfPresent(url: URL): Promise<string | null> {
  const f = await fs()
  if (!f.existsSync(url)) return null
  return f.readFileSync(url, 'utf8')
}

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

/** True when the network suite should run. */
export const LIVE = Boolean(env.LIVE)
