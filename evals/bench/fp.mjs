// fp.mjs — read-only fingerprint of this repo checkout (refs, status, key files, node_modules, source trees).
//   node evals/bench/fp.mjs <out.txt>
// Compare a pre/post pair with fpcmp.mjs. Optional trees that do not exist are reported as "absent".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const h = (b) => crypto.createHash('sha1').update(b).digest('hex');
const git = (...a) => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return '<none>'; } };
function tree(dir) {
  const lines = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d).sort()) {
      const f = path.join(d, e); const rel = path.relative(dir, f).replace(/\\/g, '/'); const s = fs.lstatSync(f);
      if (s.isSymbolicLink()) lines.push(`L ${rel} -> ${fs.readlinkSync(f)}`);
      else if (s.isDirectory()) { lines.push(`D ${rel}`); walk(f); }
      else lines.push(`F ${rel} ${s.size} nlink=${s.nlink} ${h(fs.readFileSync(f))}`);
    }
  })(dir);
  return lines;
}
const out = [];
out.push('HEAD ' + git('rev-parse', 'HEAD'));
out.push('main ' + git('rev-parse', '--verify', '-q', 'main'));
out.push('eval-baseline-v1 ' + git('rev-parse', '--verify', '-q', 'eval-baseline-v1^{commit}'));
out.push('status ' + JSON.stringify(git('status', '--porcelain=v1', '--untracked-files=all')));
for (const f of ['package.json', 'package-lock.json', 'evals/results/history.csv', 'evals/INVALIDATIONS.md', 'evals/baseline-env.json', 'evals/checks.ts']) {
  const p = path.join(REPO, f); out.push(`${f} ${fs.existsSync(p) ? h(fs.readFileSync(p)) : 'absent'}`);
}
const nmDir = path.join(REPO, 'node_modules');
if (fs.existsSync(nmDir)) {
  const nm = tree(nmDir);
  out.push(`node_modules files=${nm.filter((l) => l[0] === 'F').length} dirs=${nm.filter((l) => l[0] === 'D').length} links=${nm.filter((l) => l[0] === 'L').length} tree=${h(nm.join('\n'))}`);
  for (const l of nm.filter((l) => l[0] === 'L')) out.push('  ' + l);
} else out.push('node_modules absent');
for (const p of ['.turbo', 'evals/results', 'packages', 'apps']) {
  const d = path.join(REPO, p);
  if (!fs.existsSync(d)) { out.push(`${p} absent`); continue; }
  const t = tree(d); out.push(`${p} entries=${t.length} tree=${h(t.join('\n'))}`);
}
if (fs.existsSync(path.join(REPO, '.turbo'))) out.push(`.turbo mtime ${fs.statSync(path.join(REPO, '.turbo')).mtime.toISOString()}`);
fs.writeFileSync(process.argv[2], out.join('\n') + '\n');
console.log(out.filter((l) => !l.startsWith('status')).join('\n'));
