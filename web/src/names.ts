/**
 * Normalise what a person types into the label the QIE Zone registry expects:
 * lowercase, no surrounding spaces, no leading "@", no trailing ".qie". The registry treats
 * "Bob", "bob.qie" and "BOB" as non-existent, so this must run before every lookup.
 */
export function toQieLabel(input: string): string {
  let s = input.trim().toLowerCase()
  if (s.startsWith('@')) s = s.slice(1)
  if (s.endsWith('.qie')) s = s.slice(0, -4)
  return s
}

/** Oracle age in whole hours, for the "price updated N h ago" line. */
export function ageHours(updatedAt: bigint, nowSec: number): number {
  return Math.max(0, Math.floor((nowSec - Number(updatedAt)) / 3600))
}
