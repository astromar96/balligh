// Native/default counterpart of bench.web.ts (Metro picks the .web file on the web); same exports. The
// render bench needs Canvas 2D + WebAssembly, so on native it only reports that it is web-only.
import type { LabCase, RenderedCase } from './cases'

export { ASPECTS, VARIANTS } from './cases'
export type { LabCase, RenderedCase, Variant } from './cases'

const WEB_ONLY = 'The render bench runs on the web only (Canvas 2D + HarfBuzz wasm).'

export async function renderCaseToCanvas(_c: LabCase): Promise<RenderedCase> {
  throw new Error(WEB_ONLY)
}

export async function startBench(_host: HTMLElement | null, onStatus: (s: string) => void): Promise<void> {
  onStatus(WEB_ONLY)
}
