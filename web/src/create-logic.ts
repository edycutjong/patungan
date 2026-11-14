/** Pure helpers for the create form (S3) and the share sheet: no DOM, no network, all unit-tested. */
import { isAddress as viemIsAddress } from 'viem'
import { fmtQusdc, fmtWib } from './format'

export const MIN_SEATS = 2
export const MAX_SEATS = 100
export const MAX_TITLE_BYTES = 64
/** Contract bounds on the deadline (Patungan.MIN_DURATION / MAX_DURATION). */
export const MIN_DURATION_S = 10 * 60
export const MAX_DURATION_S = 90 * 24 * 3600
const UINT96_MAX = (1n << 96n) - 1n
const WIB_OFFSET_S = 7 * 3600

export const byteLength = (s: string) => new TextEncoder().encode(s).length

/** "2", "0.25", "1,250.5" → QUSDC base units (6 decimals); undefined when it is not a positive amount the contract accepts. */
export function parseQusdc(input: string): bigint | undefined {
  const s = input.trim().replace(/,/g, '')
  const m = s.match(/^(\d+)(?:\.(\d{1,6}))?$/)
  if (!m) return undefined
  const units = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))
  return units > 0n && units <= UINT96_MAX ? units : undefined
}

/** A `<input type=date>` + `<input type=time>` value read as Indonesia Western Time (UTC+7, no DST) → unix seconds. */
export function wibToUnix(date: string, time: string): number | undefined {
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const t = time.match(/^(\d{2}):(\d{2})$/)
  if (!d || !t) return undefined
  const [y, mo, da, hh, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]]
  const ms = Date.UTC(y, mo - 1, da, hh, mi)
  const back = new Date(ms) // Date.UTC rolls 13/45 over silently; reject anything that doesn't read back the same
  if (hh > 23 || mi > 59 || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) return undefined
  return ms / 1000 - WIB_OFFSET_S
}

/** Unix seconds → the `date` and `time` input values in WIB. */
export function unixToWib(unix: number): { date: string; time: string } {
  const iso = new Date((unix + WIB_OFFSET_S) * 1000).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
}

export interface CreateInput {
  title: string
  seats: number
  price: string
  date: string
  time: string
  /** Chain time in unix seconds (latest block), never the device clock. */
  chainNow: number
}

export interface CreateChecked {
  errors: Partial<Record<'title' | 'seats' | 'price' | 'deadline', string>>
  price?: bigint
  deadline?: number
}

/** Mirrors the contract's BadParams checks so the form says what is wrong before a wallet is opened. */
export function checkCreate(i: CreateInput): CreateChecked {
  const errors: CreateChecked['errors'] = {}
  if (!i.title.trim()) errors.title = 'Give the pool a name, e.g. "Thursday football".'
  else if (byteLength(i.title) > MAX_TITLE_BYTES) errors.title = `The name is too long (${byteLength(i.title)} of ${MAX_TITLE_BYTES} bytes).`
  if (!Number.isInteger(i.seats) || i.seats < MIN_SEATS || i.seats > MAX_SEATS) errors.seats = `Seats must be ${MIN_SEATS} to ${MAX_SEATS}.`
  const price = parseQusdc(i.price)
  if (price === undefined) errors.price = 'Enter a price per seat in QUSDC, up to 6 decimals, e.g. 2 or 0.25.'
  const deadline = wibToUnix(i.date, i.time)
  if (deadline === undefined) errors.deadline = 'Pick a deadline date and time (UTC+7).'
  else if (deadline < i.chainNow + MIN_DURATION_S + 60) errors.deadline = 'The deadline must be at least 10 minutes from now.'
  else if (deadline > i.chainNow + MAX_DURATION_S - 60) errors.deadline = 'The deadline can be at most 90 days from now.'
  return { errors, price, deadline }
}

/** The WhatsApp message: English first, then one Indonesian line for the group. Says plainly what happens to the money. */
export function shareText(p: { title: string; url: string; seats: number; price: bigint; deadline: number; payeeLabel: string }): string {
  const price = fmtQusdc(p.price)
  const title = p.title.replace(/[*_~`]/g, '') // WhatsApp formatting characters would break the bold title
  const when = fmtWib(BigInt(p.deadline))
  return [
    `*${title}* — ${p.seats} seats × ${price} QUSDC`,
    `Join before ${when}. The last seat pays ${p.payeeLabel} in the same transaction; if the pool doesn't fill, every member can take their QUSDC back from the pool page.`,
    ``,
    `🇮🇩 Bayar kursimu sebelum ${fmtWibId(p.deadline)}. Kursi terakhir langsung membayar ${p.payeeLabel}; kalau tidak penuh, tiap anggota bisa mengambil kembali QUSDC-nya dari halaman patungan.`,
    p.url,
  ].join('\n')
}

const ID_DAY = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const ID_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
/** "Sel 17 Nov 20:00 WIB": the one Indonesian line of the share text. */
export function fmtWibId(deadline: number): string {
  const d = new Date((deadline + WIB_OFFSET_S) * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${ID_DAY[d.getUTCDay()]} ${d.getUTCDate()} ${ID_MON[d.getUTCMonth()]} ${hh}:${mm} WIB`
}

export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

/** A usable 0x address: 20 bytes, and if it is mixed-case its EIP-55 checksum must match (viem rejects it otherwise). */
export const isAddress = (s: string) => viemIsAddress(s.trim())

/** 0x + 40 hex but failing the checksum: a typo or a bad copy, worth its own sentence. */
export const isBadChecksum = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim()) && !isAddress(s)

/** Gas drip amount (F13): gas only, never seat money. */
export const GAS_DRIP_WEI = 20_000_000_000_000_000n // 0.02 QIE
