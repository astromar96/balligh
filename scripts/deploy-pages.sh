#!/usr/bin/env bash
# Publish the web build to GitHub Pages: https://sharequran.app/ (the gh-pages branch of astromar96/sharequran)
#
# Only the BUILD goes public, on the gh-pages branch of PAGES_REPO. The source stays private: it holds
# Quran Foundation sample payloads (test fixtures, research), and the QF Developer Terms forbid QF data
# in a public repo (research/00-gaps.md D9). The production bundle has none: metro.config.js drops the
# lab routes, the only importers of those fixtures.
#
# Usage: scripts/deploy-pages.sh                                  (astromar96/sharequran → https://sharequran.app/)
#        PAGES_REPO=owner/name PAGES_DOMAIN= scripts/deploy-pages.sh   (no custom domain: https://<owner>.github.io/<name>/)
# A custom domain needs its DNS first (apex A/AAAA records → GitHub Pages, www CNAME → <owner>.github.io;
# see docs.github.com "Managing a custom domain for your GitHub Pages site"); sharequran.app's records are in
# Cloudflare. Every deploy must set it again: the force-push replaces the branch, so the CNAME file is written
# here each time.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${PAGES_REPO:-astromar96/sharequran}"
# "-" rather than ":-": PAGES_DOMAIN= (set but empty) publishes without a custom domain
DOMAIN="${PAGES_DOMAIN-sharequran.app}"
if [ -n "$DOMAIN" ]; then BASE=""; else BASE="/${REPO#*/}"; fi
WORK="$(mktemp -d)"
OUT="$WORK/dist"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
if [ -n "$(git status --porcelain)" ]; then
  echo "note: the working tree has uncommitted changes; the build includes them" >&2
fi
REV="$(git rev-parse --short HEAD)"

echo "▸ export (base ${BASE:-/})"
BALLIGH_BASE_URL="$BASE" npx expo export -p web --output-dir "$OUT" >"$WORK/export.log" 2>&1 || {
  tail -40 "$WORK/export.log" >&2; exit 1; }

if [ -f scripts/build-sw.mjs ]; then
  echo "▸ service worker"
  BALLIGH_BASE_URL="$BASE" node scripts/build-sw.mjs "$OUT"
fi

# Expo writes files and folders that start with "_" (Jekyll would drop them); unknown paths get the
# app's not-found page.
touch "$OUT/.nojekyll"
if [ -f "$OUT/+not-found.html" ]; then cp "$OUT/+not-found.html" "$OUT/404.html"; fi
if [ -n "$DOMAIN" ]; then printf '%s\n' "$DOMAIN" >"$OUT/CNAME"; fi

echo "▸ repo $REPO"
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public \
    --description "بلّغ — share Quran verses as recitation videos and images, made on your device (built site only)" >/dev/null
fi

echo "▸ push gh-pages"
cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Deploy $REV"
git push -q -f "https://github.com/$REPO.git" gh-pages

# Serve the gh-pages branch (first deploy only; later pushes rebuild automatically). GitHub often turns
# Pages on by itself when a gh-pages branch appears; its 409 "already enabled" is fine.
if ! gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 ||
    gh api "repos/$REPO/pages" >/dev/null
fi

if [ -n "$DOMAIN" ]; then
  # Same setting as Settings → Pages → Custom domain; HTTPS can be enforced once GitHub has issued the certificate
  # (.app is HTTPS-only in every browser, so the site answers only after that).
  gh api -X PUT "repos/$REPO/pages" -f "cname=$DOMAIN" >/dev/null
  gh api -X PUT "repos/$REPO/pages" -F "https_enforced=true" >/dev/null 2>&1 ||
    echo "note: HTTPS is not enforceable yet (certificate pending); re-run later or tick 'Enforce HTTPS' in Settings → Pages" >&2
  echo "✓ https://$DOMAIN/  (GitHub Pages takes a minute to build)"
else
  OWNER="$(printf '%s' "${REPO%%/*}" | tr '[:upper:]' '[:lower:]')"
  echo "✓ https://$OWNER.github.io$BASE/  (GitHub Pages takes a minute to build)"
fi
