// C preflight negative testing (fixtures, no live state): every prerequisite missing one at a time keeps it BLOCKED;
// a fully satisfied future state (static + live + tests) is READY; nothing here starts C. Also the repin.mjs record
// handling with a fake stage implementation (no hardware, no Ollama, no commits).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { staticChecks, liveChecks, verdict, PREREG_KEYS, REPIN_STAGES } from '../bench/cpreflight.mjs';
import { main as repinMain, STAGES, parseRecord } from '../bench/repin.mjs';
import { fileURLToPath } from 'node:url';

const EVALS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(64), DIG = 'b'.repeat(64), FP = 'e'.repeat(64), OENV = { OLLAMA_KV_CACHE_TYPE: 'q8_0', OLLAMA_FLASH_ATTENTION: 'true' };

function future() {
  return {
    plan: { branch: 'b', pins: { t01_fingerprint: `${FP} (A3 pin)` }, phases: { H_hardware: { status: 'DECIDED', quant_decision: { quant: 'Q4_K_M', numbers: { malformed_rate: 0 } } }, A3_edit_string_args: { status: 'AUTHORITATIVE (pinned at re-pin)' }, C_rebaseline: { status: 'NOT STARTED', preregistration: { ...Object.fromEntries(PREREG_KEYS.map((k) => [k, 'x'])), quant: 'Q4_K_M' } } } },
    env: { jcode_sha256: SHA, model_server: { ollama_version: '0.34.4', models: { 'hermes-local-32k': DIG } } },
    record: { schema: 'repin-record/1', jcode_bin: 'C:/x/jcode.exe', ollama_env: { ...OENV }, completed: 'x',
      stages: { ...Object.fromEntries(REPIN_STAGES.map((s) => [s, { status: 'PASS' }])), '1': { status: 'PASS', checks: [{ name: 'gpu-visible (discrete: nvidia-smi or ROCm)', ok: true }] }, '11': { status: 'PASS', data: { t01_fingerprint: FP } }, '12': { status: 'PASS', data: { quant: 'Q4_K_M' } } },
      pins: { jcode_sha256: SHA, models: { 'hermes-local-32k': DIG }, ollama_version: '0.34.4' } },
    gitClean: true, branch: 'b',
    io: { sha256: () => SHA, version: async () => '0.34.4', tags: async () => [{ name: 'hermes-local-32k:latest', digest: DIG }], warm: async () => null,
      ps: async () => [{ name: 'hermes-local-32k:latest', size: 20e9, size_vram: 20e9 }], ollamaEnv: () => ({ ...OENV }), autoUpdate: () => 0,
      battery: () => '2', jcodeCount: () => '0', meterPort: () => '0', ollamaConns: () => '0' },
    tests: [{ name: 'tests-offline', ok: true, why: '' }, { name: 'tests-lint', ok: true, why: '' }],
  };
}
async function evaluate(s) {
  const res = [...staticChecks(s), ...(await liveChecks({ env: s.env, record: s.record, warm: true }, s.io)), ...s.tests];
  return { ...verdict(res), blocked: res.filter((r) => !r.ok).map((r) => r.name) };
}

test('fully satisfied future state: READY FOR C (logic only; C is not started)', async () => {
  const v = await evaluate(future());
  assert.deepEqual(v.blocked, []); assert.equal(v.ready, true); assert.equal(v.line, 'READY FOR C');
});

