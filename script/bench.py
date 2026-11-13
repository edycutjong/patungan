#!/usr/bin/env python3
"""Reproducible gas + slippage bench on a LOCAL anvil fork of QIE mainnet (real QIEDEX / Oracle / Zone / QUSDC state).

  anvil --fork-url https://rpc1mainnet.qie.digital/ --chain-id 1990 --port 8547 &
  python3 script/bench.py [rpc] > evidence/bench-run.txt        # also writes evidence/bench.md

Deploys a fresh Patungan with the deploy defaults (maxDevBps 1500, maxOracleAge 172800), then measures from real receipts:
 - gas per call (createPool, createPoolByName, join, joinWithQIE for 1/2/4 seats, claimRefund, refundAll), p50 / p95 over N runs
 - for every QIE join: QIE actually spent (Joined.qieSpent) vs the Oracle's fair value for the same QUSDC and vs the router quote
Impersonated throwaway accounts; refuses anything that is not an anvil node on chain 1990. Fork state moves run to run.
"""
import json, statistics, subprocess, sys

RPC = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8547"
QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"
ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef"
ZONE = "0x9aab56e7727af53A3131985BFB16d845319b7bdc"
ORACLE = "0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17"
WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139"
ORG = "0x00000000000000000000000000000000000a11CE"
SEAT = 250_000


