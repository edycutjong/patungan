#!/usr/bin/env python3
"""Builder demo pools for the evidence folder: one that FILLS and auto-pays, one that EXPIRES and is refunded.

  set -a; . ~/.config/patungan/mainnet-deployer.env; set +a
  python3 script/seed-demo.py paid                 # 2-seat pool, last seat (paid in QIE) pays the payee in the same tx
  python3 script/seed-demo.py refund               # 3 seats paid of 6, deadline passes, refundAll, everyone refunded
  RPC=http://127.0.0.1:8547 DEP_ID=local MANIFEST=web/public/deployments.local.json python3 script/seed-demo.py paid   # fork rehearsal

All wallets are the builders': throwaway keys generated into BUILDER_ENV (default ~/.config/patungan/builder-wallets.env, mode
0600, outside the repo), funded from the deployer. Every tx hash + gas is printed as a Markdown table for evidence/. Seats cost
0.25 QUSDC each (~1.7 QIE at the 2026-11-14 quote). Keys are never printed. Wallets and the payee are labelled "builder wallet".
"""
import json, os, subprocess, sys, time

MODE = sys.argv[1] if len(sys.argv) > 1 else ""
assert MODE in ("paid", "refund"), "usage: seed-demo.py paid|refund"
RPC = os.environ.get("RPC", "https://rpc1mainnet.qie.digital/")
DEP_ID = os.environ.get("DEP_ID", "mainnet-1")
MANIFEST = os.environ.get("MANIFEST", "web/public/deployments.json")
BUILDER_ENV = os.path.expanduser(os.environ.get("BUILDER_ENV", "~/.config/patungan/builder-wallets.env"))
FUND_QIE = os.environ.get("FUND_QIE", "4")  # per builder wallet: the swap sends up to 3 QIE for a 0.25 QUSDC seat (~1.7 is spent, the rest comes back) + gas
QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"
ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef"
WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139"
SEAT = 250_000
KEY = os.environ["DEPLOYER_PRIVATE_KEY"]
PAT = next(d for d in json.load(open(MANIFEST))["deployments"] if d["id"] == DEP_ID)["address"]


