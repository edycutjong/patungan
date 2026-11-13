# Security review notes

Static analysis: Slither (`slither . --filter-paths "lib|test|script"`), 101 detectors, 17 results on `src/`. Every external entry point that moves funds is `nonReentrant`. Mutation checks and 71 forge tests (fuzz, invariants, mainnet fork) back the triage below.

| Detector | Impact | Where | Triage |
|---|---|---|---|
| reentrancy-eth / reentrancy-balance | High | `joinWithQIE`, `_swapIn` | **False positive.** `joinWithQIE` is `nonReentrant`; the swap output is checked against a balance delta (`SwapShort`) and the QIE spent is bounded by the oracle ceiling. Change is refunded last. |
| reentrancy-no-eth | Medium | `refundAll` | **Accepted.** `nonReentrant`; `_debit` runs before the transfer and `_credit` restores on failure (`RefundFailed`), so accounting stays equal to the token balance (invariant test). |
| uninitialized-local `ok` | Medium | `refundAll` | **False positive.** `bool ok` defaults to false by design: a failed or reverted transfer is treated as not refunded. |
| unused-return (router swap) | Medium | `_swapIn` | **Accepted.** Return value replaced by an explicit balance-delta check. |
| unused-return (oracle) | Medium | `_fairQie` | **Accepted.** Round id and timestamps we do not need are dropped; `answer > 0` and staleness (`maxOracleAge`) are enforced. |
| calls-loop | Low | `refundAll` | **Accepted.** Paged by `from`/`count`; one failing member emits `RefundFailed` and cannot block the others. |
| timestamp | Low | create / join / refund | **Accepted.** Deadlines are hours to days; block-time manipulation of seconds is immaterial. |
| reentrancy-benign | Low | `joinWithQIE` | **Accepted.** `nonReentrant`. |
| costly-loop, low-level-calls, naming-convention | Info | `_debit`/`_credit`, change refund, `WETH()` | **Accepted.** Change refund uses `call` and reverts on failure (`ForwardFailed`); `WETH()` mirrors the router's interface. |

## Residual risks (not fixable in this contract)
- QUSDC has privileged roles of its own (a vault role can burn); an issuer action could affect held funds.
- The QIEDEX router source is unverified on the explorer; the contract bounds its use by the Oracle ceiling and a balance-delta check.
- The Oracle feed is QIE/USDT, treated as USD.
