// Independent checker for the W3 CompliantERC20 rule matrix on Rayls Testnet.
//
// What it does (read-only, it never signs or sends anything to a public network):
//  1. Recompiles both contracts from source (solc 0.8.24, the settings recorded on the explorer for NF01).
//  2. Reads every logged transaction and receipt again from the testnet RPC and checks them against the plan
//     (sender, target, function, arguments) and against the saved bench log (hash, status, block, gas, logs, data).
//  3. Re-executes all transactions, in order, on a fresh local EVM (Hardhat, chain ID 7295799, the same senders and
//     nonces) and requires the same status, gas used, logs and deployed code as the testnet. Revert data for the
//     failed transactions comes from this re-execution, so no archive node is needed.
//  4. Checks the end state, the plan hash transaction, and B0 (compiled code vs NF01 on mainnet and vs testnet).
// Usage: node checker/check.js --log results/bench-log.json [--rpc URL] [--mainnet-rpc URL | --skip-mainnet] [--out DIR]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ethers } = require('ethers');
const solc = require('solc');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = name => argv.includes(name);
const LOG = opt('--log', path.join(ROOT, 'results/bench-log.json'));
const RPC = opt('--rpc', 'https://testnet-rpc.rayls.com/');
const MAINNET = opt('--mainnet-rpc', 'https://mainnet-rpc.rayls.com');
const SKIP_MAINNET = flag('--skip-mainnet');
const OUT = opt('--out', path.join(ROOT, 'results'));
const QUIET = flag('--quiet');

const NF01 = '0x36f480c489F4cF6AAcF91C7605504a840060e376';
const NF01_RECORD = path.join(ROOT, 'source/contract-0x36f480c489f4cf6aacf91c7605504a840060e376.json');
const W = { Issuer: '0x29aEB2f58044487e60639D87016A0ebC8d096Df1', Investor: '0xBdcb5A4320636731446617c6A0C2c44873398D5B', Outsider: '0xe892BF4cf5427254A0d5c410785948137b65bF47' };
const ZERO = ethers.ZeroAddress;
const U1 = 1000000n, FREEZE_ALL = 1000000000000n;
const fmt = n => BigInt(n).toLocaleString('en-US');
const lc = a => String(a).toLowerCase();

// ───────── output helpers ─────────
const problems = [];
const lines = [];
function say(s) { lines.push(s); if (!QUIET) console.log(s); }
function fail(where, msg) { problems.push(`${where}: ${msg}`); lines.push(`  FAIL ${where}: ${msg}`); console.log(`  FAIL ${where}: ${msg}`); }

// ───────── JSON-RPC ─────────
let rid = 0;
async function rpc(url, method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
      const j = await r.json();
      return j;
    } catch (e) { if (attempt === 3) throw e; await new Promise(r => setTimeout(r, 1500)); }
  }
}
async function rpcResult(url, method, params) { const j = await rpc(url, method, params); if (j.error) throw new Error(`${method}: ${j.error.message}`); return j.result; }
function revertDataOf(err) {
  const stack = [err]; const seen = new Set();
  while (stack.length) { const x = stack.pop(); if (x == null) continue;
    if (typeof x === 'string') { if (/^0x[0-9a-fA-F]{8,}$/.test(x)) return x.toLowerCase(); continue; }
    if (typeof x === 'object' && !seen.has(x)) { seen.add(x); for (const v of Object.values(x)) stack.push(v); } }
  return null;
}

