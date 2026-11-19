# Test plan: who can buy into TokenOne's pilot vault on the Rayls Public Chain?

Written 19 Nov 2026 (UTC) by Smolder (github.com/smolderar, X @Smolder_AR).
This plan is committed to this repository and its SHA-256 is written onchain (Rayls Testnet) before the first test bench transaction. Results are compared against the expectations below. Nothing in this file is changed after the commit; any change goes into a new, separately hashed addendum.

All times are UTC. All numbers use a dot for decimals and a comma for thousands.

## 1. Question

Rayls Public Chain is permissionless EVM infrastructure: any wallet can send transactions. TokenOne's pilot vault (announced 19 Nov 2026) is meant only for investors who passed TokenOne's identity check. So which contract rules decide who gets in, and which rule produces which rejection?

Sub-questions:

- Q1 (entry gate, mainnet). Does the Lagoon vault RLSTKONE02 reject a deposit request from a wallet that is not whitelisted, and does a whitelisted wallet get past that check?
- Q2 (token rules, testnet). In TokenOne's CompliantERC20 code, which rule produces which error: the compliance module, a freeze, a pause, or the enforcer's forced transfer?
- Q3 (verifiable vs reported). Which vault numbers can be checked onchain, and which rest on a reported value?

## 2. Contracts and wallets

Rayls Public Chain mainnet (chain ID 72957):

- Lagoon vault RLSTKONE02: 0x1811630B90e6966573e809270a5e9316A25DE6fe (EIP-1967 proxy, implementation LagoonVault v0.6.0 0xd04DeaBa7fD06634764CbFfe140011C69063aC77, verified source).
- Vault asset BRL1.p (Bridged BRL1): 0xa069d3798feab32994ac5d98a9f011da6024f334.
- TokenOne fund TKONE02 (RwaVaultV3, verified source): 0x870c2c4cfAf895f55163385813164E5808AE7029.
- CompliantERC20 reference: NF01 0x36f480c489F4cF6AAcF91C7605504a840060e376 (verified source, Solidity 0.8.24).

