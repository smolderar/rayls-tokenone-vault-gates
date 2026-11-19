# Addendum 1 to W3-PLAN.md

Written 19 Nov 2026 (UTC), before the first test bench transaction was broadcast.
Plan: W3-PLAN.md, SHA-256 a1ad350293bc21f8d5621d1ad68d64b4465ce32336edc0fc6299e7343c1979ef (commit 3e70df4e77aa8eaf12d9ce8f55162319db9c0c68).

## Change 1: recipient of the plan hash transaction (setup step B1.1)

The plan says the plan hash goes onchain as a 0-value transaction from W3 Issuer to itself. MetaMask refused that transaction twice before broadcasting it, with the message "External transactions to internal accounts cannot include data" (19:41:05 and 19:42:20 UTC on 19 Nov 2026). Nothing was sent. Both attempts are kept in the bench log as void.

New procedure: the plan hash transaction goes from W3 Issuer to the zero address 0x0000000000000000000000000000000000000000, value 0, data = the same SHA-256 of W3-PLAN.md.

No test, expected result, trial count or pass rule changes.