// ───────── compile from source ─────────
function compile() {
  const rec = JSON.parse(fs.readFileSync(NF01_RECORD, 'utf8'));
  const sources = { [rec.file_path]: { content: rec.source_code } };
  for (const s of rec.additional_sources) sources[s.file_path] = { content: s.source_code };
  const settings = JSON.parse(JSON.stringify(rec.compiler_settings));
  settings.outputSelection = { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } };
  const out1 = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
  if ((out1.errors || []).some(e => e.severity === 'error')) throw new Error('NF01 source does not compile');
  const tok = out1.contracts[rec.file_path][rec.name];
  const modSources = { 'TestAllowlistModule.sol': { content: fs.readFileSync(path.join(ROOT, 'contracts/TestAllowlistModule.sol'), 'utf8') },
    'interfaces/ICompliance.sol': sources['interfaces/ICompliance.sol'] };
  const modSettings = JSON.parse(JSON.stringify(settings)); delete modSettings.remappings;
  const out2 = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: modSources, settings: modSettings })));
  if ((out2.errors || []).some(e => e.severity === 'error')) throw new Error('TestAllowlistModule does not compile');
  const mod = out2.contracts['TestAllowlistModule.sol'].TestAllowlistModule;
  const pack = c => ({ abi: c.abi, creation: '0x' + c.evm.bytecode.object, runtime: '0x' + c.evm.deployedBytecode.object,
    ranges: Object.values(c.evm.deployedBytecode.immutableReferences).flat().map(r => [r.start, r.length]) });
  return { version: solc.version(), token: pack(tok), module: pack(mod), compilerVersion: rec.compiler_version };
}
function compareCode(onchain, compiled, ranges) {
  const a = onchain.replace(/^0x/, '').toLowerCase(), b = compiled.replace(/^0x/, '').toLowerCase();
  if (a.length !== b.length) return { same: false, note: `length ${a.length / 2} vs ${b.length / 2}` };
  const mask = new Uint8Array(b.length / 2); for (const [s, l] of ranges) for (let i = s; i < s + l; i++) mask[i] = 1;
  let out = 0; for (let i = 0; i < b.length / 2; i++) if (!mask[i] && a.substr(2 * i, 2) !== b.substr(2 * i, 2)) out++;
  return { same: out === 0, bytes: b.length / 2, ranges: ranges.length, differOutside: out };
}

// ───────── the plan (W3-PLAN.md section 4, addendum 2 for S1) ─────────
function planSteps(planHash) {
  const hashAddr = ethers.getAddress('0x' + planHash.slice(0, 40));
  const s = [];
  s.push({ id: 'S1', from: 'Issuer', to: hashAddr, kind: 'hash', status: 1 });
  s.push({ id: 'S2', from: 'Issuer', to: null, kind: 'deploy', what: 'module', status: 1 });
  s.push({ id: 'S3', from: 'Issuer', to: null, kind: 'deploy', what: 'token', status: 1 });
  s.push({ id: 'S4', from: 'Issuer', to: 'module', fn: 'setAllowlistedBatch', args: [[W.Issuer, W.Investor], true], status: 1,
    events: [['module', 'AllowlistSet', [W.Issuer, true]], ['module', 'AllowlistSet', [W.Investor, true]]] });
  s.push({ id: 'S5', from: 'Issuer', to: 'token', fn: 'mint', args: [W.Investor, 1000n * U1], status: 1, events: [['token', 'Transfer', [ZERO, W.Investor, 1000n * U1]]] });
  for (let r = 1; r <= 3; r++) {
    const R = `R${r}-`;
    s.push({ id: R + 'T1', test: 'T1', from: 'Investor', to: 'token', fn: 'transfer', args: [W.Issuer, U1], status: 1, events: [['token', 'Transfer', [W.Investor, W.Issuer, U1]]] });
    s.push({ id: R + 'T2', test: 'T2', from: 'Investor', to: 'token', fn: 'transfer', args: [W.Outsider, U1], status: 0, error: ['CannotTransfer', [W.Investor, W.Outsider, 0n, U1]] });
    s.push({ id: R + 'T3', test: 'T3', from: 'Issuer', to: 'token', fn: 'mint', args: [W.Outsider, U1], status: 0, error: ['CannotTransfer', [ZERO, W.Outsider, 0n, U1]] });
    s.push({ id: R + 'T4a', from: 'Issuer', to: 'token', fn: 'setFrozenTokens', args: [W.Investor, 0n, FREEZE_ALL], status: 1, events: [['token', 'Frozen', [W.Investor, 0n, FREEZE_ALL]]] });
    s.push({ id: R + 'T4', test: 'T4', from: 'Investor', to: 'token', fn: 'transfer', args: [W.Issuer, U1], status: 0, error: ['InsufficientUnfrozenBalance', [W.Investor, 0n, U1, 0n]] });
    s.push({ id: R + 'T4b', from: 'Issuer', to: 'token', fn: 'setFrozenTokens', args: [W.Investor, 0n, 0n], status: 1, events: [['token', 'Frozen', [W.Investor, 0n, 0n]]] });
    s.push({ id: R + 'T5a', from: 'Issuer', to: 'token', fn: 'pause', args: [], status: 1, events: [['token', 'Paused', [W.Issuer]]] });
    s.push({ id: R + 'T5', test: 'T5', from: 'Investor', to: 'token', fn: 'transfer', args: [W.Issuer, U1], status: 0, error: ['EnforcedPause', []] });
    s.push({ id: R + 'T5b', from: 'Issuer', to: 'token', fn: 'unpause', args: [], status: 1, events: [['token', 'Unpaused', [W.Issuer]]] });
    s.push({ id: R + 'T6', test: 'T6', from: 'Issuer', to: 'token', fn: 'forcedTransfer', args: [W.Investor, W.Issuer, U1], status: 1,
      events: [['token', 'Transfer', [W.Investor, W.Issuer, U1]], ['token', 'ForcedTransfer', [W.Investor, W.Issuer, 0n, U1]]] });
    s.push({ id: R + 'T7', test: 'T7', from: 'Issuer', to: 'token', fn: 'forcedTransfer', args: [W.Investor, W.Outsider, U1], status: 0, error: ['CannotReceive', [W.Outsider]] });
    s.push({ id: R + 'T8a', from: 'Issuer', to: 'module', fn: 'setAllowlisted', args: [W.Outsider, true], status: 1, events: [['module', 'AllowlistSet', [W.Outsider, true]]] });
    s.push({ id: R + 'T8', test: 'T8', from: 'Investor', to: 'token', fn: 'transfer', args: [W.Outsider, U1], status: 1, events: [['token', 'Transfer', [W.Investor, W.Outsider, U1]]] });
    s.push({ id: R + 'T8b', from: 'Issuer', to: 'module', fn: 'setAllowlisted', args: [W.Outsider, false], status: 1, events: [['module', 'AllowlistSet', [W.Outsider, false]]] });
  }
  return { steps: s, hashAddr };
}
const norm = v => Array.isArray(v) ? v.map(norm) : (typeof v === 'string' ? v.toLowerCase() : (typeof v === 'bigint' ? v.toString() : String(v)));
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const NAMES = {};
const who = a => { if (lc(a) === lc(ZERO)) return '0x0'; for (const [k, v] of Object.entries(W)) if (lc(v) === lc(a)) return k; if (NAMES[lc(a)]) return NAMES[lc(a)]; return a.slice(0, 6) + '...' + a.slice(-4); };
const show = v => Array.isArray(v) ? '[' + v.map(show).join(', ') + ']' : (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? who(v) : String(v));

