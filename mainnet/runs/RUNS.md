# Mainnet gate check runs (Part A of W3-PLAN.md)

Every run is read-only and reads one fixed block. Output files are written by `mainnet/gate-check.ps1` next to the script and copied here unchanged.

| Run | Block | Block time (UTC) | Files | Counts for the plan |
|---|---|---|---|---|
| exploratory | 14,827,521 | 2026-11-19 23:19:44 | gate-run-20261119-231955-block14827521.* | no (19 Nov, first execution of the script) |
| 1 (first execution) | 14,847,542 | 2026-11-20 06:48:11 | gate-run-20261120-064825-block14847542.* | run 1, executed twice |
| 1 (second execution, recorded) | 14,847,573 | 2026-11-20 06:48:53 | gate-run-20261120-064906-block14847573.* | run 1, executed twice |

Run 1 was executed twice, 42 seconds apart, because the terminal font was too small in the first screen recording. Both executions are kept. Apart from the block number they give identical results.
