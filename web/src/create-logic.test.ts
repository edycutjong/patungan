import { describe, expect, it } from 'vitest'
import { byteLength, checkCreate, isAddress, isBadChecksum, parseQusdc, shareText, unixToWib, whatsappLink, wibToUnix } from './create-logic'

describe('parseQusdc', () => {
  it('reads plain amounts into 6-decimal units', () => {
    expect(parseQusdc('2')).toBe(2_000_000n)
    expect(parseQusdc('0.25')).toBe(250_000n)
    expect(parseQusdc(' 1,250.5 ')).toBe(1_250_500_000n)
    expect(parseQusdc('0.000001')).toBe(1n)
  })
  it('rejects zero, negatives, junk, over-precision and uint96 overflow', () => {
    for (const bad of ['', '0', '0.0', '-1', 'abc', '1.', '.5', '1.2345678', '1e3', '79228162514264337593543951336']) {
      expect(parseQusdc(bad), bad).toBeUndefined()
    }
  })
})

describe('WIB deadline', () => {
  it('reads date+time as UTC+7', () => {
    // 2026-11-18 20:00 WIB = 13:00 UTC
    expect(wibToUnix('2026-11-18', '20:00')).toBe(Date.UTC(2026, 10, 18, 13, 0) / 1000)
  })
  it('round-trips through unixToWib, including across midnight', () => {
    const u = wibToUnix('2026-12-01', '00:30')!
    expect(unixToWib(u)).toEqual({ date: '2026-12-01', time: '00:30' })
  })
  it('rejects malformed input', () => {
    expect(wibToUnix('', '20:00')).toBeUndefined()
    expect(wibToUnix('2026-11-18', '')).toBeUndefined()
    expect(wibToUnix('2026-13-45', '99:99')).toBeUndefined()
  })
})

describe('checkCreate', () => {
  const now = Date.UTC(2026, 10, 18, 0, 0) / 1000
  const ok = { title: 'Futsal Kamis', seats: 12, price: '2', date: '2026-11-20', time: '20:00', chainNow: now }
  it('accepts a normal pool', () => {
    const c = checkCreate(ok)
    expect(c.errors).toEqual({})
    expect(c.price).toBe(2_000_000n)
    expect(c.deadline).toBe(wibToUnix('2026-11-20', '20:00'))
  })
  it('counts the title in bytes, like the contract', () => {
    expect(byteLength('é')).toBe(2)
    expect(checkCreate({ ...ok, title: 'é'.repeat(33) }).errors.title).toMatch(/66 of 64/)
    expect(checkCreate({ ...ok, title: 'é'.repeat(32) }).errors.title).toBeUndefined()
    expect(checkCreate({ ...ok, title: '  ' }).errors.title).toBeDefined()
  })
  it('bounds seats at 2..100', () => {
    expect(checkCreate({ ...ok, seats: 1 }).errors.seats).toBeDefined()
    expect(checkCreate({ ...ok, seats: 101 }).errors.seats).toBeDefined()
    expect(checkCreate({ ...ok, seats: 2.5 }).errors.seats).toBeDefined()
    expect(checkCreate({ ...ok, seats: 100 }).errors.seats).toBeUndefined()
  })
  it('bounds the deadline to 10 minutes .. 90 days from chain time', () => {
    expect(checkCreate({ ...ok, date: '2026-11-18', time: '07:05' }).errors.deadline).toMatch(/10 minutes/) // 00:05 UTC = +5 min
    expect(checkCreate({ ...ok, date: '2026-11-17', time: '08:00' }).errors.deadline).toMatch(/10 minutes/) // in the past
    expect(checkCreate({ ...ok, date: '2027-03-01', time: '08:00' }).errors.deadline).toMatch(/90 days/)
  })
})

describe('share', () => {
  const t = shareText({ title: 'Futsal Kamis', url: 'https://x.test/p/mainnet-1/7', seats: 12, price: 2_000_000n, deadline: wibToUnix('2026-11-20', '20:00')!, payeeLabel: 'lapangan.qie' })
  it('carries both languages, the link, the deadline in WIB and the refund promise', () => {
    expect(t).toContain('Futsal Kamis')
    expect(t).toContain('12 kursi × 2.00 QUSDC')
    expect(t).toContain('Fri 20 Nov 20:00 WIB')
    expect(t).toContain('mengambil kembali QUSDC')
    expect(t).toContain('take their QUSDC back')
    expect(shareText({ title: 'a*b_c', url: 'u', seats: 2, price: 1_000_000n, deadline: 1_800_000_000, payeeLabel: 'x' })).toContain('*abc*')
    expect(t.endsWith('https://x.test/p/mainnet-1/7')).toBe(true)
  })
  it('builds an encoded wa.me link', () => {
    const l = whatsappLink('a b\nc&d')
    expect(l).toBe('https://wa.me/?text=a%20b%0Ac%26d')
  })
})

describe('isAddress', () => {
  it('accepts 20-byte hex only', () => {
    expect(isAddress('0x616F4e1d85D41F34330D3D0D167717c4015E69D7')).toBe(true)
    expect(isAddress(' 0x616F4e1d85D41F34330D3D0D167717c4015E69D7 ')).toBe(true)
    expect(isAddress('0x616F')).toBe(false)
    expect(isAddress('lapangan.qie')).toBe(false)
  })
  it('accepts all-lowercase, rejects a mixed-case address with a wrong checksum', () => {
    expect(isAddress('0x616f4e1d85d41f34330d3d0d167717c4015e69d7')).toBe(true)
    const bad = '0x616F4e1d85D41F34330D3D0D167717c4015E69d7' // last letter case flipped
    expect(isAddress(bad)).toBe(false)
    expect(isBadChecksum(bad)).toBe(true)
    expect(isBadChecksum('0x616F')).toBe(false)
  })
})
