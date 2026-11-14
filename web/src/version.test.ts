// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { formatVersion, latestRelease, mountVersion, RELEASE_API } from './version'

const ok = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }))

describe('formatVersion', () => {
  it('normalises tags with or without the v prefix', () => {
    expect(formatVersion('v0.1.0')).toBe('v0.1.0')
    expect(formatVersion('1.2.3')).toBe('v1.2.3')
    expect(formatVersion('  v2.0.10  ')).toBe('v2.0.10')
  })
  it('keeps a pre-release suffix', () => {
    expect(formatVersion('v1.0.0-rc.1')).toBe('v1.0.0-rc.1')
  })
  it('rejects anything that is not a semantic version, so junk never reaches the page', () => {
    for (const bad of ['', 'latest', 'v1.2', '1.2.3.4', '<b>v1.0.0</b>', null, undefined, 42, {}]) expect(formatVersion(bad)).toBeNull()
  })
})

describe('latestRelease', () => {
  it('asks the GitHub releases API and returns the normalised tag', async () => {
    const f = ok({ tag_name: 'v0.3.1' })
    await expect(latestRelease(f)).resolves.toBe('v0.3.1')
    expect(f).toHaveBeenCalledWith(RELEASE_API, expect.objectContaining({ headers: expect.any(Object) }))
  })
  it('returns null on a non-200 (e.g. rate limited) so the build-time fallback stays', async () => {
    await expect(latestRelease(vi.fn(async () => ({ ok: false, json: async () => ({}) })))).resolves.toBeNull()
  })
  it('returns null when the network throws', async () => {
    await expect(latestRelease(vi.fn(async () => Promise.reject(new Error('offline'))))).resolves.toBeNull()
  })
  it('returns null for a body without a usable tag', async () => {
    await expect(latestRelease(ok(null))).resolves.toBeNull()
    await expect(latestRelease(ok({ tag_name: 'nightly' }))).resolves.toBeNull()
  })
  it('defaults to the global fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v9.9.9' })))
    await expect(latestRelease()).resolves.toBe('v9.9.9')
    spy.mockRestore()
  })
})

describe('mountVersion', () => {
  it('replaces every [data-version] element with the latest tag', async () => {
    document.body.innerHTML = '<a data-version>v0.1.0</a><span data-version>v0.1.0</span>'
    await expect(mountVersion(document, ok({ tag_name: 'v0.2.0' }))).resolves.toBe('v0.2.0')
    expect([...document.querySelectorAll('[data-version]')].map((e) => e.textContent)).toEqual(['v0.2.0', 'v0.2.0'])
  })
  it('keeps the build-time fallback text when the API fails', async () => {
    document.body.innerHTML = '<a data-version>v0.1.0</a>'
    await expect(mountVersion(document, vi.fn(async () => Promise.reject(new Error('x'))))).resolves.toBeNull()
    expect(document.querySelector('[data-version]')!.textContent).toBe('v0.1.0')
  })
  it('does not call the API when the page has no version slot', async () => {
    document.body.innerHTML = '<p>no slot</p>'
    const f = ok({ tag_name: 'v1.0.0' })
    await expect(mountVersion(document, f)).resolves.toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('defaults to the whole document and the global fetch', async () => {
    document.body.innerHTML = '<a data-version>v0.1.0</a>'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v0.4.0' })))
    await expect(mountVersion()).resolves.toBe('v0.4.0')
    expect(document.querySelector('[data-version]')!.textContent).toBe('v0.4.0')
    spy.mockRestore()
  })
})
