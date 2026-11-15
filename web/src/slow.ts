/**
 * When QIE's public RPCs stop answering, viem's fallback walks five endpoints, each with a retry and an 8 s timeout,
 * before it gives up: far longer than anyone waits on a blank page. The read pages say so after SLOW_MS instead,
 * and keep the read running: if it lands later, it paints over the notice.
 */
export const SLOW_MS = 4_000

/** Calls `onSlow` once if `work` has not settled after `ms`. Never rejects; the caller still awaits `work` itself. */
export function whenSlow(work: Promise<unknown>, onSlow: () => void, ms = SLOW_MS): void {
  const t = setTimeout(onSlow, ms)
  const stop = () => clearTimeout(t)
  work.then(stop, stop)
}

/** The read pages only read the chain; an unreachable network can never have sent anything. */
export const NOTHING_SENT = 'Nothing was sent and no money moved: this page only reads the chain.'
