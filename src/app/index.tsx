import type { Metadata } from 'expo-router/server'
import { BallighApp } from '../ui'

// The app is a single screen; deep links carry the whole state in the query string.
export default function Home() {
  return <BallighApp />
}

export function generateMetadata(): Metadata {
  return {
    title: 'بلّغ — شارك آيات القرآن',
    description: 'اختر آية أو بضع كلمات، وقارئًا وتصميمًا، ثم شاركها فيديو أو صورة. كل شيء يُصنع على جهازك.',
  }
}
