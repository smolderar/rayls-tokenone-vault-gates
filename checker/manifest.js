// Writes or checks MANIFEST.sha256: the SHA-256 of every tracked file except the manifest itself.
// Usage: node checker/manifest.js write | check
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(f => f && f !== 'MANIFEST.sha256').sort();
const lines = files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex') + '  ' + f);
const text = lines.join('\n') + '\n';
const mode = process.argv[2] || 'check';
if (mode === 'write') { fs.writeFileSync(path.join(ROOT, 'MANIFEST.sha256'), text); console.log(`MANIFEST.sha256 written: ${files.length} files`); process.exit(0); }
const old = fs.readFileSync(path.join(ROOT, 'MANIFEST.sha256'), 'utf8');
if (old === text) { console.log(`MANIFEST.sha256 matches all ${files.length} files`); process.exit(0); }
const a = new Set(old.trim().split('\n')), b = new Set(lines);
for (const l of a) if (!b.has(l)) console.log('manifest only: ' + l);
for (const l of b) if (!a.has(l)) console.log('files only:    ' + l);
process.exit(1);
