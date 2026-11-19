const fs = require('fs'); const solc = require('solc');
const rec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const iface = rec.additional_sources.find(s => s.file_path === 'interfaces/ICompliance.sol').source_code;
const input = { language: 'Solidity', sources: {
  'TestAllowlistModule.sol': { content: fs.readFileSync(__dirname + '/../../contracts/TestAllowlistModule.sol', 'utf8') },
  'interfaces/ICompliance.sol': { content: iface } },
  settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 }, viaIR: false,
    metadata: { appendCBOR: true, bytecodeHash: 'ipfs', useLiteralContent: false },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of (out.errors || [])) console.error(e.severity, e.formattedMessage);
if ((out.errors || []).some(e => e.severity === 'error')) process.exit(1);
const c = out.contracts['TestAllowlistModule.sol']['TestAllowlistModule'];
fs.writeFileSync(process.argv[3], JSON.stringify({ input, abi: c.abi, bytecode: c.evm.bytecode.object, deployedBytecode: c.evm.deployedBytecode.object, immutableReferences: c.evm.deployedBytecode.immutableReferences, metadata: c.metadata }, null, 1));
console.log('module bytecode bytes', c.evm.bytecode.object.length / 2);
