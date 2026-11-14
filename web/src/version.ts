// The release version shown on the landing page and /judge. The build stamps a fallback into the HTML
// (vite.config.ts, from `git describe --tags` or package.json); at runtime the latest GitHub release replaces it.

export const RELEASES_URL = 'https://github.com/edycutjong/patungan/releases/latest'
export const RELEASE_API = 'https://api.github.com/repos/edycutjong/patungan/releases/latest'

/** Normalise a release tag to `vMAJOR.MINOR.PATCH[-pre]`; anything else is null. */
export function formatVersion(tag: unknown): string | null {
  if (typeof tag !== 'string') return null
  const m = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/)
  return m ? `v${m[1]}.${m[2]}.${m[3]}${m[4] ?? ''}` : null
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>

/** Fetch the latest release tag (public repo, no token). Resolves null on any failure so the fallback stays. */
export async function latestRelease(fetchFn: FetchLike = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(RELEASE_API, { headers: { accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const body = (await res.json()) as { tag_name?: unknown } | null
    return formatVersion(body?.tag_name)
  } catch {
    return null
  }
}

/** Replace the text of every `[data-version]` element with the latest release tag, when it can be read. */
export async function mountVersion(root: ParentNode = document, fetchFn: FetchLike = fetch): Promise<string | null> {
  const els = [...root.querySelectorAll<HTMLElement>('[data-version]')]
  if (els.length === 0) return null
  const tag = await latestRelease(fetchFn)
  if (tag) for (const el of els) el.textContent = tag
  return tag
}