Rayls Testnet (chain ID 7295799, RPC https://testnet-rpc.rayls.com/, explorer https://testnet-explorer.rayls.com/). Three fresh test wallets, created for this test only:

- W3 Issuer: 0x29aEB2f58044487e60639D87016A0ebC8d096Df1
- W3 Investor: 0xBdcb5A4320636731446617c6A0C2c44873398D5B
- W3 Outsider: 0xe892BF4cf5427254A0d5c410785948137b65bF47

I send every testnet transaction myself in MetaMask. Mainnet checks are read-only (eth_call and logs, no transactions).

## 3. Part A: mainnet entry gate (read-only)

Each run reads everything at one fixed block and prints that block number and its UTC timestamp. Three runs at three different blocks, at least 3 hours apart, on 20 and 21 Nov 2026.

Control wallet rule: the earliest address that a WhitelistUpdated event set to true and that is still isAllowed = true at the run block. It is printed shortened (first 4 and last 4 hex characters). No balances of other wallets are printed.

| ID | Check | Expected result |
|----|-------|-----------------|
| A1 | isAllowed(W3 Outsider) | false |
| A2 | Simulated requestDeposit(1 wei BRL1.p, controller = W3 Outsider, owner = W3 Outsider) sent from W3 Outsider | reverts AddressNotAllowed(address), selector 0x51ee5ed5 |
| A3 | isAllowed(control wallet) | true |
| A4 | Same simulated requestDeposit from the control wallet (controller and owner = control wallet) | does not revert with AddressNotAllowed. Main expectation: reverts ERC20InsufficientAllowance(address,uint256,uint256), selector 0xfb8f41b2, the next check after the gate. If the control wallet has an open allowance, ERC20InsufficientBalance or a successful simulation also count as "passed the gate" and are reported as they are. |
| A5 | Vault state: version, paused, asset, totalAssets, totalSupply, assets per share, maxCap, syncMode, fee rates, owner | descriptive. Expected unless the owner changed them (any change is reported with its event): maxCap 300,000 BRL1.p, fee rates management 0, performance 0, entry 0, exit 50 bps, haircut 0. |
| A6 | WhitelistUpdated history from deployment to the run block | descriptive: number of additions and removals with UTC times, no per-wallet list |
| A7 | SettleDeposit history | descriptive: UTC times. No claim of a fixed daily settlement time unless at least 3 days show it. |
| A8 | Money path: vault safe address, TKONE02 balance of the safe, TKONE02 totalAssets, idle BRL1.p held by TKONE02, deployedCapital, reportedAt, maxReportAge, maxReportDeviationBps | own check: totalAssets = idle BRL1.p + deployedCapital at the same block (base units, exact). Idle BRL1.p is verifiable onchain; deployedCapital is a reported value (Q3). |

Exploratory read-only checks on 18 and 19 Nov 2026 (before this plan) are what led to these expectations. They are reported separately and marked "exploratory". Only runs after this plan's commit count as results.

## 4. Part B: CompliantERC20 rule matrix (Rayls Testnet, real transactions)

### B0. Same code as TokenOne's token

- B0a. Compile the verified NF01 source exactly as recorded on the explorer: solc 0.8.24+commit.e11b9ed9, optimizer on with 200 runs, evmVersion cancun, viaIR false, metadata bytecodeHash ipfs, the explorer's file paths and remappings. Expected: the compiled runtime bytecode equals NF01's onchain runtime bytecode (eth_getCode) except the 8 immutable reference ranges reported by the compiler. The compiler metadata hash at the end is identical.
- B0b. Deploy that compiled creation bytecode on Rayls Testnet. Expected: the testnet runtime bytecode equals the same compiled runtime except the immutable ranges.

### B1. Setup (W3 Issuer sends all)

1. Plan hash: 0-value transaction from W3 Issuer to itself, data = SHA-256 of this file.
2. Deploy TestAllowlistModule (my own test module, source in this repo). Rule: a wallet can send or receive only while allowlisted; mint needs an allowlisted receiver; burn needs an allowlisted sender. It is not TokenOne's module.
3. Deploy CompliantERC20 with name "W3 Gate Test", symbol "W3GT", decimals 6, admin = issuer = enforcer = W3 Issuer, complianceModule = the module from step 2. One address holds all four roles, the same layout as NF01 on mainnet.
4. setAllowlistedBatch([W3 Issuer, W3 Investor], true) on the module.
5. mint(W3 Investor, 1,000 W3GT) = 1,000,000,000 base units.

W3 Outsider is never allowlisted, except inside T8.

### B2. Matrix

Each test changes one factor from the baseline T1. Every test moves 1 W3GT (1,000,000 base units). The whole matrix runs 3 times (rounds R1, R2, R3), in this order inside each round.

| ID | Sender | Action | Expected result |
|----|--------|--------|-----------------|
| T1 | Investor | transfer(Issuer, 1 W3GT). Both allowlisted (baseline) | success, Transfer(Investor, Issuer, 1000000) |
| T2 | Investor | transfer(Outsider, 1 W3GT). Receiver not allowlisted | reverts CannotTransfer(Investor, Outsider, 0, 1000000), selector 0x0522e404 |
| T3 | Issuer | mint(Outsider, 1 W3GT). Primary issuance to a wallet not allowlisted | reverts CannotTransfer(0x0, Outsider, 0, 1000000), selector 0x0522e404 |
| T4 | Issuer, then Investor, then Issuer | setFrozenTokens(Investor, 0, 1,000,000,000,000), then transfer(Issuer, 1 W3GT) from Investor, then setFrozenTokens(Investor, 0, 0) | the transfer reverts InsufficientUnfrozenBalance(Investor, 0, 1000000, 0), selector 0xc92a080d |
| T5 | Issuer, then Investor, then Issuer | pause(), then transfer(Issuer, 1 W3GT) from Investor, then unpause() | the transfer reverts EnforcedPause(), selector 0xd93c0665 |
| T6 | Issuer | forcedTransfer(Investor, Issuer, 1 W3GT) | success, Transfer(Investor, Issuer, 1000000) and ForcedTransfer(Investor, Issuer, 0, 1000000) |
| T7 | Issuer | forcedTransfer(Investor, Outsider, 1 W3GT). Receiver not allowlisted | reverts CannotReceive(Outsider), selector 0x454b3f67 |
| T8 | Issuer, then Investor, then Issuer | setAllowlisted(Outsider, true), then transfer(Outsider, 1 W3GT) from Investor, then setAllowlisted(Outsider, false) | the transfer succeeds, Transfer(Investor, Outsider, 1000000). Same call as T2, only the allowlist entry changed. |

Helper transactions inside T4, T5 and T8 (freeze, unfreeze, pause, unpause, allowlist on and off) must succeed. Per round: 14 transactions. Total: 5 setup + 42 = 47 transactions.

Every matrix transaction is sent with an explicit gas limit of 200,000, so a transaction expected to revert is still broadcast and mined as a failed transaction (receipt status 0). That failed transaction is the onchain evidence.

Before each test transaction the bench logs, at the latest block: paused(), compliance(), getFrozenTokens(Investor, 0), availableBalance(Investor), and for the token movement being tested (from, to): canSend(from), canReceive(to), canTransfer(from, to, 1000000), module isAllowlisted(from) and isAllowlisted(to), plus the W3GT balances of the three wallets. For the mint, from is 0x0 and the two checks on from are skipped. It also logs a preflight eth_call of the exact transaction at the same block. After mining it logs the receipt (status, block, gas used, logs) and the block timestamp in UTC. For a failed transaction it also logs the revert data from replaying the same call at the parent block.

Expected control reads: T2 canReceive(Outsider) false and canTransfer false; T4 availableBalance(Investor) 0; T5 paused true and canTransfer false; T7 canReceive(Outsider) false; T8 canReceive(Outsider) true.

Expected end state after 3 rounds (own reconciliation): W3 Investor 991 W3GT, W3 Issuer 6 W3GT, W3 Outsider 3 W3GT, totalSupply 1,000 W3GT, paused false, frozen 0, Outsider not allowlisted.

## 5. Pass rule, voids and checker

- A test matches when all 3 trials give the expected receipt status and the expected decoded error (or expected events for successes).
- Any mismatch is reported in the README as it is, with its transaction hash. No trial is dropped or silently rerun.
- A trial that fails for a reason outside the test (RPC timeout, wallet rejection before broadcast, nonce problem) is logged as void with the reason. An extra trial replaces it, and every void is listed.
- An independent checker (in this repo) re-reads every logged transaction from the testnet RPC, re-simulates each one at its parent block to decode the revert selector, compares everything with the tables above, re-derives the end balances, and writes a result table. It also runs B0 from fresh chain data.
- Tamper tests: at least 3 edited copies of the saved log (a changed status, a changed transaction hash, a swapped error) must be rejected by the checker.
- The checker also runs on a fresh GitHub Actions runner.

## 6. What this does not test (scope)

- The testnet module is mine. Part B shows how TokenOne's token code maps each rule to an error. It does not show TokenOne's production policy or the internal rules of their own compliance module, whose implementation is not verified.
- Part B runs on Rayls Testnet with my wallets and roles, not on mainnet.
- Part A uses read-only simulations. I make no deposit into the vault and hold no BRL1.p.
- Off-chain steps (TokenOne's identity check, the 60-day redemption window, how receivables are chosen) cannot be verified onchain. They are quoted from TokenOne's announcement and labelled documented.
- deployedCapital is a reported value. Onchain I can check its guards (maximum report age, maximum change per report) and the report events, not the receivables behind it.
- No investor-level data: other wallets are shortened and no per-wallet balances are published.
- Not tested: forcedTransfer while paused or frozen, burns, permit, role changes, the vault's redemption path.
- Wallet funding before this plan (faucet, and two 1 USDr transfers from W3 Issuer at 18:34 UTC on 19 Nov 2026) is not part of the test.

## 7. Outputs

Raw logs (JSON), scripts, the compiled artifacts and standard JSON input, the checker and its result table, tamper-test copies, and a SHA-256 manifest of all files, all in this repository.
