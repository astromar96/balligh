// One JSON line per event on stdout (docker logs). Never logs a token, a publisher credit or a client address.
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env.VITEST && level !== 'error') return
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }))
}
