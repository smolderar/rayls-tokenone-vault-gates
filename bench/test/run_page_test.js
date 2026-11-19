// Offline end-to-end test of out/index.html: jsdom page + mock MetaMask + mock local server, against a local Hardhat EVM.
const fs = require('fs'); const path = require('path'); const { JSDOM } = require('jsdom');
const NODE = 'http://127.0.0.1:8545';
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const nf01 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = { Issuer: '0x29aEB2f58044487e60639D87016A0ebC8d096Df1', Investor: '0xBdcb5A4320636731446617c6A0C2c44873398D5B', Outsider: '0xe892BF4cf5427254A0d5c410785948137b65bF47' };
let id = 0;
async function node(method, params) {
  const r = await fetch(NODE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  return r.json();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let selected = 'Issuer'; let switches = 0;
let savedLog = process.env.START_LOG ? fs.readFileSync(process.env.START_LOG, 'utf8') : null; const recordLines = []; let sendCount = 0; const REJECT_AT = Number(process.env.REJECT_AT || 9);
const ALLOWED = ['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber', 'eth_getLogs'];
(async () => {
  for (const a of Object.values(W)) { await node('hardhat_impersonateAccount', [a]); await node('hardhat_setBalance', [a, '0x29a2241af62c0000']); }
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost:8765/',
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.ethereum = { request: async ({ method, params }) => {
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [W[selected], ...Object.values(W).filter(a => a !== W[selected])].map(a => a.toLowerCase());
        if (method === 'wallet_switchEthereumChain') return null;
        if (method === 'eth_sendTransaction') {
          const tx = params[0];
          if (tx.to && Object.values(W).map(a => a.toLowerCase()).includes(tx.to.toLowerCase()) && tx.data && tx.data !== '0x') {
            const e = new Error('External transactions to internal accounts cannot include data'); e.code = -32602; throw e; }
          if (tx.to && /^0x0{40}$/i.test(tx.to)) { const e = new Error('MetaMask Tx Signature: User denied transaction signature.'); e.code = 4001; throw e; }
          sendCount++;
          if (sendCount === REJECT_AT) { const e = new Error('MetaMask Tx Signature: User denied transaction signature.'); e.code = 4001; throw e; }
        }
        const r = await node(method, params);
        if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; e.data = r.error.data; throw e; }
        return r.result;
      } };
      window.fetch = async (url, opts) => {
        const body = opts && opts.body; const respond = obj => ({ json: async () => (typeof obj === 'string' ? JSON.parse(obj) : obj) });
        if (url === '/log' && (!opts || opts.method !== 'POST')) return respond(savedLog || '{}');
        if (url === '/log') { JSON.parse(body); savedLog = body; return respond({ ok: true }); }
        if (url === '/record') { JSON.parse(body); recordLines.push(body); return respond({ ok: true }); }
        if (url === '/rpc') {
          if (body.trim().startsWith('[')) throw new Error('batch not allowed');
          const m = JSON.parse(body); if (!ALLOWED.includes(m.method)) return respond({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not allowed' } });
          const r = await fetch(NODE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
          return respond(await r.json());
        }
        if (url === '/rpc-mainnet') {
          const m = JSON.parse(body);
          if (m.method === 'eth_blockNumber') return respond({ jsonrpc: '2.0', id: m.id, result: '0xe1fbe3' });
          if (m.method === 'eth_getCode') return respond({ jsonrpc: '2.0', id: m.id, result: nf01.deployed_bytecode });
          return respond({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not allowed' } });
        }
        throw new Error('unexpected url ' + url);
      };
    } });
  const doc = dom.window.document; const $ = i => doc.getElementById(i);
  await sleep(500);
  $('connect').click(); await sleep(800);
  console.log('banner after connect:', $('banner').textContent, '| net:', $('net').textContent, '| extra:', $('extra').textContent);
  $('b0a').click(); await sleep(500);
  console.log('B0:', $('b0').textContent);
  for (let i = 0; i < 80; i++) {
    for (let w = 0; w < 400 && $('run').disabled && $('nextId').textContent !== 'done'; w++) {
      if ($('ack').style.display === '') { console.log('MISMATCH BANNER:\n' + $('banner').textContent); $('ack').click(); }
      await sleep(50);
    }
    if ($('nextId').textContent === 'done') break;
    const sid = $('nextId').textContent;
    $('run').click(); await sleep(100);
    for (let w = 0; w < 600 && !(!$('run').disabled || $('nextId').textContent === 'done' || $('ack').style.display === ''); w++) await sleep(50);
    const sw = /switch MetaMask to W3 (\w+)/.exec($('banner').textContent);
    if (sw) { selected = sw[1]; switches++; await sleep(50); $('run').click(); await sleep(100); }
    for (let w = 0; w < 600 && !(!$('run').disabled || $('nextId').textContent === 'done' || $('ack').style.display === ''); w++) await sleep(50);
    console.log('--- ' + sid + '\n' + $('banner').textContent);
  }
  await sleep(1500);
  console.log('SUMMARY:', $('summary').textContent);
  console.log('ENDSTATE:', $('endstate').textContent);
  console.log('B0:', $('b0').textContent);
  const log = JSON.parse(savedLog);
  const nonVoid = log.records.filter(r => !r.void); const voids = log.records.filter(r => r.void);
  console.log('account switches', switches, '| cur:', $('cur').textContent);
  console.log('records', log.records.length, 'nonvoid', nonVoid.length, 'void', voids.length, 'all match', nonVoid.every(r => r.match), 'record lines', recordLines.length);
  console.log('mismatches', nonVoid.filter(r => !r.match).map(r => r.step + ' ' + (r.replay ? r.replay.decoded : '') + ' ' + JSON.stringify(r.events && r.events.map(e => e.text))));
  fs.writeFileSync(process.env.OUT_LOG || path.join(__dirname, 'local-hardhat-sample-log.json'), savedLog);
  if (!(nonVoid.every(r => r.match) && nonVoid.length === 47)) process.exit(1);
  const t2 = log.records.find(r => r.step === 'R1-T2'); console.log('R1-T2 pre:', JSON.stringify(t2.pre), '\nR1-T2 preflight:', JSON.stringify(t2.preflight), '\nR1-T2 replay:', JSON.stringify(t2.replay));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
