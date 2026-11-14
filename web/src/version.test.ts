import { describe, expect, it } from 'vitest'
import { formatVersion, pickVersion } from './version'

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

describe('pickVersion', () => {
  it('takes the first candidate that parses, in priority order', () => {
    expect(pickVersion('v0.5.1', 'v0.4.0', '0.1.0')).toBe('v0.5.1')
    expect(pickVersion(undefined, 'v0.4.0', '0.1.0')).toBe('v0.4.0')
  })
  it('skips junk such as an empty env var or a non-tag git describe', () => {
    expect(pickVersion('', 'nightly', '0.1.0')).toBe('v0.1.0')
  })
  it('falls back to v0.0.0 when nothing parses, so the footer never shows a raw placeholder', () => {
    expect(pickVersion()).toBe('v0.0.0')
    expect(pickVersion(undefined, null, 'latest')).toBe('v0.0.0')
  })
})
