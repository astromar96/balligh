#!/usr/bin/env bash
# Builds the public source tree (github.com/astromar96/balligh, AGPL-3.0-only) from this checkout's HEAD into an
# empty directory: the code without any third-party data.
#
# Left out:
#   research/                      raw API captures, quoted terms, local paths — kept private
#   src/**/__fixtures__/* (data)   captured responses from Quran Foundation, QuranEnc, Quranpedia, mp3quran,
#                                  EveryAyah and Tanzil, which their terms do not allow republishing; the .ts helpers
#                                  stay, and the tests that need the data are skipped there (scripts/fixture-gate.cjs)
# The public history starts fresh: earlier commits of this repository contain the data.
#
# Usage: scripts/export-public.sh <empty dir>      then check it: npm ci && npm run typecheck && npx expo lint && npm test
set -euo pipefail

out="${1:?usage: scripts/export-public.sh <empty dir>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$out"
if [ -n "$(ls -A "$out")" ]; then
  echo "export-public: $out is not empty" >&2
  exit 1
fi

git -C "$root" archive --format=tar HEAD | tar -x -C "$out"
rm -rf "$out/research"
find "$out/src" -path '*/__fixtures__/*' -type f ! -name '*.ts' -delete
find "$out/src" -type d -empty -delete

# nothing that came from a provider may be left behind
leftover="$(find "$out" -path "$out/node_modules" -prune -o -type f \( -path '*/__fixtures__/*' -o -path '*/research/*' \) ! -name '*.ts' -print)"
if [ -n "$leftover" ]; then
  echo "export-public: data left in the export:" >&2
  echo "$leftover" >&2
  exit 1
fi
# a home-directory path leaks the developer's user name (this script names the patterns, so it is not searched)
paths=(grep -rIl --exclude-dir=node_modules --exclude=export-public.sh -e '/Users/' -e '/home/' "$out")
if "${paths[@]}" >/dev/null 2>&1; then
  echo "export-public: a local path is left in:" >&2
  "${paths[@]}" >&2
  exit 1
fi

echo "export-public: $(find "$out" -type f | wc -l | tr -d ' ') files in $out"
echo "export-public: left out of tsc/vitest there: $(node "$out/scripts/fixture-gate.cjs" | wc -l | tr -d ' ') files"
