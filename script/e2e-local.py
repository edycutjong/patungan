#!/usr/bin/env python3
"""Click through the core flow in a real browser against a LOCAL anvil fork of QIE mainnet.

Prereqs (use a FRESH fork each run, then `cast rpc evm_mine`; wallets keep QUSDC between runs): anvil fork on :8547 + script/local-flow.sh (deploys, seeds pools 1-4, writes deployments.local.json),
then `npm --prefix web run dev -- --port 5179 --strictPort`. Usage: python3 script/e2e-local.py [screenshot_dir]
The page gets an injected EIP-1193 provider that forwards to anvil, where test accounts are impersonated (no keys).
"""
import json, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

RPC = "http://127.0.0.1:8547"
APP = "http://127.0.0.1:5179"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/patungan-e2e")
OUT.mkdir(parents=True, exist_ok=True)
QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"
ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef"
WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139"
ORG = "0x00000000000000000000000000000000000a11CE"
DAVE = "0x000000000000000000000000000000000000DA7E"
ERIN = "0x000000000000000000000000000000000000E214"
FRAN = "0x000000000000000000000000000000000000F4A2"
PAT = json.load(open("web/public/deployments.local.json"))["deployments"][0]["address"]


def cast(*args):
    return subprocess.run(["cast", *args, "--rpc-url", RPC], check=True, capture_output=True, text=True).stdout.strip()


def send(frm, *args, value=None):
    v = ["--value", value] if value else []
    cast("send", "--unlocked", "--from", frm, *v, *args)


def now():
    return int(cast("block", "latest", "-f", "timestamp"))


def setup():
    for a in (DAVE, ERIN, FRAN, ORG):
        cast("rpc", "anvil_setBalance", a, "0x56BC75E2D63100000")
        cast("rpc", "anvil_impersonateAccount", a)
    send(ERIN, ROUTER, "swapETHForExactTokens(uint256,address[],address,uint256)", "500000", f"[{WQIE},{QUSDC}]", ERIN, str(now() + 600), value="50ether")
    owner = cast("call", "0x9aab56e7727af53A3131985BFB16d845319b7bdc", "domainOwnerByName(string,string)(address)", "test", "qie")
    d = now() + 86400
    send(ORG, PAT, "createPoolByName(string,address,uint96,uint16,uint40,string)", "test", owner, "250000", "2", str(now() + 660), "Tiket konser")  # 5: will expire
    send(ORG, PAT, "createPool(address,uint96,uint16,uint40,string)", owner, "250000", "3", str(d), "Kado ulang tahun")  # 6: cancel with a member
    nxt = int(cast("call", PAT, "nextId()(uint256)").split()[0])
    return nxt - 1, nxt


SHIM = """
window.ethereum = {
  _account: '%s',
  async request({ method, params }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [this._account];
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    const r = await fetch('%s', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || [] }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  },
  on() {},
};
"""


def page_as(browser, account=None):
    ctx = browser.new_context(viewport={"width": 390, "height": 900})
    if account:
        ctx.add_init_script(SHIM % (account.lower(), RPC))
    p = ctx.new_page()
    p.on("console", lambda m: m.type in ("error", "warning") and print("  console:", m.text[:600]))
    return p


def step(name):
    print(f"- {name}")


