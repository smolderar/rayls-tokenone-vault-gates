# Mainnet gate check runs (Part A of W3-PLAN.md)

Every run is read-only and reads one fixed block. Output files are written by `mainnet/gate-check.ps1` next to the script and copied here unchanged. Event history (WhitelistUpdated, SettleDeposit) always covers blocks 14,731,249 (the vault's first log, 18 Nov 2026 11:24:12 UTC) up to the run block.

| Run | Block | Block time (UTC) | Files | Counts for the plan |
|---|---|---|---|---|
| exploratory | 14,827,521 | 2026-11-19 23:19:44 | gate-run-20261119-231955-block14827521.* | no (19 Nov, first execution of the script) |
| G1, first execution | 14,847,542 | 2026-11-20 06:48:11 | gate-run-20261120-064825-block14847542.* | run 1 |
| G1, second execution (recorded) | 14,847,573 | 2026-11-20 06:48:53 | gate-run-20261120-064906-block14847573.* | run 1 |
| G2 (recorded) | 14,856,838 | 2026-11-20 10:16:53 | gate-run-20261120-101708-block14856838.* | run 2 |
| G3 (recorded) | 14,875,135 | 2026-11-20 17:06:59 | gate-run-20261120-170716-block14875135.* | run 3 |

Notes:
- G1 was executed twice, 42 seconds apart, because the terminal font was too small in the first screen recording. Both executions are kept. Apart from the block number they give identical results.
- The plan asked for three runs at least 3 hours apart "on 20 and 21 Nov". All three ran on 20 Nov: G1 to G2 is 3 h 28 min, G2 to G3 is 6 h 50 min.
- The entry gate (A1 to A4) gave the same answer at every block. Between G2 and G3 the vault settled a third deposit round (20 Nov 15:12:23 UTC, epoch 5) and the fund's oracle posted a new report (20 Nov 11:46:10 UTC); see the files.