// The user-facing prerequisites, each removed alone: exactly the expected check(s) block.
const MISSING = {
  'hardware decision open': [(s) => { s.plan.phases.H_hardware.status = 'BLOCKED - open decision'; }, ['plan-h-decided']],
  'GPU not visible at re-pin': [(s) => { s.record.stages['1'].checks[0].ok = false; }, ['repin-gpu-visible']],
  'GPU placement not 100% (CPU/GPU split)': [(s) => { s.io.ps = async () => [{ name: 'hermes-local-32k:latest', size: 20e9, size_vram: 12e9 }]; }, ['live-placement-100-gpu']],
  'model not loaded (placement unverifiable)': [(s) => { s.io.ps = async () => []; }, ['live-placement-100-gpu']],
  'A3 still candidate in PLAN': [(s) => { s.plan.phases.A3_edit_string_args.status = 'ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE'; }, ['plan-a3-authoritative']],
  'A3 binary missing / hash differs': [(s) => { s.io.sha256 = () => null; }, ['live-jcode']],
  'no re-pin record': [(s) => { s.record = null; }, ['repin-record', 'live-jcode', 'live-ollama-env']],
  're-pin record failed': [(s) => { s.record.failed = true; s.record.failed_stage = '7-10'; }, ['repin-not-failed']],
  'T01x4 stage not PASS': [(s) => { s.record.stages['11'].status = 'FAIL'; }, ['repin-stages-pass']],
  'T01x4 fingerprint not in PLAN': [(s) => { s.plan.pins.t01_fingerprint = 'df1332d7 (A2)'; }, ['repin-t01-fingerprint-in-plan']],
  'quant stage not PASS': [(s) => { delete s.record.stages['12']; }, ['repin-stages-pass', 'repin-quant-consistent']],
  'quant decision missing': [(s) => { delete s.plan.phases.H_hardware.quant_decision; }, ['repin-quant-consistent']],
  'Ollama settings not recorded': [(s) => { s.record.ollama_env = null; }, ['repin-ollama-env-recorded', 'live-ollama-env']],
  'Ollama settings changed since re-pin': [(s) => { s.io.ollamaEnv = () => ({ ...OENV, OLLAMA_KV_CACHE_TYPE: 'f16' }); }, ['live-ollama-env']],
  'Ollama settings unreadable': [(s) => { s.io.ollamaEnv = () => null; }, ['live-ollama-env']],
  'Ollama auto-update ON': [(s) => { s.io.autoUpdate = () => 1; }, ['ollama-auto-update-off']],
  'Ollama auto-update unreadable': [(s) => { s.io.autoUpdate = () => null; }, ['ollama-auto-update-off']],
  'Ollama upgraded (version != pin)': [(s) => { s.io.version = async () => '0.35.1'; }, ['live-ollama-version']],
  'Ollama unreachable': [(s) => { s.io.version = async () => null; s.io.tags = async () => null; s.io.ps = async () => null; }, ['live-ollama-version', 'live-model-digest', 'live-placement-100-gpu']],
  'model digest != pin': [(s) => { s.io.tags = async () => [{ name: 'hermes-local-32k:latest', digest: 'c'.repeat(64) }]; }, ['live-model-digest']],
  'C not pre-registered': [(s) => { delete s.plan.phases.C_rebaseline.preregistration; }, ['repin-quant-consistent', 'plan-c-preregistered']],
  'C pre-registration incomplete': [(s) => { s.plan.phases.C_rebaseline.preregistration.decision_rule = ''; }, ['plan-c-preregistered']],
  'C already started': [(s) => { s.plan.phases.C_rebaseline.status = 'IN PROGRESS'; }, ['plan-c-not-started']],
  'final env: on battery': [(s) => { s.io.battery = () => '1'; }, ['machine-ac']],
  'final env: battery unreadable': [(s) => { s.io.battery = () => null; }, ['machine-ac']],
  'final env: jcode running': [(s) => { s.io.jcodeCount = () => '1'; }, ['machine-no-jcode']],
  'final env: meter port busy': [(s) => { s.io.meterPort = () => '1'; }, ['machine-meter-port-free']],
  'final env: another Ollama client': [(s) => { s.io.ollamaConns = () => '2'; }, ['machine-ollama-exclusive']],
  'final env: process probe failed': [(s) => { s.io.jcodeCount = () => null; s.io.meterPort = () => null; s.io.ollamaConns = () => null; }, ['machine-no-jcode', 'machine-meter-port-free', 'machine-ollama-exclusive']],
  'final env: uncommitted changes': [(s) => { s.gitClean = false; }, ['git-clean']],
  'pins changed after the re-pin': [(s) => { s.env.model_server.models['hermes-local-32k'] = 'c'.repeat(64); s.io.tags = async () => [{ name: 'hermes-local-32k:latest', digest: 'c'.repeat(64) }]; }, ['repin-pins-current']],
  'offline tests failing': [(s) => { s.tests[0].ok = false; }, ['tests-offline']],
  '--skip-tests': [(s) => { s.tests = [{ name: 'tests', ok: false, why: 'skip' }]; }, ['tests']],
};
for (const [name, [mut, want]] of Object.entries(MISSING)) {
  test(`BLOCKED when missing: ${name}`, async () => {
    const s = future(); mut(s); const v = await evaluate(s);
    assert.equal(v.ready, false); assert.match(v.line, /^BLOCKED: /);
    assert.deepEqual(v.blocked, want);
  });
}

test('verdict fails closed: no checks at all is BLOCKED, never READY', () => {
  assert.equal(verdict([]).ready, false); assert.match(verdict([]).line, /^BLOCKED/);
});