def cast(sub, *a, key=None, check=True):
    k = ["--private-key", key] if key else []
    r = subprocess.run(["cast", sub, "--rpc-url", RPC, *k, *a], capture_output=True, text=True)
    if check and r.returncode:
        raise SystemExit(f"cast {sub} {a[:2]} failed: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


rows = []


def tx(label, key, *a, value=None):
    v = ["--value", str(value)] if value is not None else []
    out = json.loads(cast("send", "--json", *v, *a, key=key))
    r = json.loads(cast("receipt", "--json", out["transactionHash"]))
    if r["status"] not in ("0x1", 1, "1"):
        raise SystemExit(f"{label} reverted: {out['transactionHash']}")
    rows.append((label, out["transactionHash"], int(r["gasUsed"], 16)))
    return r


def created_id(receipt):
    """The pool id from this tx's own PoolCreated log (never nextId(): another user's create could land in between)."""
    topic0 = subprocess.run(["cast", "keccak", "PoolCreated(uint256,address,address,string,uint96,uint16,uint40,string)"], capture_output=True, text=True, check=True).stdout.strip().lower()
    for lg in receipt["logs"]:
        if lg["address"].lower() == PAT.lower() and lg["topics"][0].lower() == topic0:
            return int(lg["topics"][1], 16)
    raise SystemExit("no PoolCreated log in the create receipt")


def now():
    return int(cast("block", "latest", "-f", "timestamp"))


def wallets(n):
    keys = {}
    if os.path.exists(BUILDER_ENV):
        for line in open(BUILDER_ENV):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                keys[k] = v
    changed = False
    for i in range(1, n + 1):
        if f"B{i}_KEY" not in keys:
            w = json.loads(subprocess.run(["cast", "wallet", "new", "--json"], capture_output=True, text=True, check=True).stdout)
            w = (w["data"] if isinstance(w, dict) else w)[0]  # newer cast wraps the result in {"data": [...]}
            keys[f"B{i}_KEY"], keys[f"B{i}_ADDR"] = w["private_key"], w["address"]
            changed = True
    if changed:
        os.makedirs(os.path.dirname(BUILDER_ENV), exist_ok=True)
        fd = os.open(BUILDER_ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write("# patungan builder wallets (labelled 'builder wallet' everywhere). Never print, never commit.\n")
            for k, v in keys.items():
                f.write(f"{k}={v}\n")
    return [(keys[f"B{i}_ADDR"], keys[f"B{i}_KEY"]) for i in range(1, n + 1)]


def seat_qusdc(who, k, pool, n=1):
    tx(f"{who[:8]} buys {n * SEAT / 1e6:.2f} QUSDC (QIEDEX)", k, ROUTER, "swapETHForExactTokens(uint256,address[],address,uint256)", str(n * SEAT),
       f"[{WQIE},{QUSDC}]", who, str(now() + 600), value=3 * 10**18)  # the router refunds the unused QIE in the same tx
    tx(f"{who[:8]} approves QUSDC", k, QUSDC, "approve(address,uint256)", PAT, str(n * SEAT))
    tx(f"{who[:8]} join({pool}) in QUSDC", k, PAT, "join(uint256,uint16)", str(pool), str(n))


def seat_qie(who, k, pool, n=1):
    q = int(cast("call", PAT, "quoteQIE(uint256,uint16)(uint256,uint256,uint256)", str(pool), str(n)).splitlines()[0].split()[0])
    tx(f"{who[:8]} joinWithQIE({pool}) (quote {q / 1e18:.4f} QIE + 1%)", k, PAT, "joinWithQIE(uint256,uint16,uint40)", str(pool), str(n), str(now() + 300), value=q * 101 // 100)


nb = 3 if MODE == "refund" else 2
ws = wallets(nb + 1)  # B1..Bnb are members, the last is the payee
payee = ws[-1][0]
for a, _ in ws[:nb]:
    tx(f"fund {a[:8]} with {FUND_QIE} QIE", KEY, a, value=int(float(FUND_QIE) * 10**18))

seats, title, dl = (2, "Rehearsal PAID (builder wallets)", 3600) if MODE == "paid" else (6, "Badminton Sabtu (builder wallets)", 900)
created = tx(f"createPool '{title}' {seats} x 0.25 QUSDC", KEY, PAT, "createPool(address,uint96,uint16,uint40,string)", payee, str(SEAT), str(seats), str(now() + dl), title)
pool = created_id(created)
before = int(cast("call", QUSDC, "balanceOf(address)(uint256)", payee).split()[0])

if MODE == "paid":
    seat_qusdc(*ws[0], pool)
    seat_qie(*ws[1], pool)  # the last seat, paid in QIE: swap + payout in ONE tx
    got = int(cast("call", QUSDC, "balanceOf(address)(uint256)", payee).split()[0]) - before
    assert got == 2 * SEAT, f"payee got {got}, expected {2 * SEAT}"
    print(f"RESULT pool {pool} PAID: payee {payee} +{got} QUSDC units in the last seat's tx")
else:
    seat_qusdc(*ws[0], pool)
    seat_qusdc(*ws[1], pool)
    seat_qie(*ws[2], pool)
    left = now()
    print(f"pool {pool} has 3 of 6 seats; deadline in {dl} s (chain time {left}); waiting for it to pass", flush=True)
    if os.environ.get("FORK_WARP"):
        cast("rpc", "evm_increaseTime", str(dl + 60))
        cast("rpc", "evm_mine")
    while cast("call", PAT, "isRefundable(uint256)(bool)", str(pool)) == "false":
        time.sleep(20)
    tx(f"refundAll({pool})", KEY, PAT, "refundAll(uint256,uint256,uint256)", str(pool), "0", "25")
    rc = cast("call", PAT, "refundedCount(uint256)(uint256)", str(pool))
    print(f"RESULT pool {pool} REFUNDED: refundedCount {rc} of 3 members; isSolvent {cast('call', PAT, 'isSolvent()(bool)')}")

print("\n| step | tx | gas |\n|---|---|---|")
for label, h, g in rows:
    print(f"| {label} | {h} | {g:,} |")
doc = json.load(open(MANIFEST))
for d in doc["deployments"]:
    if d["id"] == DEP_ID:
        have = {a.lower() for a in d.get("builderWallets", [])}
        d["builderWallets"] = d.get("builderWallets", []) + [a for a, _ in ws if a.lower() not in have]
json.dump(doc, open(MANIFEST, "w"), indent=2)
print(f"\nbuilder wallets (added to {MANIFEST} builderWallets, so every roster labels them): {', '.join(a for a, _ in ws)}")
