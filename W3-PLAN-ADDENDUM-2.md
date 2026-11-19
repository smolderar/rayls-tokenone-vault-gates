# Addendum 2 to W3-PLAN.md

Written 19 Nov 2026 (UTC), before the first test bench transaction was broadcast.
Plan: W3-PLAN.md, SHA-256 a1ad350293bc21f8d5621d1ad68d64b4465ce32336edc0fc6299e7343c1979ef. Replaces change 1 of Addendum 1 (SHA-256 8aa1ceab5a0bbf5266a0a829e3cc2bb2ce38f9b8f064285ec20504aa682826c0).

## Change: recipient of the plan hash transaction (setup step B1.1), second time

Addendum 1 moved the plan hash transaction to the zero address. MetaMask flags the zero address as a burn address and keeps its confirm button ("Review alert") disabled, so that transaction cannot be sent from MetaMask. I cancelled the request at 20:31:49 UTC on 19 Nov 2026. Nothing was sent. The attempt is kept in the bench log as void, together with the three earlier void attempts (19:41:05, 19:42:20 and 19:59:43 UTC, "External transactions to internal accounts cannot include data").

New procedure: the plan hash transaction goes from W3 Issuer to 0xa1ad350293bc21f8d5621d1ad68d64b4465ce323, value 0, data = the SHA-256 of W3-PLAN.md. That address is the first 20 bytes of the same SHA-256, so anyone can re-derive it from the plan. It is not one of my wallets and no one is known to hold a key for it. On 19 Nov 2026 the testnet explorer showed no code, balance or activity for it.

No test, expected result, trial count or pass rule changes.
