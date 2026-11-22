import type { Metadata } from 'expo-router/server'
import { RenderJob } from '../ui'

// /render?<share link>&q=fullhd — the publishing server's headless renderer (src/ui/RenderJob.tsx). Not for people.
export default function Render() {
  return <RenderJob />
}

export function generateMetadata(): Metadata {
  return { title: 'بلّغ — render', robots: { index: false, follow: false } }
}
