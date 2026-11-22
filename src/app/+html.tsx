import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

// Web-only HTML shell for static rendering (Expo Router, SDK 58). Arabic-first, right-to-left.
// SDK 58 contract: spread htmlAttributes/bodyAttributes, render headNodes in <head> (React Native
// web styles, metadata) and bodyNodes after children (fonts + the JS bundle — without them the
// page never becomes interactive). Runs in Node only: no browser APIs here.
export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext()
  return (
    <html lang="ar" dir="rtl" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F2F4F3" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0F1820" />
        <link rel="manifest" href={`${BASE_URL}/manifest.webmanifest`} />
        <link rel="apple-touch-icon" sizes="180x180" href={`${BASE_URL}/icons/apple-touch-icon.png`} />
        <meta name="apple-mobile-web-app-title" content="بلّغ" />
        <ScrollViewStyleReset />
        <style id="balligh-base" dangerouslySetInnerHTML={{ __html: BASE_CSS }} />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  )
}

// PWA (src/pwa, public/manifest.webmanifest): the app's sub-path ("/balligh" on GitHub Pages, "" at the root) —
// app.json experiments.baseUrl, inlined by Expo at build time.
const BASE_URL = (process.env.EXPO_BASE_URL ?? '').replace(/\/+$/, '')

// Page background before the bundle paints (no white flash in dark mode) and a visible keyboard
// focus ring for every focusable element react-native-web renders.
const BASE_CSS = `
html, body { background-color: #F2F4F3; }
@media (prefers-color-scheme: dark) { html, body { background-color: #0F1820; } }
:focus { outline: none; }
:focus-visible { outline: 2px solid #2A4A7F; outline-offset: 2px; border-radius: 6px; }
@media (prefers-color-scheme: dark) { :focus-visible { outline-color: #8FB0E6; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; } }
`
