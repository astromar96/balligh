// Balligh's publishing server: renders a share link in headless Chrome and posts the clip to the «Share Quran»
// pages. See server/README.md.
import { loadConfig } from './config'
import { createApi } from './http'
import { Jobs } from './jobs'
import { log } from './log'
import { createPublishers } from './publishers'
import { ThreadsPublisher } from './publishers/threads'
import { renderClip } from './render'
import { Store } from './store'

const cfg = loadConfig()
const store = Store.open(cfg.dataDir)
const interrupted = store.failInterrupted()
const publishers = createPublishers(cfg, store)
const jobs = new Jobs({ store, cfg, publishers, render: renderClip })
const server = createApi({ cfg, jobs })

server.listen(cfg.port, () => {
  log('info', 'listening', { port: cfg.port, app: cfg.appUrl, dryRun: cfg.dryRun, live: [...publishers.keys()], interrupted })
})
jobs.kick()

const purge = setInterval(() => store.purge(), 10 * 60_000)

// the Threads token lives 60 days and can be renewed once it is a day old: try once a day
const threads = publishers.get('threads')
const renew = setInterval(() => {
  if (threads instanceof ThreadsPublisher) threads.refreshToken().then(
    () => log('info', 'threads token renewed'),
    (error: unknown) => log('warn', 'threads token renewal failed', { error: String(error) }),
  )
}, 24 * 60 * 60_000)

function shutdown(): void {
  log('info', 'shutting down')
  clearInterval(purge)
  clearInterval(renew)
  jobs.stop()
  server.close(() => {
    store.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
