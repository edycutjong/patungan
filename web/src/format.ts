/** Pure display + state logic for the pool page. No I/O here, so every rule is unit-tested (format.test.ts). */
import { formatUnits } from 'viem'

export const QUSDC_DECIMALS = 6

/** QUSDC base units → "0.25", "2.00", "1,250.50" (always at least 2 decimals, never more than 6). */
export function fmtQusdc(units: bigint): string {
  const [int, frac = ''] = formatUnits(units, QUSDC_DECIMALS).split('.')
  const f = frac.replace(/0+$/, '').padEnd(2, '0')
  return `${Number(int).toLocaleString('en-US')}.${f}`
}

/** QIE wei → "1.7053" (4 decimals, rounded up so a shown maximum is never below the real one). */
export function fmtQie(wei: bigint, digits = 4): string {
  const step = 10n ** BigInt(18 - digits)
  const up = ((wei + step - 1n) / step) * step
  const [int, frac = ''] = formatUnits(up, 18).split('.')
  return `${int}.${frac.padEnd(digits, '0').slice(0, digits)}`
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** English number words for a non-negative integer ("one thousand two hundred fifty"), up to the trillions. */
export function numberWords(n: number): string {
  n = Math.floor(n)
  if (n === 0) return 'zero'
  const words = (x: number): string => {
    if (x === 0) return ''
    if (x < 20) return ONES[x]
    if (x < 100) return `${TENS[Math.floor(x / 10)]} ${words(x % 10)}`
    if (x < 1000) return `${ONES[Math.floor(x / 100)]} hundred ${words(x % 100)}`
    const units: [number, string][] = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]
    const [v, name] = units.find(([u]) => x >= u)! // x ≥ 1000 here, so 'thousand' always matches
    return `${words(Math.floor(x / v))} ${name} ${words(x % v)}`
  }
  return words(n).replace(/\s+/g, ' ').trim()
}

/** "two point two five QUSDC" reading of a QUSDC amount (decimals read digit by digit, as on a receipt). */
export function amountInWords(units: bigint): string {
  const [int, frac] = fmtQusdc(units).replace(/,/g, '').split('.')
  const digits = frac.split('').map((d) => ONES[Number(d)])
  return `${numberWords(Number(int))} point ${digits.join(' ')} QUSDC`
}

export enum Status {
  Open = 0,
  Paid = 1,
  Cancelled = 2,
}

export type PoolKind = 'open' | 'paid' | 'cancelled' | 'closed-empty' | 'refunds-open' | 'partly-refunded' | 'refunded'

export interface PoolFacts {
  status: number
  seats: number
  filled: number
  deadline: bigint
  memberCount: number
  refunded: number
  /** The contract's own isRefundable(); when present it decides open vs closed (chain time, not the device clock). */
  refundable?: boolean
}

/** The state the page shows, in the order design.md §5 fixes: no stamp until it is earned. */
export function poolKind(p: PoolFacts, nowSec: number): PoolKind {
  if (p.status === Status.Paid) return 'paid'
  const closed = p.refundable ?? (p.status === Status.Cancelled || nowSec >= Number(p.deadline))
  if (!closed) return 'open'
  if (p.memberCount === 0) return p.status === Status.Cancelled ? 'cancelled' : 'closed-empty'
  if (p.refunded >= p.memberCount) return 'refunded'
  return p.refunded === 0 ? 'refunds-open' : 'partly-refunded'
}

/** Whether the page may offer Join: an open pool before its deadline, while the escrow holds what it owes (the contract
 * reverts Insolvent otherwise, so a Join button then could only fail). */
export function canJoin(kind: PoolKind, nowSec: number, deadline: bigint, solvent: boolean): boolean {
  return kind === 'open' && nowSec < Number(deadline) && solvent
}

/** The member's maximum for joinWithQIE: the live router quote + 1%, never above the Oracle ceiling. */
export function qieMaxValue(qieIn: bigint, maxAllowed: bigint): bigint {
  const withTolerance = (qieIn * 101n) / 100n
  return withTolerance < maxAllowed ? withTolerance : maxAllowed
}

/**
 * What the QIE tab may offer. A router quote above the Oracle ceiling can never succeed (the contract reverts
 * PriceDeviation), so there is no offer. Otherwise the max is quote + 1%, and `capped` says the Oracle ceiling cut
 * that 1% short (the copy must not then say "1% over this quote").
 */