with sync_playwright() as pw:
    EXP, CAN = setup()
    try:
        b, which = pw.chromium.launch(), "Playwright Chromium"
    except Exception:
        b, which = pw.chromium.launch(channel="chrome"), "installed Google Chrome"  # Playwright's own build missing
    print(f"browser: {which} {b.version}")

    step("no wallet: PAID pool #1 reads with the LUNAS stamp")
    p = page_as(b)
    p.goto(f"{APP}/p/local/1")
    expect(p.locator(".stamp.lunas")).to_be_visible(timeout=15000)
    expect(p.locator(".paidline")).to_contain_text("Paid in full: 0.75 QUSDC to test.qie")
    expect(p.locator(".roster li")).to_have_count(3)
    expect(p.locator(".roster .tag", has_text="paid in QIE")).to_have_count(2)
    p.screenshot(path=OUT / "1-paid-no-wallet.png", full_page=True)

    step("no wallet: join opens the 'how to join' sheet")
    p.goto(f"{APP}/p/local/2")
    expect(p.locator(".status")).to_contain_text("2 of 4 seats paid")
    p.get_by_role("button", name="Join").click()
    expect(p.locator(".joinsheet")).to_contain_text("Open this page in your wallet app")
    p.close()

    step("Dave joins pool #2 paying QIE (quote + 1%, one tx)")
    p = page_as(b, DAVE)
    p.goto(f"{APP}/p/local/2")
    expect(p.locator(".status")).to_contain_text("2 of 4 seats paid", timeout=15000)
    p.get_by_role("button", name="Join").click()
    expect(p.locator(".tabbody .quote")).to_contain_text("QIE Oracle guard (15%)", timeout=15000)
    p.screenshot(path=OUT / "2-join-sheet-qie.png", full_page=True)
    p.get_by_role("button", name="in QIE").click()
    expect(p.locator(".msg")).to_contain_text("Seat paid in QIE", timeout=20000)
    expect(p.locator(".status")).to_contain_text("3 of 4 seats paid", timeout=10000)
    p.screenshot(path=OUT / "3-after-qie-join.png", full_page=True)
    p.close()

    step("Erin pays the last seat in QUSDC (approve, pay) and the LUNAS stamp lands")
    payee = cast("call", "0x9aab56e7727af53A3131985BFB16d845319b7bdc", "domainOwnerByName(string,string)(address)", "test", "qie")
    before = int(cast("call", QUSDC, "balanceOf(address)(uint256)", payee).split()[0])
    p = page_as(b, ERIN)
    p.goto(f"{APP}/p/local/2")
    expect(p.locator(".status")).to_contain_text("3 of 4 seats paid", timeout=15000)
    p.get_by_role("button", name="Join").click()
    p.get_by_role("tab", name="Pay with QUSDC").click()
    p.get_by_role("button", name="1 · Approve").click()
    expect(p.get_by_role("button", name="2 · Pay")).to_be_enabled(timeout=20000)
    p.get_by_role("button", name="2 · Pay").click()
    expect(p.locator(".stamp.lunas")).to_be_visible(timeout=20000)
    expect(p.locator(".paidline")).to_contain_text("Paid in full: 1.00 QUSDC")
    after = int(cast("call", QUSDC, "balanceOf(address)(uint256)", payee).split()[0])
    assert after - before == 1_000_000, (before, after)
    print(f"  payee +{after - before} QUSDC units in Erin's tx")
    p.screenshot(path=OUT / "4-lunas-after-last-seat.png", full_page=True)
    p.close()

    step("Fran joins the short-deadline pool in QIE; Dave joins another; its organizer cancels it and refunds everyone")
    p = page_as(b, FRAN)
    p.goto(f"{APP}/p/local/{EXP}")
    p.get_by_role("button", name="Join").click()
    p.get_by_role("button", name="in QIE").click()
    expect(p.locator(".status")).to_contain_text("1 of 2 seats paid", timeout=20000)
    p.goto(f"{APP}/p/local/{CAN}")
    expect(p.get_by_role("button", name="Cancel pool")).to_have_count(0)  # not the organizer
    p.close()
    p = page_as(b, DAVE)
    p.goto(f"{APP}/p/local/{CAN}")
    p.get_by_role("button", name="Join").click()
    p.get_by_role("button", name="in QIE").click()
    expect(p.locator(".status")).to_contain_text("1 of 3 seats paid", timeout=20000)
    p.close()
    p = page_as(b, ORG)
    p.goto(f"{APP}/p/local/{CAN}")
    p.get_by_role("button", name="Cancel pool").click()
    expect(p.locator(".status")).to_contain_text("CLOSED, refunds available", timeout=20000)
    p.get_by_role("button", name="Refund everyone").click()
    expect(p.locator(".stamp.kembali")).to_be_visible(timeout=20000)
    p.close()

    step("the short pool passes its deadline: Fran gets her money back; the stamp says DIKEMBALIKAN")
    cast("rpc", "evm_increaseTime", "700")
    cast("rpc", "evm_mine")
    p = page_as(b, FRAN)
    p.goto(f"{APP}/p/local/{EXP}")
    expect(p.locator(".status")).to_contain_text("CLOSED, refunds available", timeout=15000)
    p.screenshot(path=OUT / "5-closed-refunds-available.png", full_page=True)
    p.get_by_role("button", name="Get my money back").click()
    expect(p.locator(".stamp.kembali")).to_be_visible(timeout=20000)
    expect(p.locator(".paidline")).to_contain_text("Everyone was refunded: 1 member")
    p.screenshot(path=OUT / "6-dikembalikan.png", full_page=True)
    p.close()

    step("pool #3, refunded in full by local-flow.sh, reads DIKEMBALIKAN")
    p = page_as(b, FRAN)
    p.goto(f"{APP}/p/local/3")  # pool 3: already fully refunded by local-flow.sh
    expect(p.locator(".stamp.kembali")).to_be_visible(timeout=15000)
    p.close()

    step("home lists every pool with its state")
    p = page_as(b)
    p.goto(APP)
    expect(p.locator(".pools li")).to_have_count(CAN, timeout=15000)
    expect(p.locator(".mini.paid")).to_have_count(2)
    p.screenshot(path=OUT / "0-home.png", full_page=True)
    b.close()
print("E2E OK: every step passed")
