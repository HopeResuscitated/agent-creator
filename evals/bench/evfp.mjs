// evfp.mjs — read-only evidence fingerprint of the user's real jcode state (~/.jcode: names, sizes, mtimes,
// sha1) plus any extra directories given. A contained or control run must leave it unchanged.
//   node evals/bench/evfp.mjs <out.txt> [extra-dir ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const [outFile, ...extra] = process.argv.slice(2);
if (!outFile) { console.error('usage: evfp.mjs <out.txt> [extra-dir ...]'); process.exit(2); }
const h = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
function tree(dir) {
  const lines = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d).sort()) {
      const f = path.join(d, e); const rel = path.relative(dir, f).replace(/\\/g, '/'); const s = fs.lstatSync(f);
      if (s.isSymbolicLink()) lines.push(`L ${rel} -> ${fs.readlinkSync(f)}`);
      else if (s.isDirectory()) { lines.push(`D ${rel}`); walk(f); }
      else lines.push(`F ${rel} ${s.size} ${s.mtimeMs} ${h(f)}`);
    }
  })(dir);
  return lines;
}
const sum = (l) => crypto.createHash('sha1').update(l.join('\n')).digest('hex');
const out = [];
for (const [label, dir] of [['~/.jcode', path.join(os.homedir(), '.jcode')], ...extra.map((d) => [d, d])]) {
  if (!fs.existsSync(dir)) { out.push(`${label} absent`); continue; }
  const t = tree(dir); out.push(`${label} entries=${t.length} tree=${sum(t)}`);
}
fs.writeFileSync(outFile, out.join('\n') + '\n');
console.log(out.join('\n'));
