# Can anyone buy into a tokenized fund on a permissionless blockchain? TokenOne's pilot vault on Rayls

**Short answer (20 Nov 2026, UTC):** only wallets on the vault's onchain whitelist can request a deposit. A wallet that is not on it is stopped by the vault contract itself, at the first check of a deposit request, before any money moves. A whitelisted wallet passes that check and is stopped only by the next one (ERC20InsufficientAllowance: no token allowance approved). I saw the same answer at three mainnet blocks on 20 Nov 2026, hours apart.

Behind the vault, TokenOne's fund contract values its shares as the BRL1.p it holds (checkable onchain) plus capital its oracle reports. On 20 Nov 2026 at 17:06:59 UTC, day two of the pilot, 99.996% of that value was BRL1.p held in the contract, and the reported part (10.054178 BRL1.p) sits behind two onchain limits. This is a dated token-balance reading: it does not verify BRL1's own reserves or the receivables behind the reported capital.

The token rules TokenOne writes into its contracts (allowlist module, freeze, pause, forced transfer) were tested on Rayls Testnet with TokenOne's own verified code: 47 real transactions (5 setup transactions, then 3 rounds of 14 steps covering 8 tests), every result as planned. An independent checker reads all 47 again from the testnet RPC and re-executes them on a fresh machine; separately, it rejects 8 edited copies of the saved log. A read-only check added after the run shows that a holder removed from the allowlist cannot move its tokens, while the enforcer can still recover them.

Read-only on mainnet. Nothing was deposited. Every testnet transaction was sent by me from fresh test wallets.

## Contents

