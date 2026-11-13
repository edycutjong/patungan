# Patungan bench on an anvil fork of QIE mainnet (fork block 11880681, pool contract 0x00490d1ae862aaa4a202ab920d709905738ea519)

| call | runs | gas p50 | gas p95 | gas max |
|---|---|---|---|---|
| deploy | 1 | 2,990,231 | 2,990,231 | 2,990,231 |
| createPool | 5 | 128,841 | 145,941 | 145,941 |
| createPoolByName | 5 | 160,564 | 160,564 | 160,564 |
| joinWithQIE (1 seat) | 4 | 236,389 | 298,261 | 298,261 |
| joinWithQIE (any) | 12 | 236,389 | 246,961 | 298,261 |
| joinWithQIE (2 seats) | 4 | 236,389 | 236,389 | 236,389 |
| joinWithQIE (4 seats) | 4 | 236,389 | 246,961 | 246,961 |
| join (QUSDC) | 6 | 74,681 | 136,172 | 136,172 |
| cancel (with members) | 1 | 32,930 | 32,930 | 32,930 |
| claimRefund | 1 | 78,010 | 78,010 | 78,010 |
| refundAll (batch of 13 remaining members) | 1 | 255,420 | 255,420 | 255,420 |

## Swap cost per QIE join (net native QIE out of the wallet, fee excluded, vs the Oracle's fair value for the same QUSDC)

| seats | QUSDC | router quote (QIE) | Oracle fair (QIE) | paid (QIE) | paid vs Oracle | paid vs quote |
|---|---|---|---|---|---|---|
| 1 | 0.25 | 1.7118 | 1.6164 | 1.7118 | +5.90% | +0.00% |
| 2 | 0.50 | 3.4241 | 3.2328 | 3.4241 | +5.92% | +0.00% |
| 4 | 1.00 | 6.8506 | 6.4655 | 6.8506 | +5.96% | +0.00% |
| 1 | 0.25 | 1.7131 | 1.6164 | 1.7131 | +5.99% | +0.00% |
| 2 | 0.50 | 3.4269 | 3.2328 | 3.4269 | +6.00% | +0.00% |
| 4 | 1.00 | 6.8561 | 6.4655 | 6.8561 | +6.04% | +0.00% |
| 1 | 0.25 | 1.7145 | 1.6164 | 1.7145 | +6.07% | +0.00% |
| 2 | 0.50 | 3.4296 | 3.2328 | 3.4296 | +6.09% | +0.00% |
| 4 | 1.00 | 6.8616 | 6.4655 | 6.8616 | +6.13% | +0.00% |
| 1 | 0.25 | 1.7159 | 1.6164 | 1.7159 | +6.16% | +0.00% |
| 2 | 0.50 | 3.4324 | 3.2328 | 3.4324 | +6.17% | +0.00% |
| 4 | 1.00 | 6.8671 | 6.4655 | 6.8671 | +6.21% | +0.00% |

Paid vs Oracle over 12 QIE joins: median +606 bps, min +590, max +621 bps (the deployed guard is 1,500 bps).
After the refunds: isSolvent = true, totalHeld = 0 (expect true / 0).

Fork state moves run to run (live pair reserves, Oracle updates). Run on a FRESH anvil fork: a fork whose clock was pushed forward with evm_increaseTime can make QIE joins revert (stale Oracle read). Reproduce: header of script/bench.py.