def cast(*a, check=True):
    r = subprocess.run(["cast", a[0], "--rpc-url", RPC, *a[1:]], capture_output=True, text=True)
    if check and r.returncode:
        raise SystemExit(f"cast {' '.join(a[:3])} failed: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def num(s):
    return int(s.split()[0])


def now():
    return int(cast("block", "latest", "-f", "timestamp"))


def send(frm, *a, value=None):
    v = ["--value", str(value)] if value is not None else []
    out = json.loads(cast("send", "--unlocked", "--json", "--from", frm, *v, *a))
    r = json.loads(cast("receipt", "--json", out["transactionHash"]))
    if r["status"] not in ("0x1", 1, "1"):
        sim = subprocess.run(["cast", "call", "--rpc-url", RPC, "--from", frm, *v, *a], capture_output=True, text=True)
        raise SystemExit(f"reverted: {a[:2]} -> {(sim.stderr or sim.stdout).strip()[:300]}")
    return r


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


assert cast("chain-id") == "1990", "not a chain-1990 fork"
assert cast("rpc", "anvil_nodeInfo", check=False), "not an anvil node; refusing"

accts = [f"0x{i:040x}" for i in range(0xB000, 0xB000 + 14)]
for a in [ORG, *accts]:
    cast("rpc", "anvil_setBalance", a, "0x3635C9ADC5DEA00000")  # 1000 QIE
    cast("rpc", "anvil_impersonateAccount", a)

block = cast("block-number")
bc = subprocess.run(["forge", "inspect", "src/Patungan.sol:Patungan", "bytecode"], capture_output=True, text=True, check=True).stdout.strip()
args = subprocess.run(["cast", "abi-encode", "f(address,address,address,address,uint256,uint256)", QUSDC, ROUTER, ZONE, ORACLE, "1500", "172800"], capture_output=True, text=True, check=True).stdout.strip()
r = send(ORG, "--create", bc + args[2:])
PAT = r["contractAddress"]
gas = {"deploy": [int(r["gasUsed"], 16)]}
owner = cast("call", ZONE, "domainOwnerByName(string,string)(address)", "test", "qie")
D = now() + 30 * 86400


def rec(name, r):
    gas.setdefault(name, []).append(int(r["gasUsed"], 16))


# create costs
for i in range(5):
    rec("createPool", send(ORG, PAT, "createPool(address,uint96,uint16,uint40,string)", owner, str(SEAT), "100", str(D), f"bench {i}"))
    rec("createPoolByName", send(ORG, PAT, "createPoolByName(string,address,uint96,uint16,uint40,string)", "test", owner, str(SEAT), "100", str(D), f"bench name {i}"))
pool = num(cast("call", PAT, "nextId()(uint256)"))  # the last createPoolByName: 100 seats, still empty

# QIE joins: 1, 2, 4 seats, from fresh wallets; value = router quote + 1% (what the page sends)
rows = []
for i, n in enumerate([1, 2, 4] * 4):
    who = accts[i]
    q, fair, cap = (num(x) for x in cast("call", PAT, "quoteQIE(uint256,uint16)(uint256,uint256,uint256)", str(pool), str(n)).splitlines()[:3])
    bal0 = num(cast("balance", who))
    r = send(who, PAT, "joinWithQIE(uint256,uint16,uint40)", str(pool), str(n), str(now() + 300), value=q * 101 // 100)
    rec(f"joinWithQIE ({n} seat{'s' if n > 1 else ''})", r)
    rec("joinWithQIE (any)", r)
    spent = (num(cast("balance", who)) - bal0) * -1 - int(r["gasUsed"], 16) * int(r["effectiveGasPrice"], 16)  # native QIE net of the fee
    rows.append((n, q, fair, spent))

# QUSDC joins
for i in range(6):
    who = accts[12 + i % 2]  # two wallets, repeat joins
    cast("rpc", "anvil_setBalance", who, "0x3635C9ADC5DEA00000")
    send(who, ROUTER, "swapETHForExactTokens(uint256,address[],address,uint256)", str(SEAT), f"[{WQIE},{QUSDC}]", who, str(now() + 600), value=50 * 10**18)
    send(who, QUSDC, "approve(address,uint256)", PAT, str(SEAT))
    rec("join (QUSDC)", send(who, PAT, "join(uint256,uint16)", str(pool), "1"))

# refunds: cancel the pool (it has members), then one claim and a batch
rec("cancel (with members)", send(ORG, PAT, "cancel(uint256)", str(pool)))
rec("claimRefund", send(accts[0], PAT, "claimRefund(uint256)", str(pool)))
rec("refundAll (batch of 13 remaining members)", send(ORG, PAT, "refundAll(uint256,uint256,uint256)", str(pool), "0", "25"))
solvent = cast("call", PAT, "isSolvent()(bool)")
held = num(cast("call", PAT, "totalHeld()(uint256)"))

lines = [f"# Patungan bench on an anvil fork of QIE mainnet (fork block {block}, pool contract {PAT})", ""]
lines += ["| call | runs | gas p50 | gas p95 | gas max |", "|---|---|---|---|---|"]
for k, v in gas.items():
    lines.append(f"| {k} | {len(v)} | {int(pct(v, .5)):,} | {int(pct(v, .95)):,} | {max(v):,} |")
lines += ["", "## Swap cost per QIE join (net native QIE out of the wallet, fee excluded, vs the Oracle's fair value for the same QUSDC)", "",
          "| seats | QUSDC | router quote (QIE) | Oracle fair (QIE) | paid (QIE) | paid vs Oracle | paid vs quote |", "|---|---|---|---|---|---|---|"]
prem = []
for n, q, fair, spent in rows:
    prem.append((spent - fair) * 10_000 / fair)
    lines.append(f"| {n} | {n * SEAT / 1e6:.2f} | {q / 1e18:.4f} | {fair / 1e18:.4f} | {spent / 1e18:.4f} | {(spent - fair) * 100 / fair:+.2f}% | {(spent - q) * 100 / q:+.2f}% |")
lines += ["", f"Paid vs Oracle over {len(prem)} QIE joins: median {statistics.median(prem):+.0f} bps, min {min(prem):+.0f}, max {max(prem):+.0f} bps (the deployed guard is 1,500 bps).",
          f"After the refunds: isSolvent = {solvent}, totalHeld = {held} (expect true / 0).", "",
          "Fork state moves run to run (live pair reserves, Oracle updates). Reproduce: see the header of script/bench.py."]
out = "\n".join(lines)
print(out)
open("evidence/bench.md", "w").write(out + "\n")