| Path | What it is |
|---|---|
| `W3-PLAN.md` | Test plan, committed before the first testnet transaction (commit 3e70df4, 19 Nov 2026 19:21:15 UTC). SHA-256 a1ad3502...79ef |
| `W3-PLAN-ADDENDUM-1.md`, `W3-PLAN-ADDENDUM-2.md` | Two procedure changes to the plan hash transaction, both committed before it was sent |
| `mainnet/gate-check.ps1` | Part A: read-only mainnet gate check at one fixed block (Windows PowerShell 5.1) |
| `mainnet/runs/` | Every mainnet run output (text and JSON) and `RUNS.md`, the run register |
| `contracts/TestAllowlistModule.sol` | My own test module for Part B (not TokenOne's module) |
| `source/` | NF01's explorer record: TokenOne's verified CompliantERC20 source and compiler settings |
| `build/` | Compiled artifacts (solc 0.8.24, the settings recorded on the explorer) |
| `bench/` | Part B test bench: a local page plus a small local server; MetaMask signs every transaction |
| `results/bench-log.json` | The full bench log: 47 sent transactions and 5 attempts that were never sent |
| `checker/check.js`, `checker/tamper.js` | Independent checker and tamper tests |
| `MANIFEST.sha256` | SHA-256 of every file in this repository, checked by `checker/manifest.js` in CI |
| `.github/workflows/check.yml` | GitHub Actions: rebuild, checker on Ubuntu and Windows, tamper tests, offline page test |

## Part A: the entry gate on mainnet

Contracts (Rayls Public Chain, chain ID 72957):
- Lagoon vault RLSTKONE02 `0x1811630B90e6966573e809270a5e9316A25DE6fe` (proxy; implementation LagoonVault v0.6.0, verified)
- Asset BRL1.p `0xa069d3798feab32994ac5d98a9f011da6024f334`
- TokenOne fund TKONE02 (RwaVaultV3, verified) `0x870c2c4cfAf895f55163385813164E5808AE7029`

Method: `eth_call` simulations at one fixed block per run. The outsider is my fresh test wallet W3 Outsider `0xe892BF4cf5427254A0d5c410785948137b65bF47`. The control wallet is chosen by a fixed rule: the earliest address a `WhitelistUpdated` event set to true that is still allowed at the run block (it turned out to be `0x4d76...7e22`, the vault's owner until an ownership transfer on 19 Nov). Other wallets are shortened and no wallet balance is printed.

| | G1 | G2 | G3 |
|---|---|---|---|
| Block | 14,847,573 | 14,856,838 | 14,875,135 |
| Block time (UTC) | 2026-11-20 06:48:53 | 2026-11-20 10:16:53 | 2026-11-20 17:06:59 |
| A1 isAllowed(W3 Outsider) | false | false | false |
| A2 deposit request from W3 Outsider | reverts AddressNotAllowed | reverts AddressNotAllowed | reverts AddressNotAllowed |
| A3 isAllowed(control) | true | true | true |
| A4 same request from the control | passes the gate, reverts ERC20InsufficientAllowance | same | same |
| Vault totalAssets (BRL1.p) | 99,935.889926 | 99,935.889926 | 255,281.489244 |
| Share of the 300,000 cap | 33.31% | 33.31% | 85.09% |
| Whitelist events since deployment | 11 added, 1 removed | same | same |
| Deposit settlements | 2 | 2 | 3 (new: 20 Nov 15:12:23, epoch 5, 155,345.599318 BRL1.p) |
| TKONE02 idle BRL1.p | 99,935.883672 | 99,935.883672 | 255,281.482990 |
| TKONE02 reported deployedCapital | 10.054178 | 10.054178 | 10.054178 |
| Report time (UTC) | 2026-11-19 12:11:09 | 2026-11-19 12:11:09 | 2026-11-20 11:46:10 |
| totalAssets = idle + deployedCapital, base units | exact | exact | exact |
| idle = BRL1.p token's balanceOf(TKONE02) | yes | yes | yes |

Numbers are truncated to 6 decimals; the JSON files carry exact base units. Fees read from the vault: management 0, performance 0, entry 0, exit 50 bps, haircut 0. syncMode = SyncDeposit. G1 was executed twice, and an exploratory run on 19 Nov came first; see `mainnet/runs/RUNS.md`.

Why AddressNotAllowed is the whitelist and not something else: in the verified Lagoon v0.6.0 source the first checks of a deposit request are `isAllowed(owner)`, `isAllowed(controller)` and `isAllowed(msg.sender)`. The control wallet, sending the same call, gets past them and stops at the token allowance. Same call, one difference.

## Part B: TokenOne's token rules on Rayls Testnet

TokenOne's debenture token NF01 (`0x36f480c489F4cF6AAcF91C7605504a840060e376`) is a verified CompliantERC20. Its transfer rules: a compliance module decides who may send and receive, an enforcer can freeze balances and force transfers, a pauser can pause.

- B0a: compiling the verified source with the recorded settings gives NF01's onchain runtime bytecode exactly, outside the 8 immutable ranges (7,395 bytes, 0 differ).
- B0b: the testnet copy (`0x52043c8de3355f4e44d22e41bc2dd586580758fa`) is that same compiled code. The module (`0xc2d43fb42ed60c755a0ea7275b6750e4e371a4c7`) is mine, because TokenOne's module implementation is not verified.
- Run: 19 Nov 2026 20:43:38 to 21:04:56 UTC, testnet blocks 24,582,821 to 24,585,147. Wallets W3 Issuer (all roles), W3 Investor, W3 Outsider (never allowlisted except inside T8).

| Test | Change from the baseline | Expected and seen, 3 of 3 rounds |
|---|---|---|
| T1 | none, Investor to Issuer | success |
| T2 | receiver not allowlisted | failed tx, CannotTransfer(Investor, Outsider, 0, 1000000) |
| T3 | mint to a wallet not allowlisted | failed tx, CannotTransfer(0x0, Outsider, 0, 1000000) |
| T4 | Investor frozen | failed tx, InsufficientUnfrozenBalance(Investor, 0, 1000000, 0) |
| T5 | token paused | failed tx, EnforcedPause() |
| T6 | enforcer's forcedTransfer to an allowlisted wallet | success, Transfer + ForcedTransfer |
| T7 | forcedTransfer to a wallet not allowlisted | failed tx, CannotReceive(Outsider) |
| T8 | T2 again with the Outsider allowlisted | success |

47 transactions were mined: 5 setup transactions (S1 to S5), then 3 rounds of 14 steps (the 8 tests T1 to T8 plus their setup and reset steps, for example T4a freeze and T4b unfreeze). 32 succeeded and 15 were mined as failed transactions with the planned error, which is the onchain evidence for each rejection. End state: Investor 991, Issuer 6, Outsider 3 W3GT, supply 1,000, as planned.

## Post-run checks: a holder removed from the allowlist (added 21 Nov 2026)

Read-only `eth_call` simulations added after the run. They are separate from the 47 mined transactions and not part of the pre-registered plan. In every round the Outsider was allowlisted (T8a), received 1 W3GT (T8) and was removed again (T8b), so it ends holding 3 W3GT while not allowlisted. The checker pins one testnet block (the block of its end-state reads), confirms that at that block the Outsider holds 3 W3GT and is not allowlisted (on the testnet and on its local re-execution), then simulates three calls at that block on both, and both must agree:

| Check | Call | Expected and seen |
|---|---|---|
| P1 | Outsider sends 1 W3GT to Investor (`transfer`) | reverts CannotTransfer(Outsider, Investor, 0, 1000000) |
| P2 | Enforcer moves the 3 W3GT from Outsider to Investor (`forcedTransfer`) | success |
| P3 | Control: enforcer's `forcedTransfer` from Investor to the Outsider | reverts CannotReceive(Outsider) |

P2 is also executed on the local copy and rolled back: it emits Transfer(Outsider, Investor, 3000000) and ForcedTransfer(Outsider, Investor, 0, 3000000) and leaves Outsider 0, Investor 994 W3GT. So a revoked holder keeps its balance but cannot move it, and the enforcer can still recover it to an eligible wallet; the receiver check still applies. Pinned blocks in GitHub Actions run 44829607395: testnet block 24,752,234 (Ubuntu job) and 24,752,269 (Windows job), Outsider 3 W3GT and not allowlisted at both. Every later run pins its own block and checks the same state.

Five attempts were never sent and are kept in the log as void: MetaMask refuses a transaction with data to one of its own accounts (19:41:05, 19:42:20, 19:59:43 UTC) and keeps the confirm button disabled for the zero address (cancelled 20:31:49 and 20:39:27 UTC). The two addenda record how the plan hash transaction was moved; the hash finally went to `0xa1ad...e323`, the first 20 bytes of the hash itself (tx `0xb75a6dbc...cabd2`).

## Checker and tamper tests

Two kinds of checks, kept apart: a fresh reconstruction from chain data (the checker reads every transaction, receipt, block and contract code again from the testnet RPC and re-executes everything locally), and checks of the saved log (the tamper tests show that edits to the saved log are caught).

`checker/check.js` recompiles both contracts from source, reads every logged transaction and receipt again from the testnet RPC, checks it against the plan (sender, target, function, arguments) and against the saved log, then re-executes all 47 transactions in order on a fresh local EVM with the same senders and nonces. Status, gas used, events and deployed code must be identical. Revert data comes from that re-execution, so no archive node is needed.

`checker/tamper.js` first requires the untouched log to pass, then edits 8 copies (a status, a hash, a revert, a gas value, a deleted record, a block time, the plan hash, a dropped event). All 8 are rejected.

GitHub Actions runs all five jobs on every push. The run shown in the video, all jobs green: https://github.com/smolderar/rayls-tokenone-vault-gates/actions/runs/44635825447 . Later commits (README, post-run checks) are on the Actions page.

One correction of my own method: the first checker run flagged one mismatch, the plan hash transaction used 22,280 gas on Rayls Testnet but 21,512 in my local EVM. 22,280 is 21,000 + 10 x 128, the calldata floor of EIP-7623 (Prague rules) for 32 non-zero bytes. My local EVM ran the older Cancun rules. With Prague rules all 47 match. The Windows job also failed once because Git changed the plan file's line endings; the workflow now keeps bytes exact.

## Evidence register

| Claim | Evidence | What it shows | What it does not show |
|---|---|---|---|
| A wallet off the whitelist cannot request a deposit | `mainnet/runs/*.txt` A1, A2 | the vault contract rejects it at three blocks | anything about off-chain KYC |
| The rejection comes from the whitelist | A3, A4 plus the verified Lagoon source | same call passes the gate from an allowed wallet | who decides whitelisting or why |
| Fund value = BRL1.p held + reported capital | A8, verified RwaVaultV3 source | the sum is exact and the held part matches BRL1.p's own record | that the reported capital exists off chain, or BRL1's own reserves |
| TokenOne's token code maps each rule to its own error | `results/bench-log.json`, checker output | 24 test transactions (8 tests x 3 rounds) behave as planned | TokenOne's production module rules |
| A revoked holder cannot move its tokens; the enforcer can recover them | post-run checks P1 to P3 | read-only simulations on the testnet end state agree with the local copy | that TokenOne uses the enforcer this way in production |
| The testnet token is TokenOne's code | B0a, B0b | byte-identical runtime outside immutables | that roles or modules are set the same way on mainnet |
| The log is genuine | checker + tamper tests on GitHub Actions | chain, log and a fresh re-execution agree; edits are caught | anything outside the logged transactions |

## Limits

- Off-chain steps (identity check, how receivables are chosen, the redemption window) are taken from the announcement and cannot be verified onchain.
- The vault's whitelist is managed by its operator, the vault is an upgradeable proxy, and the fund's admin can change its report limits. These rules are as strong as those roles.
- The BRL1.p balance is a dated onchain token-balance reading. It does not verify BRL1's reserves behind the bridged token.
- deployedCapital is a reported number. Onchain I can check the report events and the two limits (a maximum report age of 24 hours and a maximum change of 10% per report), not the receivables behind it.
- Scope: Part A covers the vault's deposit request on mainnet; Part B covers the token's transfer rules on testnet.
- Part B uses my test module, not TokenOne's. Not tested: forced transfer while paused or frozen, burns, permit, role changes, the vault's redemption path.

## Reproduce

```
npm ci
node checker/check.js --log results/bench-log.json
node checker/tamper.js --log results/bench-log.json
```
Mainnet gate check on Windows: run `mainnet/RUN-GATE-CHECK.bat`.
