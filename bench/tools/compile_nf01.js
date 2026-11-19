// Rebuild NF01's verified CompliantERC20 from the explorer record and compare runtime bytecode.
const fs = require('fs');
const solc = require('solc');
const rec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sources = {};
sources[rec.file_path] = { content: rec.source_code };
for (const s of rec.additional_sources) sources[s.file_path] = { content: s.source_code };
const settings = JSON.parse(JSON.stringify(rec.compiler_settings));
settings.outputSelection = { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } };
const input = { language: 'Solidity', sources, settings };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter(e => e.severity === 'error');
if (errs.length) { console.error(errs.map(e => e.formattedMessage).join('\n')); process.exit(1); }
const c = out.contracts[rec.file_path][rec.name];
fs.writeFileSync(process.argv[3], JSON.stringify({ input, abi: c.abi, bytecode: c.evm.bytecode.object, deployedBytecode: c.evm.deployedBytecode.object, immutableReferences: c.evm.deployedBytecode.immutableReferences, metadata: c.metadata }, null, 1));
// compare
const onchain = rec.deployed_bytecode.replace(/^0x/, '').toLowerCase();
const compiled = c.evm.deployedBytecode.object.toLowerCase();
console.log('length onchain', onchain.length / 2, 'compiled', compiled.length / 2);
let mask = new Array(compiled.length / 2).fill(false); let nimm = 0;
for (const [id, refs] of Object.entries(c.evm.deployedBytecode.immutableReferences)) for (const r of refs) { nimm++; for (let i = r.start; i < r.start + r.length; i++) mask[i] = true; }
let diffOutside = 0, diffInside = 0;
for (let i = 0; i < compiled.length / 2; i++) { const a = onchain.substr(i * 2, 2), b = compiled.substr(i * 2, 2); if (a !== b) { if (mask[i]) diffInside++; else diffOutside++; } }
console.log('immutable slots', nimm, 'bytes differing inside immutables', diffInside, 'outside', diffOutside);
