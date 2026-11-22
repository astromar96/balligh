// The publishers that are live: every platform in dry-run mode, otherwise each platform whose credentials are set
// (server/.env.example). YouTube and X also need a refresh token — from the environment, or one the store kept.
import type { PublishPlatform } from '../../../src/domain'
import { PUBLISH_PLATFORMS } from '../../../src/domain'
import type { Config } from '../config'
import type { Store } from '../store'
import { DryRunPublisher } from './dry-run'
import { FacebookPublisher } from './facebook'
import { InstagramPublisher } from './instagram'
import { TelegramPublisher } from './telegram'
import { ThreadsPublisher } from './threads'
import type { Publisher } from './types'
import { XPublisher } from './x'
import { YouTubePublisher } from './youtube'

export function createPublishers(cfg: Config, store: Store): Map<PublishPlatform, Publisher> {
  const out = new Map<PublishPlatform, Publisher>()
  if (cfg.dryRun) {
    for (const p of PUBLISH_PLATFORMS) out.set(p, new DryRunPublisher(p, cfg.dataDir, store))
    return out
  }
  const count = (p: PublishPlatform) => () => store.postsLastDay(p)
  if (cfg.instagram) out.set('instagram', new InstagramPublisher(cfg.instagram, cfg.graphVersion))
  if (cfg.facebook) out.set('facebook', new FacebookPublisher(cfg.facebook, cfg.graphVersion, count('facebook')))
  if (cfg.threads) out.set('threads', new ThreadsPublisher(cfg.threads, cfg.threadsVersion, store))
  if (cfg.telegram) out.set('telegram', new TelegramPublisher(cfg.telegram))
  if (cfg.youtube && (cfg.youtube.refreshToken || store.getToken('youtube.refresh'))) {
    out.set('youtube', new YouTubePublisher(cfg.youtube, store, count('youtube')))
  }
  if (cfg.x && (cfg.x.refreshToken || store.getToken('x.refresh'))) out.set('x', new XPublisher(cfg.x, store, count('x')))
  return out
}
