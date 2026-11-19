// Tamper tests: edited copies of the saved bench log must be rejected by checker/check.js.
// Usage: node checker/tamper.js --log results/bench-log.json [--rpc URL] [--out DIR]
'use strict';
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LOG = opt('--log', path.join(ROOT, 'results/bench-log.json'));
const RPC = opt('--rpc', 'https://testnet-rpc.rayls.com/');
const OUT = opt('--out', path.join(ROOT, 'results'));
const base = JSON.parse(fs.readFileSync(LOG, 'utf8'));
const find = (log, id) => log.records.find(r => r.step === id && !r.void);
const cases = [
  ['status of R1-T2 changed from failed to success', l => { find(l, 'R1-T2').receipt.status = 1; }],
  ['hash of R2-T5 replaced by the hash of R2-T1', l => { find(l, 'R2-T5').hash = find(l, 'R2-T1').hash; }],
  ['revert of R1-T4 swapped to EnforcedPause', l => { find(l, 'R1-T4').replay.revertData = '0xd93c0665'; }],
  ['gas used of R3-T8 raised by 1,000', l => { find(l, 'R3-T8').receipt.gasUsed += 1000; }],
  ['record R2-T7 deleted', l => { l.records = l.records.filter(r => !(r.step === 'R2-T7' && !r.void)); }],
  ['block time of R1-T1 moved one hour', l => { const r = find(l, 'R1-T1'); r.blockTimeUtc = r.blockTimeUtc.replace(/ (\d\d):/, (m, h) => ' ' + String((+h + 1) % 24).padStart(2, '0') + ':'); }],
  ['plan SHA-256 in the log edited', l => { l.planSha256 = l.planSha256.replace(/^./, c => c === 'a' ? 'b' : 'a'); }],
  ['last event removed from the R3-T6 receipt', l => { find(l, 'R3-T6').receipt.logs.pop(); }],
];
// The untouched log must pass first; otherwise a rejection would prove nothing.
const baseRun = spawnSync(process.execPath, [path.join(__dirname, 'check.js'), '--log', LOG, '--rpc', RPC, '--skip-mainnet', '--no-write', '--quiet'], { encoding: 'utf8' });
if (baseRun.status !== 0) {
  console.log('untouched log does NOT pass the checker, so tamper tests are not meaningful:');
  console.log(((baseRun.stdout || '') + (baseRun.stderr || '')).split('\n').filter(x => x.includes('FAIL') || x.includes('error')).slice(0, 10).join('\n'));
  process.exit(1);
}
console.log('untouched log: PASS');
const dir = path.join(OUT, 'tamper'); fs.mkdirSync(dir, { recursive: true });
const rows = []; let allRejected = true;
console.log(`tamper tests | ${cases.length} edited copies of ${path.basename(LOG)} | each must be rejected`);
cases.forEach(([name, edit], i) => {
  const copy = JSON.parse(JSON.stringify(base)); edit(copy);
  const f = path.join(dir, `tampered-${i + 1}.json`); fs.writeFileSync(f, JSON.stringify(copy, null, 1));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check.js'), '--log', f, '--rpc', RPC, '--skip-mainnet', '--no-write', '--quiet'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const first = (out.split('\n').find(x => x.includes('FAIL ')) || out.split('\n').find(x => x.trim()) || '').trim().replace(/^FAIL /, '');
  const rejected = r.status === 1;
  if (!rejected) allRejected = false;
  rows.push({ n: i + 1, edit: name, file: `tampered-${i + 1}.json`, rejected, exitCode: r.status, reason: first });
  console.log(`${String(i + 1).padStart(2)}. ${name.padEnd(48)} ${rejected ? 'REJECTED' : 'NOT REJECTED'}  ${first.slice(0, 80)}`);
});
const ok = allRejected;
console.log(ok ? `RESULT: all ${cases.length} edited copies were rejected.` : 'RESULT: at least one edited copy was NOT rejected.');
fs.writeFileSync(path.join(OUT, 'tamper-results.json'), JSON.stringify({ log: path.basename(LOG), rows, allRejected: ok }, null, 1));
fs.writeFileSync(path.join(OUT, 'tamper-results.md'), ['# Tamper tests', '', `${cases.length} edited copies of ${path.basename(LOG)} (files in results/tamper/). Each must be rejected by checker/check.js.`, '',
  '| # | Edit | Rejected | First reason given by the checker |', '|---|---|---|---|', ...rows.map(r => `| ${r.n} | ${r.edit} | ${r.rejected ? 'yes' : 'NO'} | ${r.reason.replace(/\|/g, '/')} |`), ''].join('\n'));
process.exit(ok ? 0 : 1);
