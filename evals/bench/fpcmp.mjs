// fpcmp.mjs — compare two fp.mjs fingerprints, ignoring what the runner itself writes (evals/results/**,
// history.csv). Exit 0 = unchanged, 1 = differs (the differing lines are printed).
//   node evals/bench/fpcmp.mjs <fp-pre.txt> <fp-post.txt>
import fs from 'node:fs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: fpcmp.mjs <pre> <post>'); process.exit(2); }
const RUNNER_OWNED = /^(evals\/results\/history\.csv |evals\/results (entries=|absent))/;
const norm = (f) => fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean).flatMap((l) => {
  if (RUNNER_OWNED.test(l)) return [];
  if (l.startsWith('status ')) {
    // git status lines for runner-owned paths are not repo changes either
    const st = JSON.parse(l.slice(7)).split('\n').filter((s) => s && !/^.. evals\/results\//.test(s));
    return [`status ${JSON.stringify(st.join('\n'))}`];
  }
  return [l];
});
const A = norm(a), B = norm(b);
const diff = [];
for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) diff.push(`  - ${A[i] ?? '<none>'}\n  + ${B[i] ?? '<none>'}`);
if (!diff.length) { console.log('repo fingerprint (excluding runner-owned results): UNCHANGED'); process.exit(0); }
console.log(`repo fingerprint (excluding runner-owned results): DIFFERS (${diff.length} line(s))`);
console.log(diff.map((d) => d.slice(0, 600)).join('\n'));
process.exit(1);