export type QieOffer = { ok: false } | { ok: true; value: bigint; capped: boolean }
export function qieOffer(qieIn: bigint, maxAllowed: bigint): QieOffer {
  if (qieIn > maxAllowed) return { ok: false }
  const value = qieMaxValue(qieIn, maxAllowed)
  return { ok: true, value, capped: value < (qieIn * 101n) / 100n }
}

const WIB_OFFSET = 7 * 3600

/** "Wed 18 Nov 20:00 UTC+7" for a unix deadline (Jakarta time, UTC+7, no DST; spelled as the offset so a global reader needs no zone shorthand). */
export function fmtWib(deadline: bigint): string {
  const d = new Date((Number(deadline) + WIB_OFFSET) * 1000)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${d.getUTCDate()} ${mon} ${hh}:${mm} UTC+7`
}

/** "2 d 3 h left", "45 min left", "closed". */
export function fmtLeft(deadline: bigint, nowSec: number): string {
  const s = Number(deadline) - nowSec
  if (s <= 0) return 'closed'
  const mins = Math.ceil(s / 60) // round up to whole minutes first, so "1 h 60 min" can't happen
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d} d ${h} h left`
  if (h > 0) return `${h} h ${m} min left`
  return `${m} min left`
}

/** The English status line above the roster. */
export function statusLine(p: PoolFacts & { price: bigint }, nowSec: number): string {
  const seatPrice = `${fmtQusdc(p.price)} QUSDC per seat`
  switch (poolKind(p, nowSec)) {
    case 'open':
      return `${p.filled} of ${p.seats} seats paid · ${seatPrice} · closes ${fmtWib(p.deadline)} · the seller is paid when seat ${p.seats} pays`
    case 'paid':
      return `All ${p.seats} seats paid · ${seatPrice} · the seller was paid in the last seat's transaction`
    case 'cancelled':
      return 'Cancelled by the organizer before anyone joined'
    case 'closed-empty':
      return `Closed at ${fmtWib(p.deadline)} with no seats paid`
    case 'refunds-open':
      return `CLOSED, refunds available · ${p.filled} of ${p.seats} seats were paid · every member gets their QUSDC back`
    case 'partly-refunded':
      return `${p.refunded} of ${p.memberCount} members refunded · the rest can still claim`
    case 'refunded':
      return `Everyone was refunded: ${p.memberCount} member${p.memberCount === 1 ? '' : 's'}`
  }
}

/** Plain sentences for every revert a member can hit (ui.md ErrorLine). */
export function revertSentence(errorName: string | undefined, maxDevBps: number, fallback = ''): string {
  const pct = (maxDevBps / 100).toString()
  const map: Record<string, string> = {
    PoolNotOpen: "This pool is closed: it's full, expired or cancelled.",
    TooManySeats: 'There are not that many seats left. Pick fewer seats.',
    ValueTooLow: 'Send a little more QIE: the price moved.',
    QuoteExpired: 'The price quote expired. Tap again for a fresh one.',
    Insolvent:
      "New seats are paused: this contract holds less QUSDC than it owes its members (QUSDC's issuer can burn tokens). Nothing was sent. Members already in can still take their refunds when refunds open.",
    SwapShort: 'The swap or the return of the unused QIE failed, so nothing moved except the network fee. Try again.',
    ForwardFailed: 'The swap or the return of the unused QIE failed, so nothing moved except the network fee. Try again.',
    PriceDeviation: `QIEDEX's price is more than ${pct}% off the QIE Oracle right now, so the QIE payment is paused to protect you. Pay with QUSDC, or try later.`,
    EXCESSIVE_INPUT_AMOUNT: `QIEDEX's price is more than ${pct}% off the QIE Oracle right now, so the QIE payment is paused to protect you. Pay with QUSDC, or try later.`,
    OracleStale: "The QIE Oracle price is too old to check the swap against, so paying in QIE is paused. Pay with QUSDC.",
    OracleBadPrice: "The QIE Oracle isn't giving a price, so paying in QIE is paused. Pay with QUSDC.",
    TransferShort: 'The QUSDC transfer arrived short. Nothing was seated.',
    NotRefundable: 'Refunds open after the deadline, or once the organizer cancels.',
    NothingToRefund: 'This wallet has nothing to refund in this pool.',
    NotOrganizer: 'Only the organizer can cancel this pool.',
    ERC20InsufficientBalance: "This wallet doesn't hold enough QUSDC for that.",
    ERC20InsufficientAllowance: 'Approve QUSDC first, then pay.',
    UserRejected: 'You cancelled in the wallet. Nothing was sent.',
  }
  return (errorName && map[errorName]) || fallback || 'The transaction failed. Nothing moved except, if it was mined, the network fee.'
}
