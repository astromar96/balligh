import type { Metadata } from 'expo-router/server'
import { NotFoundScreen } from '../ui'

// Any path the app does not have (exported as +not-found.html; the GitHub Pages deploy serves it as 404.html).
export default function NotFound() {
  return <NotFoundScreen />
}

export function generateMetadata(): Metadata {
  return { title: 'الصفحة غير موجودة — بلّغ' }
}
