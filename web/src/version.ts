// The release version shown in the footers of the landing page, /judge and the deck. vite.config.ts stamps it into
// the HTML at build time and nothing fetches it at runtime: the anonymous GitHub API answers 403 to rate-limited
// visitors, which put a red console error on every page view. Every release is deployed, so the stamp is current.

/** Normalise a release tag to `vMAJOR.MINOR.PATCH[-pre]`; anything else is null. */
export function formatVersion(tag: unknown): string | null {
  if (typeof tag !== 'string') return null
  const m = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/)
  return m ? `v${m[1]}.${m[2]}.${m[3]}${m[4] ?? ''}` : null
}

/**
 * The first candidate that is a usable tag, normalised. vite.config.ts passes them in priority order: the hosted
 * build's PATUNGAN_VERSION, then `git describe --tags`, then package.json. 'v0.0.0' only if none parses.
 */
export function pickVersion(...candidates: unknown[]): string {
  for (const c of candidates) {
    const v = formatVersion(c)
    if (v) return v
  }
  return 'v0.0.0'
}
