#!/usr/bin/env bash
# Production deploy of web/ with the footer release read from the git tag on HEAD, never typed by hand.
# `vercel deploy` uploads web/ without .git and builds remotely, so vite.config.ts takes the tag from PATUNGAN_VERSION,
# passed with --build-env; this script sets it.
# The release workflow tags main on every feat/fix push: push, let it tag, then run this. It refuses an untagged HEAD
# (a footer naming an older release than the one GitHub lists as latest) unless ALLOW_UNTAGGED=1.
# After the deploy it checks that /, /judge and /pitch/ all show the tag.
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${SITE:-https://patungan.edycu.dev}"

git fetch --tags --quiet origin
TAG=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
if [ -z "$TAG" ]; then
  LATEST=$(git describe --tags --abbrev=0)
  if [ "${ALLOW_UNTAGGED:-0}" != 1 ]; then
    echo "HEAD $(git rev-parse --short HEAD) has no release tag yet (latest is $LATEST)." >&2
    echo "Wait for the release workflow to tag it, or set ALLOW_UNTAGGED=1 to stamp $LATEST." >&2
    exit 1
  fi
  TAG=$LATEST
fi

echo "Deploying $(git rev-parse --short HEAD) as $TAG"
PATUNGAN_VERSION="$TAG" vercel deploy --prod --yes --build-env PATUNGAN_VERSION="$TAG"

for path in / /judge /pitch/; do
  body=$(curl -sfL "${SITE}${path}")
  grep -q ">${TAG}</a>" <<<"$body" || { echo "${path} does not show ${TAG}" >&2; exit 1; }
  echo "${path} shows ${TAG}"
done