test('every live probe failing (machine unreadable) blocks every live check', async () => {
  const s = future(); for (const k of Object.keys(s.io)) s.io[k] = k === 'warm' ? async () => null : ['version', 'tags', 'ps'].includes(k) ? async () => null : () => null;
  const v = await evaluate(s);
  assert.equal(v.ready, false);
  for (const n of ['live-jcode', 'live-ollama-version', 'live-model-digest', 'live-placement-100-gpu', 'live-ollama-env', 'ollama-auto-update-off', 'machine-ac', 'machine-no-jcode', 'machine-meter-port-free', 'machine-ollama-exclusive']) assert.ok(v.blocked.includes(n), n);
});

// ---- repin.mjs record handling (fake stages; real gate/record code) ----
const quiet = async (fn) => { const log = console.log, err = console.error; const lines = []; console.log = (...a) => lines.push(a.join(' ')); console.error = console.log; try { return { code: await fn(), lines }; } finally { console.log = log; console.error = err; } };
function fakeImpl(failAt = null, seen = []) {
  const impl = {};
  for (const id of STAGES) impl[id] = async ({ R, record, apply }) => {
    seen.push(id);
    if (id === '7-10') { fs.mkdirSync(path.join(R, 'gates'), { recursive: true }); fs.writeFileSync(path.join(R, 'gates', 'gates.log'), 'GATES PASS\n'); }
    if (id === '11') { fs.mkdirSync(path.join(R, 't01x4'), { recursive: true }); fs.writeFileSync(path.join(R, 't01x4', 'fp.txt'), FP); }
    if (id === '1') fs.writeFileSync(path.join(R, 'hwprofile.json'), '{}');
    const data = { '1': { ollama_env: OENV }, '3': { model_digest: DIG, quantization_level: 'Q4_K_M' }, '4': { jcode_bin: 'x', jcode_sha256: SHA }, '5-6': { pins: { jcode_sha256: SHA } }, '11': { t01_fingerprint: FP }, '12': { quant: 'Q4_K_M' } }[id];
    return { checks: [{ name: `fake-${id}`, ok: id !== failAt, detail: apply ? 'apply' : '' }], data };
  };
  return impl;
}
const tmpR = () => fs.mkdtempSync(path.join(os.tmpdir(), 'repin-fixture-'));
const envCopy = (R) => { const f = path.join(R, '..', `${path.basename(R)}-env.json`); fs.copyFileSync(path.join(EVALS, 'baseline-env.json'), f); return f; };

test('repin: all stages in order -> complete record with artifact hashes; no stage re-runs in place', async () => {
  const R = tmpR(); const envFile = envCopy(R); const impl = fakeImpl();
  for (const id of STAGES) {
    const r = await quiet(() => repinMain(['--out', R, '--stage', id, ...(id === '5-6' ? ['--apply'] : [])], { impl, envFile }));
    assert.equal(r.code, 0, `${id}: ${r.lines.join('|')}`);
  }
  const rec = JSON.parse(fs.readFileSync(path.join(R, 'repin-record.json'), 'utf8'));
  assert.ok(rec.completed); assert.deepEqual(Object.keys(rec.stages).sort(), [...STAGES].sort());
  assert.match(rec.stages['7-10'].artifacts['gates/gates.log'], /^[0-9a-f]{64}$/);
  assert.match(rec.stages['11'].artifacts['t01x4/fp.txt'], /^[0-9a-f]{64}$/);
  assert.match(rec.stages['1'].artifacts['hwprofile.json'], /^[0-9a-f]{64}$/);
  for (const id of ['1', '3', '11']) {
    const r = await quiet(() => repinMain(['--out', R, '--stage', id], { impl, envFile }));
    assert.equal(r.code, 1); assert.match(r.lines.join('\n'), /already recorded/);
  }
});

