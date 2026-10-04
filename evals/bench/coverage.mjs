// coverage.mjs - 18-task coverage matrix, derived from evals/results/*/ and the evidence archive (read-only).
//
//   node evals/bench/coverage.mjs [--archive C:/Users/cierra/hermes-bench-archive] [--json]
//
// For every task: the newest jcode run per mode on the CURRENT pin (baseline-env.json jcode_sha256) that belongs to an
// evidence run, plus the newest run on any pin. Results are shown AS RECORDED (no reclassification): outcome when
// results.json has it, else PASS/FAIL with "(to)" when the run hit its time limit, and the env class when not CLEAN.
// Evidence class of a results dir = the archive folder whose suite logs name it:
// (aligned with PLAN.yaml evidence_classes)
//   authoritative: cycle9/a2val3-VALID, cycle9/b6-phaseB-AC, cycle9/final-regression, cycle9/pre-c-prep (T01 x4)
//   historical:    cycle9/b5-phaseB, cycle6..cycle8, other archived runs
//   historical-contaminated: cycle9/contaminated-run* (PLAN: historical; never used as a task result here)
//   not-evidence:  runs not referenced by any archived suite log (ad-hoc/debug)
//   INVALID:       listed in evals/INVALIDATIONS.md (by run dir + task)
// C / D columns come from PLAN.yaml (C task list; D proposal = all 18, PROPOSED NOT APPROVED).
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RES = path.join(REPO, 'evals', 'results');

export function recordedLabel(r) {
  if (r.outcome) return r.outcome === 'TIMEOUT' ? `TIMEOUT(grader ${r.graderPass ? 'PASS' : 'FAIL'})` : r.outcome;
  if (r.env && r.env !== 'CLEAN') return `${r.env}(grader ${r.graderPass ? 'PASS' : 'FAIL'})`;
  return `${r.pass ? 'PASS' : 'FAIL'}${r.timedOut ? '(to)' : ''}`;
}
export function modeOf(baselineTxt) {
  const c = /^containment: (.*)$/m.exec(baselineTxt)?.[1] ?? '';
  if (/^appcontainer/.test(c)) return 'contained';
  if (/config-equivalent control/.test(c)) return 'control';
  if (/^OFF/.test(c)) return 'control-userconfig';
  return 'unknown';
}
export function classOf(archiveFolder) {
  if (!archiveFolder) return 'not-evidence';
  if (/contaminated/.test(archiveFolder)) return 'historical-contaminated';
  if (/^cycle9[\\/](a2val3-VALID|b6-phaseB-AC|final-regression|pre-c-prep)/.test(archiveFolder)) return 'authoritative';
  return 'historical';
}

export function collect(archive) {
  // results dir name -> archive folder (first two path levels below the archive root)
  const owner = new Map();
  const walk = (d, depth) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name);
    if (e.isDirectory() && depth < 6 && e.name !== 'raw' && e.name !== 'node_modules') walk(p, depth + 1);
    else if (e.isFile() && /\.(log|out|txt)$/.test(e.name) && fs.statSync(p).size < 5e6) { const t = fs.readFileSync(p, 'utf8'); for (const m of t.matchAll(/results[\\/](\d{4}-\d\d-\d\d-\d\d-\d\d_[\w.-]+)/g)) if (!owner.has(m[1])) owner.set(m[1], path.relative(archive, p).split(/[\\/]/).slice(0, 2).join('/')); } } };
  if (archive && fs.existsSync(archive)) walk(archive, 0);
  const inv = fs.readFileSync(path.join(REPO, 'evals', 'INVALIDATIONS.md'), 'utf8');
  const invalid = new Set([...inv.matchAll(/^## INV-\d+: (T\d\d), run (\S+)/gm)].map((m) => `${m[2]}|${m[1]}`));
  const rows = [];
  for (const dir of fs.readdirSync(RES).sort()) {
    const rf = path.join(RES, dir, 'results.json'), bf = path.join(RES, dir, 'baseline.txt');
    if (!fs.existsSync(rf) || !fs.existsSync(bf)) continue;
    const b = fs.readFileSync(bf, 'utf8'); const sha = /^jcode: .* sha256=([0-9a-f]{64})/m.exec(b)?.[1] ?? null;
    if (!/_ollama-/.test(dir)) continue; // jcode runs only (agent none/reference dirs are named _baseline/_reference)
    let res; try { res = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch { continue; }
    const folder = owner.get(dir) ?? null;
    for (const r of res) rows.push({ dir, task: r.id, sha, mode: modeOf(b), label: recordedLabel(r), seconds: r.seconds,
      cls: invalid.has(`${dir}|${r.id}`) ? 'INVALID' : classOf(folder), folder });
  }
  return rows;
}

export function matrix(rows, { pinSha, cTasks, tasks }) {
  const last = (xs) => xs[xs.length - 1] ?? null;
  return tasks.map((t) => {
    const mine = rows.filter((r) => r.task === t);
    const onPin = mine.filter((r) => r.sha === pinSha && (r.cls === 'authoritative' || r.cls === 'historical'));
    const pc = last(onPin.filter((r) => r.mode === 'contained')), pd = last(onPin.filter((r) => r.mode === 'control'));
    const any = last(mine.filter((r) => r.cls === 'authoritative' || r.cls === 'historical'));
    const inC = cTasks.includes(t);
    return { task: t, last_any: any ? `${any.dir.slice(0, 16)} ${any.label} [${any.cls}, ${any.mode}, ${any.sha ? any.sha.slice(0, 8) : 'no-pin'}]` : 'never',
      pin_contained: pc ? `${pc.label} (${pc.dir.slice(0, 16)}, ${pc.cls})` : 'not run', pin_control: pd ? `${pd.label} (${pd.dir.slice(0, 16)}, ${pd.cls})` : 'not run',
      post_a2_required: inC ? 'yes (C task)' : 'only if the D proposal is adopted', in_C: inC ? 'yes' : 'no', in_D_proposal: 'yes (PROPOSED, not approved)' };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const require = createRequire(path.join(REPO, 'package.json'));
  const plan = require('js-yaml').load(fs.readFileSync(path.join(REPO, 'evals', 'PLAN.yaml'), 'utf8'));
  const env = JSON.parse(fs.readFileSync(path.join(REPO, 'evals', 'baseline-env.json'), 'utf8'));
  const rows = collect(flag('archive') ?? 'C:/Users/cierra/hermes-bench-archive');
  const tasks = Array.from({ length: 18 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);
  const m = matrix(rows, { pinSha: env.jcode_sha256, cTasks: plan.phases.C_rebaseline.tasks, tasks });
  if (argv.includes('--json')) { console.log(JSON.stringify({ pin: env.jcode_sha256, rows: m }, null, 1)); process.exit(0); }
  console.log(`pin ${env.jcode_sha256.slice(0, 16)} (current) | results dirs scanned: ${new Set(rows.map((r) => r.dir)).size} | archive-linked: ${new Set(rows.filter((r) => r.folder).map((r) => r.dir)).size}`);
  console.log('| Task | Last run (any pin, evidence) | Current pin: contained | Current pin: control | Post-A2/hardware run required? | C | D (proposal) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of m) console.log(`| ${r.task} | ${r.last_any} | ${r.pin_contained} | ${r.pin_control} | ${r.post_a2_required} | ${r.in_C} | ${r.in_D_proposal} |`);
}
