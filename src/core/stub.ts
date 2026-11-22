/** Placeholder used by contract stubs until a module is implemented. */
export function notImplemented(name: string, ..._args: unknown[]): never {
  throw new Error(`not implemented: ${name}`)
}
