#!/usr/bin/env python3
"""Browser click-through of the organizer side against a LOCAL anvil fork of QIE mainnet: /new (live .qie resolve, field
errors, create by name and by address, share sheet), the organizer gas drip, and /verify.

Prereqs as script/e2e-local.py (anvil fork on :8547, script/local-flow.sh, `npm --prefix web run dev -- --port 5179 --strictPort`).
Usage: python3 script/e2e-create.py [screenshot_dir]. Test accounts are impersonated on anvil (no keys).
"""
import json, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

RPC = "http://127.0.0.1:8547"
APP = "http://127.0.0.1:5179"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/patungan-e2e-create")
OUT.mkdir(parents=True, exist_ok=True)
ZONE = "0x9aab56e7727af53A3131985BFB16d845319b7bdc"
ORG = "0x00000000000000000000000000000000000a11CE"
DAVE = "0x000000000000000000000000000000000000DA7E"
NEWBIE = "0x000000000000000000000000000000000000be11"
SELLER = "0x00000000000000000000000000000000005e11e4"
PAT = json.load(open("web/public/deployments.local.json"))["deployments"][0]["address"]

SHIM = open("script/e2e-local.py").read().split('SHIM = """')[1].split('"""')[0]


def cast(*args):
    return subprocess.run(["cast", *args, "--rpc-url", RPC], check=True, capture_output=True, text=True).stdout.strip()


def page_as(browser, account=None):
    ctx = browser.new_context(viewport={"width": 390, "height": 900})
    if account:
        ctx.add_init_script(SHIM % (account.lower(), RPC))
    p = ctx.new_page()
    p.on("console", lambda m: m.type in ("error", "warning") and print("  console:", m.text[:600]))
    return p


def step(name):
    print(f"- {name}")


def next_id():
    return int(cast("call", PAT, "nextId()(uint256)").split()[0])


