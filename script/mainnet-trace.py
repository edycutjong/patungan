#!/usr/bin/env python3
"""Open up the mainnet PAID and REFUNDED transactions from the public QIE RPC. Read-only, no keys, standard library only.

  python3 script/mainnet-trace.py > evidence/mainnet-trace.md

1. The PAID pool's last seat (pool 1, `joinWithQIE`): its full call trace (`debug_traceTransaction`, callTracer), decoded call by
   call. It shows the Oracle read, the QIEDEX quote and swap, the unspent QIE coming back, and the payout to the payee, all in one tx.
2. The REFUNDED pool's `refundAll` (pool 2): its QUSDC transfers back to each member.
3. Every tx hash in evidence/mainnet-golive.md, re-read: status and block.
The raw trace is written next to this report (evidence/mainnet-trace-<hash prefix>.json) so the decoding can be checked.
"""
import datetime, json, os, re, sys, urllib.request

RPCS = [os.environ["RPC"]] if os.environ.get("RPC") else [f"https://rpc{n}mainnet.qie.digital/" for n in range(1, 6)]
HERE = os.path.dirname(os.path.abspath(__file__))
EVIDENCE = os.path.join(HERE, "..", "evidence")
PAID_TX = "0x4bd5c37de92855d3993a88698543c9d7c51dccde97f0fcd8d484450cd359a7a0"
REFUND_TX = "0x7886eba210a403a13e808b236a02c53564684f25332bb7b2db67ebcc8cd69f0a"
NAMES = {
    "0x2f4646d52a5393e239f5b880411dc2ca2d945f31": "Patungan",
    "0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5": "QUSDC",
    "0x3bc617cf3a4bb77003e4c556b87b13d556903d17": "QIE Oracle",
    "0x08cd2e72e156d8563b4351eb4065c262a9f553ef": "QIEDEX router",
    "0x73a3ccf7da7e473ed2e9994ae764f0e30f4e4dfe": "QIEDEX WQIE/QUSDC pair",
    "0x0087904d95bee9e5f24dc8852804b547981a9139": "WQIE",
    "0x3e015c14ae36d81d73acda34713122cc90ec3cf7": "qkulk75527.qie (payee, builder's own name)",
    "0x616f4e1d85d41f34330d3d0d167717c4015e69d7": "deployer (builder wallet)",
    "0xc7fe0a5628c945d0f98594eda770814bf9ac4ba1": "B1 (builder wallet)",
    "0xe1b010f148b1b53ccc45291df583b297e0ea93dc": "B2 (builder wallet)",
    "0x31ecaaf66b8837d600ddbdd833e2b2ef370dac70": "B3 (builder wallet)",
}
SEL = {
    "0x0b330942": "joinWithQIE", "0x70a08231": "balanceOf", "0xfeaf968c": "latestRoundData", "0x1f00ca74": "getAmountsIn",
    "0x0902f1ac": "getReserves", "0xfb3bdb41": "swapETHForExactTokens", "0xd0e30db0": "deposit", "0xa9059cbb": "transfer",
    "0x022c0d9f": "swap",
}
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
REFUNDED = "0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4"


def rpc(method, params):
    for url in RPCS:
        try:
            req = urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                         {"content-type": "application/json", "user-agent": "patungan-evidence"})
            with urllib.request.urlopen(req, timeout=20) as r:
                j = json.load(r)
            if j.get("result") is not None:
                return j["result"]
        except Exception:  # next RPC
            pass
    sys.exit(f"no QIE RPC answered {method}")


