import { describe, expect, it } from 'vitest'
import {
  fmtLeft,
  fmtQie,
  fmtQusdc,
  fmtWib,
  poolKind,
  qieMaxValue,
  revertSentence,
  statusLine,
  terbilang,
  terbilangQusdc,
} from './format'

const base = { status: 0, seats: 5, filled: 2, deadline: 1_000_000n, memberCount: 2, refunded: 0 }

describe('amounts', () => {
  it('formats QUSDC with at least two decimals', () => {
    expect(fmtQusdc(250_000n)).toBe('0.25')
    expect(fmtQusdc(2_000_000n)).toBe('2.00')
    expect(fmtQusdc(1_250_500_000n)).toBe('1,250.50')
    expect(fmtQusdc(1n)).toBe('0.000001')
  })
  it('rounds QIE up so a shown maximum is never low', () => {
    expect(fmtQie(1_705_325_786_053_952_078n)).toBe('1.7054')
    expect(fmtQie(2_000_000_000_000_000_000n)).toBe('2.0000')
  })
  it('caps the QIE value at the Oracle ceiling', () => {
    expect(qieMaxValue(100n, 1_000n)).toBe(101n)
    expect(qieMaxValue(100n, 100n)).toBe(100n)
  })
})

describe('terbilang', () => {
  it('reads Indonesian numbers', () => {
    expect(terbilang(0)).toBe('nol')
    expect(terbilang(11)).toBe('sebelas')
    expect(terbilang(15)).toBe('lima belas')
    expect(terbilang(100)).toBe('seratus')
    expect(terbilang(1250)).toBe('seribu dua ratus lima puluh')
    expect(terbilang(2_500_000)).toBe('dua juta lima ratus ribu')
  })
  it('reads a QUSDC amount as on a receipt', () => {
    expect(terbilangQusdc(2_250_000n)).toBe('dua koma dua lima QUSDC')
    expect(terbilangQusdc(750_000n)).toBe('nol koma tujuh lima QUSDC')
  })
})

describe('pool state', () => {
  it('is open before the deadline', () => {
    expect(poolKind(base, 999_999)).toBe('open')
  })
  it('stamps LUNAS only when paid', () => {
    expect(poolKind({ ...base, status: 1, filled: 5 }, 2_000_000)).toBe('paid')
  })
  it('says refunds are available, then k of m, then DIKEMBALIKAN only when everyone is refunded', () => {
    expect(poolKind(base, 1_000_000)).toBe('refunds-open')
    expect(poolKind({ ...base, refunded: 1 }, 1_000_000)).toBe('partly-refunded')
    expect(poolKind({ ...base, refunded: 2 }, 1_000_000)).toBe('refunded')
  })
  it('separates a cancel with nobody in it from a cancel with refunds', () => {
    expect(poolKind({ ...base, status: 2, filled: 0, memberCount: 0 }, 0)).toBe('cancelled')
    expect(poolKind({ ...base, status: 2 }, 0)).toBe('refunds-open')
    expect(poolKind({ ...base, filled: 0, memberCount: 0 }, 1_000_000)).toBe('closed-empty')
  })
  it("trusts the contract's refundable flag over a skewed clock", () => {
    expect(poolKind({ ...base, refundable: false }, 5_000_000)).toBe('open')
    expect(poolKind({ ...base, refundable: true }, 0)).toBe('refunds-open')
  })
  it('writes the English status line', () => {
    const line = statusLine({ ...base, price: 2_000_000n, filled: 4 }, 0)
    expect(line).toContain('4 of 5 seats paid')
    expect(line).toContain('2.00 QUSDC per seat')
    expect(line).toContain('the seller is paid when seat 5 pays')
    expect(statusLine({ ...base, price: 1n, refunded: 1 }, 2_000_000)).toBe(
      '1 of 2 members refunded · the rest can still claim',
    )
  })
})

describe('time', () => {
  it('shows the deadline in WIB (UTC+7)', () => {
    // 2026-11-18 13:00:00Z = Wed 20:00 WIB
    expect(fmtWib(BigInt(Date.UTC(2026, 10, 18, 13, 0, 0) / 1000))).toBe('Wed 18 Nov 20:00 WIB')
  })
  it('counts down', () => {
    expect(fmtLeft(100n, 100)).toBe('closed')
    expect(fmtLeft(3_000n, 0)).toBe('50 min left')
    expect(fmtLeft(90_000n, 0)).toBe('1 d 1 h left')
    expect(fmtLeft(7_170n, 0)).toBe('2 h 0 min left') // 1 h 59 min 30 s rounds up without '60 min'
  })
})

describe('revert sentences', () => {
  it('maps contract errors to plain words, with the deployed guard', () => {
    expect(revertSentence('PriceDeviation', 1500)).toContain('more than 15% off the QIE Oracle')
    expect(revertSentence('PoolNotOpen', 1500)).toBe("This pool is closed: it's full, expired or cancelled.")
    expect(revertSentence(undefined, 1500)).toContain('The transaction failed')
  })
})