with sync_playwright() as pw:
    for a in (ORG, DAVE, NEWBIE):
        cast("rpc", "anvil_setBalance", a, "0x56BC75E2D63100000")
        cast("rpc", "anvil_impersonateAccount", a)
    try:
        b = pw.chromium.launch()
    except Exception:
        b = pw.chromium.launch(channel="chrome")
    owner = cast("call", ZONE, "domainOwnerByName(string,string)(address)", "test", "qie")

    step("/new with no wallet: the form renders, creating says to open a wallet app")
    p = page_as(b)
    p.goto(f"{APP}/new")
    expect(p.locator("h1")).to_contain_text("Buat patungan")
    p.fill("input[name=title]", "Tanpa dompet")
    p.fill("input[name=payee]", "test.qie")
    expect(p.locator(".resolve")).to_contain_text("resolves to", timeout=15000)
    p.get_by_role("button", name="Create pool").click()
    expect(p.locator(".msg")).to_contain_text("wallet app")
    p.close()

    step("/new as the organizer: live .qie resolve, and field errors before any tx")
    n0 = next_id()
    p = page_as(b, ORG)
    p.goto(f"{APP}/new")
    p.fill("input[name=payee]", "nosuchname-zzz9")
    expect(p.locator(".resolve")).to_contain_text("is not registered", timeout=15000)
    p.fill("input[name=title]", "   ")
    p.fill("input[name=seats]", "1")
    p.fill("input[name=price]", "0")
    p.get_by_role("button", name="Create pool").click()
    expect(p.locator("[data-err=title]")).to_contain_text("Give the pool a name")
    expect(p.locator("[data-err=seats]")).to_contain_text("2 to 100")
    expect(p.locator("[data-err=price]")).to_contain_text("price per seat")
    expect(p.locator("[data-err=payee]")).to_have_text("")  # one message only: the resolve line already says "not registered"
    expect(p.locator(".resolve")).to_contain_text("is not registered")
    assert next_id() == n0, "a form error must not send a transaction"
    p.screenshot(path=OUT / "1-new-errors.png", full_page=True)

    step("create by .qie name → share sheet with WhatsApp text and link")
    p.fill("input[name=title]", "Futsal Kamis")
    p.fill("input[name=seats]", "4")
    p.fill("input[name=price]", "0.25")
    p.fill("input[name=payee]", "TEST.qie")  # case-insensitive input
    expect(p.locator(".resolve")).to_contain_text("test.qie resolves to", timeout=15000)
    p.screenshot(path=OUT / "2-new-filled.png", full_page=True)
    p.get_by_role("button", name="Create pool").click()
    expect(p.locator("#shared .sharetext")).to_contain_text("Futsal Kamis", timeout=30000)
    pid = next_id()
    assert pid == n0 + 1
    expect(p.locator(".sharetext")).to_contain_text(f"/p/local/{pid}")
    expect(p.locator("#create")).to_have_count(0)  # the form is gone after a create: no second tx from a stray tap
    expect(p.locator("#shared")).to_contain_text(f"Pool #{pid} created")
    expect(p.locator(".sharetext")).to_contain_text("take their QUSDC back")
    expect(p.locator(".sharetext")).to_contain_text("4 kursi × 0.25 QUSDC")
    href = p.get_by_role("link", name="Share on WhatsApp").get_attribute("href")
    assert href.startswith("https://wa.me/?text="), href
    p.screenshot(path=OUT / "3-share-sheet.png", full_page=True)
    pool = cast("call", PAT, "getPool(uint256)((address,address,uint96,uint40,uint16,uint16,uint8,uint256),string,string,uint256,uint256)", str(pid))
    assert owner.lower() in pool.lower() and "Futsal Kamis" in pool and '"test"' in pool, pool
    print(f"  pool #{pid} on chain: payee = test.qie owner, title Futsal Kamis")

    step("create by plain address (createPool), payee label is the short address")
    p.goto(f"{APP}/new")
    p.fill("input[name=title]", "Kado")
    p.fill("input[name=payee]", "0x616F4e1d85D41F34330D3D0D167717c4015E69d7")  # wrong checksum
    expect(p.locator(".resolve")).to_contain_text("checksum", timeout=10000)
    p.fill("input[name=payee]", SELLER)
    expect(p.locator(".resolve")).to_contain_text("A plain address", timeout=10000)
    p.get_by_role("button", name="Create pool").click()
    expect(p.locator("#shared .sharetext")).to_contain_text("Kado", timeout=30000)
    assert next_id() == pid + 1
    p.close()

    step("organizer gas drip: 0.02 QIE to a member address; members don't see it")
    p = page_as(b, ORG)
    p.goto(f"{APP}/p/local/{pid}")
    expect(p.locator(".status")).to_contain_text("0 of 4 seats paid", timeout=15000)
    expect(p.locator("#drip")).to_be_visible(timeout=15000)
    before = int(cast("balance", NEWBIE))
    p.fill("#drip input", "not an address")
    p.get_by_role("button", name="Send 0.02 QIE").click()
    expect(p.locator("#drip .msg")).to_contain_text("0x address")
    p.fill("#drip input", NEWBIE)
    p.wait_for_timeout(5000)  # a poll repaint must not wipe the typed address
    assert p.input_value("#drip input") == NEWBIE
    p.get_by_role("button", name="Send 0.02 QIE").click()
    expect(p.locator("#drip .msg")).to_contain_text("Sent 0.02 QIE for gas", timeout=20000)
    after = int(cast("balance", NEWBIE))
    assert after - before == 20_000_000_000_000_000, (before, after)
    print(f"  recipient +{after - before} wei (0.02 QIE)")
    p.screenshot(path=OUT / "4-gas-drip.png", full_page=True)
    p.close()
    p = page_as(b, DAVE)
    p.goto(f"{APP}/p/local/{pid}")
    expect(p.locator(".acct")).to_be_visible(timeout=15000)
    expect(p.locator("#drip")).to_have_count(0)
    p.close()

    step("/verify: contract, four components, solvency, latest events")
    p = page_as(b)
    p.goto(f"{APP}/verify")
    expect(p.locator(".vaddr")).to_contain_text(PAT, timeout=20000)
    expect(p.locator("dl").first).to_contain_text("yes")
    expect(p.locator(".events li").first).to_contain_text("PoolCreated", timeout=20000)
    for addr in ("0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef", ZONE, "0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17"):
        expect(p.locator("body")).to_contain_text(addr)
    expect(p.locator("body")).to_contain_text("3.6 s")
    p.screenshot(path=OUT / "5-verify.png", full_page=True)

    step("home has the create button")
    p.goto(f"{APP}/pools")
    p.get_by_role("link", name="Start a pool").click()
    expect(p.locator("h1")).to_contain_text("Buat patungan")
    b.close()
print("E2E CREATE OK: every step passed")