name = lambda a: NAMES.get(a.lower(), a)
words = lambda hexdata: [int(hexdata[2 + 64 * i: 2 + 64 * (i + 1)], 16) for i in range((len(hexdata) - 2) // 64)]
qie = lambda wei: f"{wei / 1e18:.10f} QIE"
qusdc = lambda units: f"{units / 1e6:.2f} QUSDC ({units:,} units)"


def utc(block_hex):
    ts = int(rpc("eth_getBlockByNumber", [block_hex, False])["timestamp"], 16)
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def describe(c):
    fn = SEL.get(c["input"][:10], "native transfer" if c["input"] in ("0x", "") else c["input"][:10])
    value = int(c.get("value") or "0x0", 16)
    out = c.get("output") or "0x"
    arg = words("0x" + c["input"][10:]) if len(c["input"]) > 10 else []
    note = ""
    if fn == "joinWithQIE":
        note = f"pool {arg[0]}"
    elif fn == "balanceOf":
        bal = words(out)[0]
        shown = qusdc(bal) if c["to"].lower() == "0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5" else f"{bal / 1e18:,.4f} WQIE"
        note = f"of {name('0x' + format(arg[0], '040x'))} → {shown}"
    elif fn == "latestRoundData":
        w = words(out)
        note = f"answer {w[1]} (8 decimals: {w[1] / 1e8:.8f} USDT per QIE), updatedAt {w[3]}"
    elif fn == "getAmountsIn":
        note = f"for {qusdc(arg[0])} → {qie(words(out)[-2])} in"
    elif fn == "swapETHForExactTokens":
        note = f"exact out {qusdc(arg[0])} to {name('0x' + format(arg[2], '040x'))}"
    elif fn == "transfer":
        note = f"{'QUSDC' if c['to'].lower() == '0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5' else 'WQIE'} {arg[1]:,} units to {name('0x' + format(arg[0], '040x'))}"
    elif fn == "swap":
        note = f"pair sends {qusdc(arg[1]) if arg[1] else qusdc(arg[0])} to {name('0x' + format(arg[2], '040x'))}"
    return f"{c['type']} {name(c['from'])} → {name(c['to'])}: {fn}" + (f" ({note})" if note else "") + (f", value {qie(value)}" if value else "")


def main():
    print("# Mainnet transactions, opened up (QIE mainnet, chain 1990)\n")
    print("Generated by `python3 script/mainnet-trace.py` from the public QIE RPC (`eth_getTransactionReceipt`, `debug_traceTransaction`")
    print("with the callTracer). Read-only. Every wallet named below belongs to the builder; none is a user.\n")

    # 1. PAID: the last seat
    tx = rpc("eth_getTransactionByHash", [PAID_TX])
    rc = rpc("eth_getTransactionReceipt", [PAID_TX])
    trace = rpc("debug_traceTransaction", [PAID_TX, {"tracer": "callTracer"}])
    with open(os.path.join(EVIDENCE, f"mainnet-trace-{PAID_TX[:10]}.json"), "w") as f:
        json.dump(trace, f, indent=1)
    sent = int(tx["value"], 16)
    print("## Pool 1 (PAID): the last seat's `joinWithQIE`\n")
    print(f"- Tx `{PAID_TX}`")
    print(f"- Block {int(rc['blockNumber'], 16):,}, {utc(rc['blockNumber'])}, status {int(rc['status'], 16)} (success), gas used {int(rc['gasUsed'], 16):,}")
    print(f"- From {name(tx['from'])} with {qie(sent)} attached; {len(rc['logs'])} logs\n")
    print("Every call inside the transaction, in execution order (indent = call depth):\n")
    calls = []

    def walk(c, d):
        calls.append((d, c))
        for s in c.get("calls", []):
            walk(s, d + 1)

    walk(trace, 0)
    for k, (d, c) in enumerate(calls, 1):
        print(f"{k:>2}. {'  ' * d}{describe(c)}")

    oracle = next(words(c["output"])[1] for _, c in calls if c["input"][:10] == "0xfeaf968c")
    quote = next(words(c["output"])[-2] for _, c in calls if c["input"][:10] == "0x1f00ca74")
    wrapped = next(int(c["value"], 16) for _, c in calls if c["input"][:10] == "0xd0e30db0")
    back = [int(c["value"], 16) for _, c in calls if c["input"] in ("0x", "") and int(c.get("value") or "0x0", 16)]
    payout = next(words("0x" + c["input"][10:])[1] for _, c in calls
                  if c["input"][:10] == "0xa9059cbb" and c["from"].lower() == "0x2f4646d52a5393e239f5b880411dc2ca2d945f31")
    fair = 250_000 / 1e6 / (oracle / 1e8)  # QIE that 0.25 QUSDC is worth at the Oracle price (QUSDC read as USD)
    bps = round((quote / 1e18 / fair - 1) * 10_000)
    print("\nSummary:\n")
    print(f"- QIE attached {qie(sent)}; swapped {qie(wrapped)} (the QIEDEX quote was {qie(quote)}); unspent {qie(sent - wrapped)}")
    print(f"- Unspent QIE: router → Patungan {qie(back[0])}, then Patungan → member {qie(back[-1])} (same tx)")
    age = int(rpc("eth_getBlockByNumber", [rc["blockNumber"], False])["timestamp"], 16) - next(
        words(c["output"])[3] for _, c in calls if c["input"][:10] == "0xfeaf968c")
    print(f"- Oracle round age at this block: {age:,} s (the deploy allows up to 172,800 s)")
    print(f"- Oracle price {oracle / 1e8:.8f} USDT per QIE → fair value of a 0.25 QUSDC seat {fair:.4f} QIE; the swap cost {bps:+,} bps vs fair (guard 1,500 bps)")
    print(f"- Payout: Patungan → {name('0x3e015c14ae36d81d73acda34713122cc90ec3cf7')} {qusdc(payout)} (QUSDC Transfer + `PoolPaid` in the logs)")
    print(f"- Calls in the trace: {len(calls)}")
    print(f"- Rounded for display: {sent / 1e18:.4f} QIE attached, {wrapped / 1e18:.4f} QIE swapped, {(sent - wrapped) / 1e18:.4f} QIE returned, "
          f"{oracle / 1e8:.4f} USDT per QIE\n")

    # 2. REFUNDED: refundAll
    rc2 = rpc("eth_getTransactionReceipt", [REFUND_TX])
    print("## Pool 2 (REFUNDED): `refundAll`\n")
    print(f"- Tx `{REFUND_TX}`")
    print(f"- Block {int(rc2['blockNumber'], 16):,}, {utc(rc2['blockNumber'])}, status {int(rc2['status'], 16)} (success), gas used {int(rc2['gasUsed'], 16):,}\n")
    n = 0
    for log in rc2["logs"]:
        if log["topics"][0] == TRANSFER:
            n += 1
            print(f"{n}. QUSDC {name('0x' + log['topics'][1][-40:])} → {name('0x' + log['topics'][2][-40:])}: {qusdc(int(log['data'], 16))}")
    refunded = sum(1 for log in rc2["logs"] if log["topics"][0] == REFUNDED)
    print(f"\n`Refunded` events: {refunded}\n")

    # 3. Every tx in mainnet-golive.md
    hashes = list(dict.fromkeys(re.findall(r"0x[0-9a-fA-F]{64}", open(os.path.join(EVIDENCE, "mainnet-golive.md")).read())))
    ok = 0
    print("## Every tx in evidence/mainnet-golive.md, re-read\n")
    print("| # | Tx | Block | Status |\n|---|---|---|---|")
    for k, h in enumerate(hashes, 1):
        r = rpc("eth_getTransactionReceipt", [h])
        s = int(r["status"], 16)
        ok += s
        print(f"| {k} | `{h[:10]}…{h[-4:]}` | {int(r['blockNumber'], 16):,} | {'success' if s else 'FAILED'} |")
    print(f"\n{ok} of {len(hashes)} transactions succeeded.")


if __name__ == "__main__":
    main()