test('repin: out of order is refused; a FAIL locks; --restart archives record + outputs, nothing deleted', async () => {
  const R = tmpR(); const envFile = envCopy(R); const impl = fakeImpl('7-10');
  assert.equal((await quiet(() => repinMain(['--out', R, '--stage', '3'], { impl, envFile }))).code, 1);
  assert.ok(!fs.existsSync(path.join(R, 'repin-record.json')), 'a refused stage writes nothing');
  for (const id of ['1', '2', '3', '4']) assert.equal((await quiet(() => repinMain(['--out', R, '--stage', id], { impl, envFile }))).code, 0);
  assert.equal((await quiet(() => repinMain(['--out', R, '--stage', '5-6', '--apply'], { impl, envFile }))).code, 0);
  assert.equal((await quiet(() => repinMain(['--out', R, '--stage', '7-10'], { impl, envFile }))).code, 1);
  const locked = await quiet(() => repinMain(['--out', R, '--stage', '11'], { impl, envFile }));
  assert.equal(locked.code, 1); assert.match(locked.lines.join('\n'), /FAILED at stage 7-10/);
  const rs = await quiet(() => repinMain(['--out', R, '--restart'], { impl, envFile }));
  assert.equal(rs.code, 0);
  const arch = fs.readdirSync(R).filter((d) => d.startsWith('attempt-'));
  assert.equal(arch.length, 1);
  for (const f of ['repin-record.json', 'hwprofile.json', 'gates']) assert.ok(fs.existsSync(path.join(R, arch[0], f)), f);
  assert.ok(!fs.existsSync(path.join(R, 'repin-record.json')) && !fs.existsSync(path.join(R, 'gates')));
  assert.equal((await quiet(() => repinMain(['--out', R, '--stage', '1'], { impl: fakeImpl(), envFile }))).code, 0);
});

test('repin: 5-6 without --apply is refused and records nothing (no FAIL lock)', async () => {
  const R = tmpR(); const envFile = envCopy(R); const impl = fakeImpl();
  for (const id of ['1', '2', '3', '4']) await quiet(() => repinMain(['--out', R, '--stage', id], { impl, envFile }));
  const r = await quiet(() => repinMain(['--out', R, '--stage', '5-6'], { impl, envFile }));
  assert.equal(r.code, 2);
  const rec = JSON.parse(fs.readFileSync(path.join(R, 'repin-record.json'), 'utf8'));
  assert.equal(rec.failed, undefined); assert.equal(rec.stages['5-6'], undefined);
});

test('repin: a damaged record is refused (never silently replaced by a new one); --restart archives it', async () => {
  const R = tmpR(); const envFile = envCopy(R);
  fs.writeFileSync(path.join(R, 'repin-record.json'), '{"schema":"repin-record/1","stages":{"1":{"status":"PA');
  const r = await quiet(() => repinMain(['--out', R, '--stage', '1'], { impl: fakeImpl(), envFile }));
  assert.equal(r.code, 1); assert.match(r.lines.join('\n'), /unreadable/);
  assert.throws(() => parseRecord('{"stages":{}}'));
  assert.throws(() => parseRecord('[]'));
  assert.equal((await quiet(() => repinMain(['--out', R, '--restart'], {}))).code, 0);
  assert.equal((await quiet(() => repinMain(['--out', R, '--stage', '1'], { impl: fakeImpl(), envFile }))).code, 0);
});

test('repin: leftover outputs from an unrecorded run are not overwritten', async () => {
  const R = tmpR(); const envFile = envCopy(R); fs.writeFileSync(path.join(R, 'hwprofile.json'), 'old');
  const r = await quiet(() => repinMain(['--out', R, '--stage', '1'], { impl: fakeImpl(), envFile }));
  assert.equal(r.code, 1); assert.equal(fs.readFileSync(path.join(R, 'hwprofile.json'), 'utf8'), 'old');
});

test('repin: stages after 5-6 refuse when baseline-env.json changed after the pin commit', async () => {
  const R = tmpR(); const envFile = envCopy(R); const impl = fakeImpl();
  for (const id of ['1', '2', '3', '4']) await quiet(() => repinMain(['--out', R, '--stage', id], { impl, envFile }));
  await quiet(() => repinMain(['--out', R, '--stage', '5-6', '--apply'], { impl, envFile }));
  fs.appendFileSync(envFile, ' ');
  const r = await quiet(() => repinMain(['--out', R, '--stage', '7-10'], { impl, envFile }));
  assert.equal(r.code, 1); assert.match(r.lines.join('\n'), /changed since stage 5-6/);
});

test('repin: a stage reporting no checks is a FAIL, not a PASS', async () => {
  const R = tmpR(); const envFile = envCopy(R); const impl = fakeImpl(); impl['1'] = async () => ({ checks: [] });
  assert.equal((await quiet(() => repinMain(['--out', R, '--stage', '1'], { impl, envFile }))).code, 1);
});

test('repin.mjs: A3 is pinned only by stage 5-6, and PLAN.yaml is never edited by the script', () => {
  const src = fs.readFileSync(path.join(EVALS, 'bench', 'repin.mjs'), 'utf8');
  assert.equal((src.match(/fs\.writeFileSync\(ENVF/g) ?? []).length, 1);
  assert.ok(!/writeFileSync\([^)]*PLAN\.yaml/.test(src));
  assert.equal((src.match(/git\('commit'/g) ?? []).length, 1);
});
