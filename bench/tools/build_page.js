// Builds index.html from page/template.html and the compiled artifacts.
const fs = require('fs'); const path = require('path'); const { id, getAddress } = require('ethers');
const root = path.join(__dirname, '..', '..');
const tok = JSON.parse(fs.readFileSync(path.join(root, 'build/CompliantERC20.json')));
const mod = JSON.parse(fs.readFileSync(path.join(root, 'build/TestAllowlistModule.json')));
const planHash = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'W3-PLAN.md'))).digest('hex');
const ranges = refs => Object.values(refs).flat().map(r => [r.start, r.length]).sort((a, b) => a[0] - b[0]);
const sig = f => `${f.name}(${f.inputs.map(i => i.type).join(',')})`;
const sel = {}, errors = {}, events = {};
for (const a of [...tok.abi, ...mod.abi]) {
  if (a.type === 'function') sel[sig(a)] = id(sig(a)).slice(2, 10);
  if (a.type === 'error') errors[id(sig(a)).slice(2, 10)] = { name: a.name, types: a.inputs.map(i => i.type) };
  if (a.type === 'event') events[id(sig(a)).toLowerCase()] = { name: a.name, inputs: a.inputs.map(i => ({ type: i.type, indexed: i.indexed })) };
}
const need = ['transfer(address,uint256)', 'mint(address,uint256)', 'setFrozenTokens(address,uint256,uint256)', 'pause()', 'unpause()',
  'forcedTransfer(address,address,uint256)', 'setAllowlisted(address,bool)', 'setAllowlistedBatch(address[],bool)', 'paused()', 'compliance()',
  'getFrozenTokens(address,uint256)', 'availableBalance(address)', 'canSend(address)', 'canReceive(address)', 'canTransfer(address,address,uint256)',
  'balanceOf(address)', 'totalSupply()', 'isAllowlisted(address)'];
for (const n of need) if (!sel[n]) throw new Error('missing selector ' + n);
const C = {
  chainId: 7295799, chainIdHex: '0x6f5337', explorer: 'https://testnet-explorer.rayls.com', planHash,
  wallets: { Issuer: getAddress('0x29aEB2f58044487e60639D87016A0ebC8d096Df1'), Investor: getAddress('0xBdcb5A4320636731446617c6A0C2c44873398D5B'), Outsider: getAddress('0xe892BF4cf5427254A0d5c410785948137b65bF47') },
  token: { name: 'W3 Gate Test', symbol: 'W3GT', decimals: 6, creation: '0x' + tok.bytecode, runtime: tok.deployedBytecode, immRanges: ranges(tok.immutableReferences) },
  module: { creation: '0x' + mod.bytecode, runtime: mod.deployedBytecode, immRanges: ranges(mod.immutableReferences) },
  nf01: { address: '0x36f480c489F4cF6AAcF91C7605504a840060e376' },
  sel, errors, events };
const tpl = fs.readFileSync(path.join(root, 'bench/template.html'), 'utf8');
if (!tpl.includes('/*__CONFIG__*/null')) throw new Error('placeholder missing');
const out = tpl.replace('/*__CONFIG__*/null', JSON.stringify(C));
const dest = process.argv[2] || path.join(root, 'bench/index.html');
fs.writeFileSync(dest, out);
console.log('plan sha256', planHash, '| index.html bytes', out.length, '| errors', Object.keys(errors).length, '| events', Object.keys(events).length);
console.log(Object.values(events).map(e => e.name).join(' '));