async function main() {
  const startedUtc = new Date().toISOString().replace('T', ' ').slice(0, 19);
  say(`W3 checker | run ${startedUtc} UTC | read-only | testnet RPC ${RPC}`);
  // plan files
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  const planHash = sha('W3-PLAN.md');
  say(`plan W3-PLAN.md sha256 ${planHash}`);
  for (const f of ['W3-PLAN-ADDENDUM-1.md', 'W3-PLAN-ADDENDUM-2.md']) if (fs.existsSync(path.join(ROOT, f))) say(`     ${f} sha256 ${sha(f)}`);
  const { steps, hashAddr } = planSteps(planHash);

  // compile
  const C = compile();
  say(`compiled from source with solc ${C.version.split('.Emscripten')[0]} (explorer records ${C.compilerVersion} for NF01)`);
  const tokI = new ethers.Interface(C.token.abi), modI = new ethers.Interface(C.module.abi);
  const errI = new ethers.Interface([...C.token.abi.filter(x => x.type === 'error'), ...C.module.abi.filter(x => x.type === 'error')]);

  // log
  const log = JSON.parse(fs.readFileSync(LOG, 'utf8'));
  if (log.format !== 'w3-bench-log-1') fail('log', 'unknown log format');
  if (lc(log.planSha256 || '') !== planHash) fail('log', 'planSha256 in the log is not the SHA-256 of W3-PLAN.md');
  for (const k of Object.keys(W)) if (lc((log.wallets || {})[k] || '') !== lc(W[k])) fail('log', `wallet ${k} differs from the plan`);
  const voids = log.records.filter(r => r.void);
  const done = log.records.filter(r => !r.void);
  for (const v of voids) if (v.hash) fail('log', `void record ${v.step} has a transaction hash`);
  if (done.length !== steps.length) fail('log', `${done.length} non-void records, plan has ${steps.length} steps`);
  const seenHash = new Set(); for (const r of done) { if (seenHash.has(lc(r.hash))) fail('log', `transaction hash ${r.hash} appears twice`); seenHash.add(lc(r.hash)); }
  say(`log ${path.basename(LOG)}: ${log.records.length} records, ${done.length} sent, ${voids.length} void (not sent)`);
  for (const v of voids) say(`  void ${v.step} at ${v.voidAtUtc} UTC, to ${who(v.to || ZERO)}: ${v.void}`);

  // local EVM
  process.chdir(ROOT);
  const hre = require('hardhat');
  const local = (method, params) => hre.network.provider.request({ method, params });
  for (const a of Object.values(W)) { await local('hardhat_impersonateAccount', [a]); await local('hardhat_setBalance', [a, '0x3635c9adc5dea00000']); }

  const addr = { module: null, token: null };
  const rows = [];
  const testTally = {};
  let prevBlock = -1;
  say('');
  say('step    sender    action                                        testnet  re-executed locally (revert or events)         gas: testnet = local');
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i], rec = done[i];
    const where = st.id;
    if (!rec || rec.step !== st.id) { fail(where, `log order: expected ${st.id}, found ${rec ? rec.step : 'nothing'}`); continue; }
    // chain data
    const tx = await rpcResult(RPC, 'eth_getTransactionByHash', [rec.hash]);
    const rc = await rpcResult(RPC, 'eth_getTransactionReceipt', [rec.hash]);
    if (!tx || !rc) { fail(where, `transaction ${rec.hash} not found on the testnet`); continue; }
    const blk = await rpcResult(RPC, 'eth_getBlockByNumber', [rc.blockNumber, false]);
    const bn = Number(BigInt(rc.blockNumber)); const status = Number(BigInt(rc.status)); const gasUsed = Number(BigInt(rc.gasUsed));
    if (bn <= prevBlock) fail(where, 'block number not increasing'); prevBlock = bn;
    // plan: sender, target, function, args
    if (lc(tx.from) !== lc(W[st.from])) fail(where, `sender ${who(tx.from)}, plan ${st.from}`);
    const target = st.to === 'module' ? addr.module : st.to === 'token' ? addr.token : st.to;
    if (st.kind === 'deploy') { if (tx.to) fail(where, 'expected a contract creation'); }
    else if (!tx.to || lc(tx.to) !== lc(target)) fail(where, `target ${tx.to}, plan ${target}`);
    let action = '';
    if (st.kind === 'hash') {
      action = `plan hash to ${who(hashAddr)}`;
      if (lc(tx.input) !== '0x' + planHash) fail(where, 'transaction data is not the plan SHA-256');
    } else if (st.kind === 'deploy') {
      const art = C[st.what];
      if (!lc(tx.input).startsWith(lc(art.creation))) fail(where, `creation code is not the ${st.what} compiled from source`);
      if (st.what === 'token') {
        const args = ethers.AbiCoder.defaultAbiCoder().decode(['string', 'string', 'uint8', 'address', 'address', 'address', 'address'], '0x' + tx.input.slice(art.creation.length));
        const want = ['W3 Gate Test', 'W3GT', 6n, W.Issuer, W.Issuer, W.Issuer, addr.module];
        if (!same([...args], want)) fail(where, `constructor args ${show([...args])}, plan ${show(want)}`);
        action = 'deploy CompliantERC20 W3GT';
      } else action = 'deploy TestAllowlistModule';
    } else {
      const iface = st.to === 'module' ? modI : tokI;
      let d; try { d = iface.parseTransaction({ data: tx.input }); } catch (e) { d = null; }
      if (!d || d.name !== st.fn || !same([...d.args].map(x => Array.isArray(x) ? [...x] : x), st.args)) fail(where, `call ${d ? d.name + show([...d.args]) : 'undecodable'}, plan ${st.fn}${show(st.args)}`);
      const amt = v => (typeof v === 'bigint' && ['transfer', 'mint', 'forcedTransfer', 'setFrozenTokens'].includes(st.fn)) ? ethers.formatUnits(v, 6).replace(/\.0$/, '') + ' W3GT' : show(v);
      action = `${st.fn}(${st.args.map((v, k) => (st.fn === 'setFrozenTokens' && k === 1) ? show(v) : amt(v)).join(', ')})`;
      if (st.test && lc(tx.gas) !== lc('0x' + (200000).toString(16))) fail(where, `gas limit ${Number(BigInt(tx.gas))}, plan 200,000`);
    }
    // log vs chain
    if (lc(rec.data) !== lc(tx.input)) fail(where, 'log data differs from the chain');
    if (!rec.receipt) fail(where, 'log has no receipt');
    else {
      if (rec.receipt.status !== status) fail(where, `log status ${rec.receipt.status}, chain ${status}`);
      if (rec.receipt.blockNumber !== bn) fail(where, `log block ${rec.receipt.blockNumber}, chain ${bn}`);
      if (rec.receipt.gasUsed !== gasUsed) fail(where, `log gas ${rec.receipt.gasUsed}, chain ${gasUsed}`);
      const chainLogs = rc.logs.map(l => [l.address, l.topics, l.data]);
      const logLogs = (rec.receipt.logs || []).map(l => [l.address, l.topics, l.data]);
      if (!same(chainLogs, logLogs)) fail(where, 'log events differ from the chain');
    }
    const blockTimeUtc = new Date(Number(BigInt(blk.timestamp)) * 1000).toISOString().replace('T', ' ').slice(0, 19);
    if (rec.blockTimeUtc !== blockTimeUtc) fail(where, `log block time ${rec.blockTimeUtc}, chain ${blockTimeUtc}`);
    if (status !== st.status) fail(where, `testnet status ${status}, plan ${st.status}`);

    // local re-execution with the same sender and nonce
    if (problems.some(p => p.startsWith(where + ':') && /plan|sender|target|call|creation|data/.test(p))) { fail(where, 'not re-executed: the transaction does not match the plan or the log'); continue; }
    let lrc, ltx;
    try {
    const nonce = Number(BigInt(tx.nonce));
    const cur = Number(BigInt(await local('eth_getTransactionCount', [tx.from, 'latest'])));
    if (cur !== nonce) await local('hardhat_setNonce', [tx.from, '0x' + nonce.toString(16)]);
    ltx = { from: tx.from, data: tx.input, gas: tx.gas, value: tx.value }; if (tx.to) ltx.to = tx.to;
    const lhash = await local('eth_sendTransaction', [ltx]);
    lrc = await local('eth_getTransactionReceipt', [lhash]);
    } catch (e) { fail(where, 'local re-execution failed: ' + e.message.split('\n')[0]); continue; }
    const lstatus = Number(BigInt(lrc.status)), lgas = Number(BigInt(lrc.gasUsed));
    if (lstatus !== status) fail(where, `local status ${lstatus}, testnet ${status}`);
    if (lgas !== gasUsed) fail(where, `local gas ${lgas}, testnet ${gasUsed}`);
    if (!same(lrc.logs.map(l => [l.address, l.topics, l.data]), rc.logs.map(l => [l.address, l.topics, l.data]))) fail(where, 'local events differ from the testnet events');
    if (st.kind === 'deploy') {
      if (lc(lrc.contractAddress) !== lc(rc.contractAddress)) fail(where, `local contract address ${lrc.contractAddress}, testnet ${rc.contractAddress}`);
      addr[st.what] = rc.contractAddress; NAMES[lc(rc.contractAddress)] = st.what === 'token' ? 'W3GT' : 'module';
    }
    // result
    let result = status === 1 ? 'success' : 'failed';
    let local_ = '';
    if (status === 0) {
      let data = null;
      try { await local('eth_call', [ltx, '0x' + (Number(BigInt(lrc.blockNumber)) - 1).toString(16)]); } catch (e) { data = revertDataOf(e); }
      let dec = null; try { dec = data ? errI.parseError(data) : null; } catch (e) { dec = null; }
      local_ = dec ? `${dec.name}(${[...dec.args].map(show).join(', ')})` : 'reverted, no decodable data';
      if (!dec || dec.name !== st.error[0] || !same([...dec.args], st.error[1])) fail(where, `revert ${local_}, plan ${st.error[0]}${show(st.error[1])}`);
      if (rec.replay && lc(rec.replay.revertData || '') !== lc(data || '')) fail(where, 'revert data in the log differs from the re-execution');
      // optional: the testnet node itself, if it still keeps the parent block state
      const on = await rpc(RPC, 'eth_call', [{ from: tx.from, to: tx.to, data: tx.input, gas: tx.gas }, '0x' + (bn - 1).toString(16)]);
      const onData = on.error ? revertDataOf(on.error) : null;
      if (onData && lc(onData) !== lc(data || '')) fail(where, 'testnet replay revert data differs from the local re-execution');
      rec._onchainReplay = onData ? 'same' : 'n/a';
    } else {
      const decoded = lrc.logs.map(l => { const I = lc(l.address) === lc(addr.module) ? modI : tokI; try { const p = I.parseLog(l); return { emitter: l.address, name: p.name, args: [...p.args] }; } catch (e) { return { emitter: l.address, name: '?', args: [] }; } });
      for (const [em, name, args] of (st.events || [])) {
        const want = em === 'module' ? addr.module : addr.token;
        if (!decoded.some(d => d.name === name && lc(d.emitter) === lc(want) && same(d.args, args))) fail(where, `missing event ${name}${show(args)}`);
      }
      local_ = decoded.filter(d => ['Transfer', 'ForcedTransfer', 'Frozen', 'Paused', 'Unpaused', 'AllowlistSet'].includes(d.name)).map(d => `${d.name}(${d.args.map(show).join(', ')})`).join(' + ') || (st.kind === 'deploy' ? `created ${who(rc.contractAddress)}` : 'success');
    }
    const ok = !problems.some(p => p.startsWith(where + ':'));
    if (st.test) { testTally[st.test] = testTally[st.test] || { ok: 0, n: 0 }; testTally[st.test].n++; if (ok) testTally[st.test].ok++; }
    const planTxt = st.status === 0 ? st.error[0] : 'success';
    rows.push({ step: st.id, sender: st.from, action, hash: rec.hash, testnetNodeReplay: rec._onchainReplay || null, block: bn, blockTimeUtc, testnet: result, local: local_, gasTestnet: gasUsed, gasLocal: lgas, plan: planTxt, ok });
    say(`${st.id.padEnd(7)} ${st.from.padEnd(9)} ${action.slice(0, 45).padEnd(45)} ${result.padEnd(8)} ${local_.slice(0, 46).padEnd(46)} ${fmt(gasUsed).padStart(9)} = ${fmt(lgas).padEnd(9)} ${ok ? 'OK' : 'FAIL'}`);
  }

  // deployed code: testnet vs local (exact) and vs compiled (outside immutables)
  say('');
  const code = {};
  for (const what of ['module', 'token']) {
    if (!addr[what]) continue;
    const tcode = await rpcResult(RPC, 'eth_getCode', [addr[what], 'latest']);
    const lcode = await local('eth_getCode', [addr[what], 'latest']);
    const cmp = compareCode(tcode, C[what].runtime, C[what].ranges);
    code[what] = { address: addr[what], identicalToLocalReexecution: lc(tcode) === lc(lcode), vsCompiled: cmp };
    if (lc(tcode) !== lc(lcode)) fail(`code ${what}`, 'testnet runtime differs from the local re-execution');
    if (!cmp.same) fail(`code ${what}`, `testnet runtime differs from the compiled code outside immutables (${cmp.differOutside} bytes)`);
    say(`code ${what.padEnd(6)} ${addr[what]}: testnet = local re-execution byte for byte: ${lc(tcode) === lc(lcode)}`);
    say(`       vs compiled from source: ${cmp.same ? 'identical' : 'DIFFERENT'} outside ${cmp.ranges} immutable ranges (${fmt(cmp.bytes)} bytes)`);
  }
  // B0a mainnet
  let b0a = null;
  if (!SKIP_MAINNET) {
    const mbn = await rpcResult(MAINNET, 'eth_blockNumber', []);
    const mcode = await rpcResult(MAINNET, 'eth_getCode', [NF01, mbn]);
    b0a = Object.assign({ block: Number(BigInt(mbn)) }, compareCode(mcode, C.token.runtime, C.token.ranges));
    if (!b0a.same) fail('B0a', 'NF01 mainnet runtime differs from the compiled source outside immutables');
    say(`B0a NF01 on mainnet (block ${fmt(b0a.block)}) vs compiled source: ${b0a.same ? 'identical' : 'DIFFERENT'} outside ${b0a.ranges} immutable ranges (${fmt(b0a.bytes)} bytes, ${b0a.differOutside} differ outside)`);
  } else say('B0a skipped (--skip-mainnet)');

  // token setup reads and end state at the latest testnet block
  const lbn = await rpcResult(RPC, 'eth_blockNumber', []);
  const readT = async (to, iface, fn, args) => iface.decodeFunctionResult(fn, await rpcResult(RPC, 'eth_call', [{ to, data: iface.encodeFunctionData(fn, args) }, lbn]))[0];
  const end = { block: Number(BigInt(lbn)) };
  if (addr.token) {
    end.name = await readT(addr.token, tokI, 'name', []); end.symbol = await readT(addr.token, tokI, 'symbol', []); end.decimals = await readT(addr.token, tokI, 'decimals', []);
    end.compliance = await readT(addr.token, tokI, 'compliance', []);
    for (const role of ['DEFAULT_ADMIN_ROLE', 'ISSUER_ROLE', 'ENFORCER_ROLE', 'PAUSER_ROLE']) {
      const id = await readT(addr.token, tokI, role, []); end['issuerHas' + role] = await readT(addr.token, tokI, 'hasRole', [id, W.Issuer]);
      if (!end['issuerHas' + role]) fail('setup', `W3 Issuer does not hold ${role}`);
    }
    for (const k of ['Investor', 'Issuer', 'Outsider']) end[k] = await readT(addr.token, tokI, 'balanceOf', [W[k]]);
    end.totalSupply = await readT(addr.token, tokI, 'totalSupply', []);
    end.paused = await readT(addr.token, tokI, 'paused', []);
    end.frozenInvestor = await readT(addr.token, tokI, 'getFrozenTokens', [W.Investor, 0n]);
    end.outsiderAllowlisted = await readT(addr.module, modI, 'isAllowlisted', [W.Outsider]);
    const want = { name: 'W3 Gate Test', symbol: 'W3GT', decimals: 6n, compliance: addr.module, Investor: 991n * U1, Issuer: 6n * U1, Outsider: 3n * U1, totalSupply: 1000n * U1, paused: false, frozenInvestor: 0n, outsiderAllowlisted: false };
    for (const [k, v] of Object.entries(want)) if (!same(end[k], v)) fail('end state', `${k} = ${show(end[k])}, plan ${show(v)}`);
    const u = v => Number(ethers.formatUnits(v, 6)).toLocaleString('en-US');
    say(`end state at testnet block ${fmt(end.block)}: Investor ${u(end.Investor)}, Issuer ${u(end.Issuer)}, Outsider ${u(end.Outsider)} W3GT, supply ${u(end.totalSupply)} (plan 991 / 6 / 3 / 1,000)`);
    say(`  paused ${end.paused}, Investor frozen ${end.frozenInvestor}, Outsider allowlisted ${end.outsiderAllowlisted}, W3 Issuer holds all 4 roles, compliance module = ${who(end.compliance)}`);
  }

  // per-test tally
  say('');
  say('tests: ' + ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map(t => `${t} ${(testTally[t] || { ok: 0 }).ok}/${(testTally[t] || { n: 0 }).n}`).join('  '));
  const pass = problems.length === 0;
  say(pass ? 'RESULT: PASS. Every transaction matches the plan, the saved log and a fresh local re-execution.' : `RESULT: FAIL (${problems.length} problem${problems.length > 1 ? 's' : ''})`);

  // write results
  if (!flag('--no-write')) {
    fs.mkdirSync(OUT, { recursive: true });
    const res = { checkerRunUtc: startedUtc, rpc: RPC, planSha256: planHash, log: path.basename(LOG), pass, problems, voids: voids.map(v => ({ step: v.step, atUtc: v.voidAtUtc, to: v.to, reason: v.void })),
      rows, code, b0a, endState: end, tests: testTally };
    fs.writeFileSync(path.join(OUT, 'check-results.json'), JSON.stringify(res, (k, v) => typeof v === 'bigint' ? v.toString() : v, 1));
    const md = ['# Checker result', '', `Run ${startedUtc} UTC. Testnet RPC ${RPC}. Plan SHA-256 ${planHash}.`, '', `**${pass ? 'PASS' : 'FAIL'}**`, '',
      '| Step | Sender | Action | Testnet | Re-executed locally | Gas (testnet = local) | Plan | Block | Block time (UTC) | Tx |', '|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map(r => `| ${r.step} | ${r.sender} | ${r.action} | ${r.testnet} | ${r.local} | ${fmt(r.gasTestnet)} = ${fmt(r.gasLocal)} | ${r.plan} ${r.ok ? 'OK' : 'FAIL'} | ${fmt(r.block)} | ${r.blockTimeUtc} | [${r.hash.slice(0, 10)}...](https://testnet-explorer.rayls.com/tx/${r.hash}) |`),
      '', '```', ...lines, '```', ''];
    fs.writeFileSync(path.join(OUT, 'check-results.md'), md.join('\n'));
  }
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error('checker error:', e.message); process.exit(2); });
