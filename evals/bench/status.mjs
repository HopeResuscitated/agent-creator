// status.mjs - machine-readable project status, DERIVED (never hand-maintained) from the repository:
// evals/PLAN.yaml (phase statuses, limitations, decisions), evals/baseline-env.json (pins), git, and - unless
// --offline - the live jcode binaries and Ollama. Nothing is written unless --out is given.
//
//   "$NODE_BIN" evals/bench/status.mjs [--offline] [--out <status.json>] [--check]
//
// --check: consistency gate across PLAN.yaml / HANDOFF.md / REPIN.md / baseline-env.json / live state. Exit 1 when
// any check fails (each printed as CHECK FAIL <name>: <why>). The checks encode the current project invariants:
// A2 is the authoritative pin, A3 is a candidate (not pinned, not authoritative), C is not started, D is only
// proposed; they are expected to change ONLY through the re-pin / C / D procedures, together with PLAN.yaml.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import http from 'node:http';
import { execFileSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const yaml = require('js-yaml');
export const A2_BIN = 'C:/Users/cierra/jcode-evalpin-a2-bin/jcode.exe';
export const A3_BIN = 'C:/Users/cierra/jcode-evalpin-a3cand-bin/jcode.exe';

const git = (...a) => { try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const sha256 = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const version = (f) => { try { return execFileSync(f, ['--version'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const getJson = (p) => new Promise((resolve) => { const q = http.get({ host: '127.0.0.1', port: 11434, path: p, agent: false, timeout: 10000 }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); }); q.on('error', () => resolve(null)); q.on('timeout', () => { q.destroy(); resolve(null); }); });
/** "NOT STARTED - BLOCKED on H (...)" -> "NOT STARTED"; "COMPLETE (14f50f2)" -> "COMPLETE" */
export const statusWord = (s) => String(s ?? '').split(/\s+-\s+|\s*\(|;/)[0].trim();

export async function collect({ offline = false } = {}) {
  const plan = yaml.load(fs.readFileSync(path.join(REPO, 'evals', 'PLAN.yaml'), 'utf8'));
  const env = JSON.parse(fs.readFileSync(path.join(REPO, 'evals', 'baseline-env.json'), 'utf8'));
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const s = {
    schema: 'status/1', generated_from: ['evals/PLAN.yaml', 'evals/baseline-env.json', 'git', ...(offline ? [] : ['live jcode binaries', 'live Ollama'])],
    git: { branch, head: git('rev-parse', '--short', 'HEAD'), dirty: (git('status', '--porcelain') ?? '') !== '',
      ahead_of_origin: Number(git('rev-list', '--count', `origin/${branch}..HEAD`) ?? NaN), baseline_tag: env.baseline, baseline_tag_commit: git('rev-parse', '--short', `${env.baseline}^{commit}`) },
    pins: { jcode_sha256: env.jcode_sha256, ollama_version: env.model_server?.ollama_version, model_digests: env.model_server?.models ?? {}, node: env.node, node_sha256: env.node_sha256 },
    phases: Object.fromEntries(Object.entries(plan.phases ?? {}).map(([k, v]) => [k, statusWord(v?.status)])),
    phase_detail: Object.fromEntries(Object.entries(plan.phases ?? {}).map(([k, v]) => [k, String(v?.status ?? '').slice(0, 240)])),
    d_gate_proposal: plan.phases?.D_gate?.proposal ?? null,
    d_gate_approval: plan.phases?.D_gate?.approval ?? null,
    d_gate_result: plan.phases?.D_gate?.result ?? null,
    checkpoint: plan.checkpoint ?? null,
    known_limitations: plan.known_limitations ?? null,
    human_decisions: plan.human_decisions ?? null,
    evidence_classes: plan.evidence_classes ?? null,
  };
  if (!offline) {
    const [ver, tags] = await Promise.all([getJson('/api/version'), getJson('/api/tags')]);
    s.live = {
      jcode_a2: { path: A2_BIN, sha256: sha256(A2_BIN), version: version(A2_BIN) },
      jcode_a3_candidate: { path: A3_BIN, sha256: sha256(A3_BIN), version: version(A3_BIN) },
      ollama_version: ver?.version ?? null,
      model_digests: Object.fromEntries((tags?.models ?? []).filter((m) => Object.keys(s.pins.model_digests).some((k) => m.name === `${k}:latest` || m.name === k)).map((m) => [m.name.replace(/:latest$/, ''), m.digest])),
    };
  }
  return s;
}

export function checks(s, docs) {
  const out = [];
  const c = (name, ok, why) => out.push({ name, ok: !!ok, why: ok ? '' : why });
  const { plan, handoff, repin } = docs;
  const a2 = s.pins.jcode_sha256 ?? '';
  // The pin moved to A3 on 2026-10-04 (REPIN.md steps 1-12 on the CPU target). These checks state the re-pinned
  // contract: baseline-env pins A3, PLAN/HANDOFF say AUTHORITATIVE/PINNED, and A2 is still recorded as superseded.
  const A2_SHA = 'f76eff118ae42e9876727095c100420f485e7ea7a8904d3dd62e93f55beaf8e3', A3_SHA = '42ed4012e129cc36e9d3f3c299b3015fbde5c8cb95cab36ed41f0d526fd0bab7';
  const a3Status = String(s.phase_detail.A3_edit_string_args ?? '');
  c('pin-is-a3', a2 === A3_SHA, `baseline-env.json jcode_sha256 is ${a2.slice(0, 16)}, not the A3 pin ${A3_SHA.slice(0, 16)}`);
  c('pin-sha-in-docs', handoff.includes(a2) && repin.includes(a2), 'HANDOFF.md and REPIN.md must both state the pinned jcode sha256 in full');
  c('pin-sha-prefix-in-plan', plan.includes(a2.slice(0, 16)), 'PLAN.yaml pins.jcode must contain the pinned sha256 prefix');
  c('superseded-a2-still-recorded', plan.includes(A2_SHA.slice(0, 16)) && plan.includes(A2_SHA), 'PLAN.yaml pins.jcode must still record the superseded A2 sha256 (history, not erased)');
  c('a3-authoritative', /AUTHORITATIVE/.test(a3Status) && !/NOT YET AUTHORITATIVE/.test(a3Status), 'PLAN A3 status must read AUTHORITATIVE (re-pin done) and no longer NOT YET AUTHORITATIVE');
  c('a3-wording-handoff', /A3: PINNED/.test(handoff) && !/ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE/.test(handoff), 'HANDOFF must state A3 as PINNED and drop the candidate wording');
  // C ran 2026-10-04/05 (as pre-registered); its record must say COMPLETE and keep the decision-rule verdict visible.
  c('c-complete-recorded', s.phases.C_rebaseline === 'COMPLETE' && /DECISION RULE (NOT )?MET/.test(s.phase_detail.C_rebaseline ?? ''), `PLAN C_rebaseline status is "${s.phases.C_rebaseline}" (expected COMPLETE with a DECISION RULE verdict)`);
  const dText = (JSON.stringify(s.d_gate_proposal ?? '') + ' ' + (s.phase_detail.D_gate ?? '')).replace(/NOT (YET )?(ADOPTED|APPROVED)/g, '');
  // D gate state: either still PROPOSED (no approval record, text never claims ADOPTED/APPROVED), or a human approval record
  // (gate A|B, decision APPROVED) with D pre-registered and NOT STARTED and no D result recorded yet.
  const ap = s.d_gate_approval;
  // After D: status COMPLETE with a recorded result (and a verdict).
  if (ap) c('d-gate-approved-not-started', ['A', 'B'].includes(ap.gate) && ap.decision === 'APPROVED' &&
      ((/NOT STARTED/.test(s.phase_detail.D_gate ?? '') && !s.d_gate_result) || (/^COMPLETE/.test(s.phase_detail.D_gate ?? '') && !!s.d_gate_result?.gate_B?.verdict)),
    `PLAN D_gate approval must be gate A|B with decision APPROVED, and either NOT STARTED with no result or COMPLETE with a result verdict (gate=${ap.gate} decision=${ap.decision})`);
  else c('d-proposed-not-adopted', /PROPOSED/.test(dText) && !/ADOPTED|APPROVED/.test(dText), 'PLAN D_gate must carry the proposal labelled PROPOSED and must not read ADOPTED/APPROVED');
  c('ollama-pin-0.34.4', s.pins.ollama_version === '0.34.4', `pinned Ollama is ${s.pins.ollama_version}`);
  c('plan-branch', !s.git.branch || plan.includes(`branch: ${s.git.branch}`), `PLAN.yaml branch differs from the checked-out ${s.git.branch}`);
  c('baseline-tag-exists', !!s.git.baseline_tag_commit, `tag ${s.git.baseline_tag} missing`);
  c('human-decisions-listed', Array.isArray(s.human_decisions) && s.human_decisions.length > 0, 'PLAN.yaml human_decisions missing/empty');
  if (s.live) {
    const bins = [s.live.jcode_a2, s.live.jcode_a3_candidate];
    const holder = bins.find((b) => b.sha256 === a2);
    c('live-pinned-binary-matches-pin', !!holder, `no known binary matches the pin ${a2.slice(0, 16)} (A2 ${String(s.live.jcode_a2.sha256).slice(0, 16)}, A3 ${String(s.live.jcode_a3_candidate.sha256).slice(0, 16)})`);
    c('live-pin-is-a3-binary', s.live.jcode_a3_candidate.sha256 === a2, `the pinned sha256 is not the A3 binary's (${String(s.live.jcode_a3_candidate.sha256).slice(0, 16)})`);
    c('live-ollama-matches-pin', s.live.ollama_version === s.pins.ollama_version, `running Ollama ${s.live.ollama_version} != pin ${s.pins.ollama_version}`);
    for (const [k, d] of Object.entries(s.pins.model_digests)) c(`live-model-${k}`, s.live.model_digests[k] === d, `${k} digest ${String(s.live.model_digests[k]).slice(0, 16)} != pin ${d.slice(0, 16)}`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const s = await collect({ offline: argv.includes('--offline') });
  if (flag('out')) fs.writeFileSync(flag('out'), JSON.stringify(s, null, 1) + '\n');
  if (argv.includes('--check')) {
    const rd = (f) => fs.readFileSync(path.join(REPO, 'evals', f), 'utf8');
    const res = checks(s, { plan: rd('PLAN.yaml'), handoff: rd('HANDOFF.md'), repin: rd('REPIN.md') });
    for (const r of res) console.log(r.ok ? `CHECK ok   ${r.name}` : `CHECK FAIL ${r.name}: ${r.why}`);
    const f = res.filter((r) => !r.ok).length;
    console.log(`STATUS-CHECK ${f ? `FAIL (${f})` : 'PASS'} (${res.length} checks${s.live ? ', live' : ', offline'})`);
    process.exit(f ? 1 : 0);
  }
  if (!flag('out')) console.log(JSON.stringify(s, null, 1));
}
