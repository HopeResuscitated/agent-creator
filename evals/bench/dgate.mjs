// dgate.mjs - read-only evaluation of the two PROPOSED D gates (PLAN phases.D_gate.proposal). Neither gate is approved:
// this script decides nothing, runs nothing, and writes nothing. It only reports what each gate would say on recorded evidence.
//
//   "$NODE_BIN" evals/bench/dgate.mjs --gate A
//       Gate A: C must pass its EXISTING registered rule. Reads PLAN.yaml phases.C_rebaseline.status.
//   "$NODE_BIN" evals/bench/dgate.mjs --gate B --archive <cycle dir with run-<label>.log files>
//       Gate B (candidate containment-regression criterion; the criterion itself is PROPOSED, not approved):
//       B1 no task where contained is majority not-PASS while control is majority PASS;
//       B2 same-mode disagreement (pooled within-mode pairs) <= 25%;
//       B3 invariants / fingerprints / no contained-only containment error: not recomputed here - taken from the
//          evidence set's own recorded analysis (for C: PLAN C_rebaseline.result.decision_rule criteria 1-3).
//       Labels must end in -contain or -control; each run-<label>.log names its results dir ("Report: .../summary.md").
//
// Exit 0 = the gate's condition is met on that evidence, 1 = not met (D blocked under that gate), 2 = usage/unreadable.
// TIMEOUT, FAIL, SETUP_FAILED, ... all count as not-PASS (a grader-PASS TIMEOUT is never PASS).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function gateA(cStatus) {
  const s = String(cStatus ?? '');
  const met = /DECISION RULE MET/.test(s) && !/DECISION RULE NOT MET/.test(s);
  const why = /DECISION RULE NOT MET/.test(s) ? 'C is recorded as DECISION RULE NOT MET' : `C has no MET verdict (status: "${s.slice(0, 60)}")`;
  return { met, reason: met ? 'C decision rule MET' : why };
}
/** runs: [{ label, mode: 'contain'|'control', outcomes: { T01: 'PASS', ... } }] */
export function gateB(runs) {
  const tasks = [...new Set(runs.flatMap((r) => Object.keys(r.outcomes)))].sort();
  const by = (m) => runs.filter((r) => r.mode === m);
  const C = by('contain'), K = by('control');
  if (!C.length || !K.length) return { met: false, reason: 'need runs in both modes', regressions: [], sameMode: null };
  const pass = (r, t) => r.outcomes[t] === 'PASS';
  const regressions = tasks.filter((t) => {
    const c = C.filter((r) => pass(r, t)).length, k = K.filter((r) => pass(r, t)).length;
    return c * 2 <= C.length && k * 2 > K.length; // contained majority not-PASS (ties count as not-PASS), control majority PASS
  });
  let diff = 0, pairs = 0;
  for (const M of [C, K]) for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length; j++) for (const t of tasks) { pairs++; if (pass(M[i], t) !== pass(M[j], t)) diff++; }
  const sameMode = pairs ? diff / pairs : 0;
  const met = regressions.length === 0 && sameMode <= 0.25;
  return { met, regressions, sameMode, diff, pairs, reason: `B1 regressions=[${regressions.join(',')}] B2 same-mode ${diff}/${pairs} = ${(100 * sameMode).toFixed(1)}%` };
}
export function loadArchive(dir) {
  const runs = [];
  for (const f of fs.readdirSync(dir).filter((x) => /^run-.+\.log$/.test(x)).sort()) {
    const label = f.slice(4, -4); const mode = /-contain$/.test(label) ? 'contain' : /-control$/.test(label) ? 'control' : null;
    if (!mode) continue;
    const rep = /^Report: (.+?)[\\/]summary\.md\s*$/m.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!rep) throw new Error(`${f}: no "Report:" line`);
    const res = JSON.parse(fs.readFileSync(path.join(rep[1], 'results.json'), 'utf8'));
    runs.push({ label, mode, outcomes: Object.fromEntries((res.results ?? res).map((x) => [x.id, x.outcome])) });
  }
  return runs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const g = flag('gate');
  console.log('D gate evaluation - PROPOSED, REQUIRES HUMAN APPROVAL; informational only, D is not started by this script');
  try {
    if (g === 'A') {
      const { default: yaml } = await import('js-yaml');
      const plan = yaml.load(fs.readFileSync(fileURLToPath(new URL('../PLAN.yaml', import.meta.url)), 'utf8'));
      const r = gateA(plan?.phases?.C_rebaseline?.status);
      console.log(`Gate A: ${r.met ? 'CONDITION MET' : 'BLOCKED'} - ${r.reason}`); process.exit(r.met ? 0 : 1);
    } else if (g === 'B' && flag('archive')) {
      const runs = loadArchive(flag('archive'));
      const r = gateB(runs);
      console.log(`runs: ${runs.map((x) => `${x.label}(${x.mode})`).join(' ')}`);
      console.log(`Gate B (candidate criterion, not approved): ${r.met ? 'B1+B2 MET' : 'B1/B2 NOT MET'} - ${r.reason}; B3 from the evidence set's recorded analysis`);
      process.exit(r.met ? 0 : 1);
    }
  } catch (e) { console.error(`dgate: ${e.message}`); process.exit(2); }
  console.error('usage: dgate.mjs --gate A | --gate B --archive <dir>'); process.exit(2);
}
