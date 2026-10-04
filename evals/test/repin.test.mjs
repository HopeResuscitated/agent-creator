// Tests for the pure logic of evals/bench/repin.mjs and evals/bench/cpreflight.mjs (no live system touched).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gate, editPins, modelfileDiff, STAGES } from '../bench/repin.mjs';
import { staticChecks, PREREG_KEYS, REPIN_STAGES, A2_SHA, CPU_MODEL_DIGEST } from '../bench/cpreflight.mjs';
import { targetOf, placementOk, requiredModelDigest, hardwareCheck } from '../bench/target.mjs';

const EVALS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = (ids, extra = {}) => ({ stages: Object.fromEntries(ids.map((i) => [i, { status: 'PASS', env_sha: 'E' }])), ...extra });

test('gate: stages run strictly in order', () => {
  assert.equal(gate(pass([]), '1', 'E'), null);
  assert.match(gate(pass([]), '2', 'E'), /stage 1 is not PASS/);
  assert.match(gate(pass(['1', '2', '4']), '5-6', 'E'), /stage 3 is not PASS/);
  assert.equal(gate(pass(['1', '2', '3', '4']), '5-6', 'E'), null);
  assert.match(gate(pass([]), '13', 'E'), /unknown stage/);
});
test('gate: a FAIL locks the record until --restart', () => {
  assert.match(gate(pass(['1'], { failed: true, failed_stage: '2' }), '2', 'E'), /FAILED at stage 2/);
  assert.match(gate(pass(['1', '2'], { failed: true, failed_stage: '3' }), '1', 'E'), /FAILED/);
});
test('gate: stages after 5-6 need the committed pins unchanged', () => {
  const r = pass(['1', '2', '3', '4', '5-6']);
  assert.equal(gate(r, '7-10', 'E'), null);
  assert.match(gate(r, '7-10', 'OTHER'), /baseline-env.json changed/);
});
test('editPins: changes exactly the pinned values, keeps CRLF and every other byte', () => {
  const real = fs.readFileSync(path.join(EVALS, 'baseline-env.json'), 'utf8');
  const j = 'a'.repeat(64), d = 'b'.repeat(64);
  const next = editPins(real, { jcodeSha: j, digest: d, ollamaVersion: '0.34.4' });
  assert.equal(next.length, real.length);
  assert.equal(next.includes('\r\n'), real.includes('\r\n'));
  const parsed = JSON.parse(next), orig = JSON.parse(real);
  assert.equal(parsed.jcode_sha256, j); assert.equal(parsed.model_server.models['hermes-local-32k'], d);
  assert.deepEqual({ ...parsed, jcode_sha256: orig.jcode_sha256, model_server: orig.model_server }, orig);
  const a = real.split('\n'), b = next.split('\n');
  assert.equal(b.filter((l, i) => l !== a[i]).length, 2);
  assert.throws(() => editPins('{"x":1}', { jcodeSha: j, digest: d }), /not found exactly once/);
});
test('modelfileDiff: only the num_gpu 0 line may go', () => {
  const cpu = '# Modelfile\nFROM C:\\b\\sha256-1194192c\nTEMPLATE x\nPARAMETER num_ctx 32768\nPARAMETER num_gpu 0\nPARAMETER temperature 0.15\n';
  const gpu = cpu.replace('PARAMETER num_gpu 0\n', '');
  assert.equal(modelfileDiff(cpu, gpu).ok, true);
  assert.equal(modelfileDiff(cpu, cpu).ok, false);
  assert.equal(modelfileDiff(cpu, gpu.replace('0.15', '0.2')).ok, false);
  assert.equal(modelfileDiff(cpu, cpu.replace('PARAMETER num_gpu 0\n', 'PARAMETER num_gpu 99\n')).ok, false);
  assert.equal(modelfileDiff(cpu, gpu.replace('1194192c', 'deadbeef')).ok, false);
  assert.equal(modelfileDiff(cpu.replace(/\n/g, '\r\n'), gpu).ok, true);
});
test('cpreflight and repin agree on the stage list', () => { assert.deepEqual(REPIN_STAGES, STAGES); });

const FP = 'e'.repeat(64);
const ready = () => ({
  plan: { branch: 'b', pins: { t01_fingerprint: `${FP} (A3 pin, re-pin 2026-xx CPU)` }, phases: { H_hardware: { status: 'DECIDED - current CPU machine is the evaluation target', target_environment: { placement: 'CPU' }, quant_decision: { quant: 'Q4_K_M', numbers: {} } }, A3_edit_string_args: { status: 'AUTHORITATIVE (pinned)' }, C_rebaseline: { status: 'NOT STARTED - ready', preregistration: { ...Object.fromEntries(PREREG_KEYS.map((k) => [k, 'x'])), quant: 'Q4_K_M' } } } },
  env: { jcode_sha256: 'a'.repeat(64), model_server: { ollama_version: '0.34.4', models: { 'hermes-local-32k': CPU_MODEL_DIGEST } } },
  record: { schema: 'repin-record/1', target: 'CPU', stages: { ...Object.fromEntries(REPIN_STAGES.map((s) => [s, { status: 'PASS' }])), '1': { status: 'PASS', checks: [{ name: 'target-hardware (CPU)', ok: true }] }, '11': { status: 'PASS', data: { t01_fingerprint: FP } }, '12': { status: 'PASS', data: { quant: 'Q4_K_M' } } },
    ollama_env: { OLLAMA_KV_CACHE_TYPE: 'q8_0' }, pins: { jcode_sha256: 'a'.repeat(64), models: { 'hermes-local-32k': CPU_MODEL_DIGEST }, ollama_version: '0.34.4' } },
  gitClean: true, branch: 'b',
});
const blocked = (st) => staticChecks(st).filter((r) => !r.ok).map((r) => r.name);
test('cpreflight: a fully satisfied state has no static blocker (READY is reachable)', () => { assert.deepEqual(blocked(ready()), []); });
test('cpreflight: each missing prerequisite blocks', () => {
  const m = (f) => { const s = ready(); f(s); return blocked(s); };
  assert.deepEqual(m((s) => { s.record = null; }), ['repin-record']);
  assert.deepEqual(m((s) => { s.record.failed = true; }), ['repin-not-failed']);
  assert.deepEqual(m((s) => { s.record.stages['11'].status = 'FAIL'; }), ['repin-stages-pass']);
  assert.deepEqual(m((s) => { s.record.pins.jcode_sha256 = 'c'.repeat(64); }), ['repin-pins-current']);
  assert.ok(m((s) => { s.env.jcode_sha256 = A2_SHA; s.record.pins.jcode_sha256 = A2_SHA; }).includes('pin-not-a2'));
  assert.deepEqual(m((s) => { s.env.model_server.models['hermes-local-32k'] = 'b'.repeat(64); s.record.pins.models['hermes-local-32k'] = 'b'.repeat(64); }), ['pin-model-fits-target']);
  assert.deepEqual(m((s) => { s.plan.phases.H_hardware.status = 'BLOCKED - open decision'; }), ['plan-h-decided']);
  assert.deepEqual(m((s) => { s.plan.phases.A3_edit_string_args.status = 'ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE'; }), ['plan-a3-authoritative']);
  assert.deepEqual(m((s) => { s.plan.phases.C_rebaseline.status = 'IN PROGRESS'; }), ['plan-c-not-started']);
  assert.deepEqual(m((s) => { delete s.plan.phases.C_rebaseline.preregistration.timeouts; }), ['plan-c-preregistered']);
  assert.deepEqual(m((s) => { s.gitClean = false; }), ['git-clean']);
  assert.deepEqual(m((s) => { s.record.stages['1'].checks[0].ok = false; }), ['repin-target-hardware']);
  assert.deepEqual(m((s) => { s.record.ollama_env = null; }), ['repin-ollama-env-recorded']);
  assert.deepEqual(m((s) => { s.record.ollama_env = {}; }), ['repin-ollama-env-recorded']);
  assert.deepEqual(m((s) => { s.plan.pins.t01_fingerprint = 'df1332d786b0ee3b57f58eb6e7eff90a69e366e5998efe8f9d3b6b5319d60e64 (A2 pin)'; }), ['repin-t01-fingerprint-in-plan']);
  assert.deepEqual(m((s) => { s.record.stages['11'].data.t01_fingerprint = null; }), ['repin-t01-fingerprint-in-plan']);
  assert.deepEqual(m((s) => { s.plan.phases.C_rebaseline.preregistration.quant = 'Q8_0'; }), ['repin-quant-consistent']);
  assert.deepEqual(m((s) => { s.record.stages['12'].data.quant = 'Q8_0'; }), ['repin-quant-consistent']);
  assert.deepEqual(m((s) => { delete s.plan.phases.H_hardware.quant_decision; }), ['repin-quant-consistent']);
});
test('cpreflight: the committed repository (re-pinned, pre-registered) blocks statically only on the missing record argument', () => {
  const yaml = createRequire(path.join(EVALS, '..', 'package.json'))('js-yaml');
  const plan = yaml.load(fs.readFileSync(path.join(EVALS, 'PLAN.yaml'), 'utf8'));
  const env = JSON.parse(fs.readFileSync(path.join(EVALS, 'baseline-env.json'), 'utf8'));
  const b = blocked({ plan, env, record: null, gitClean: true, branch: plan.branch });
  // the A3 re-pin of 2026-10-04 is visible: the pins are no longer A2, the model pin fits the CPU target, H is decided
  // record: null here (no --repin given) -> exactly that blocks; the pre-registration is approved (2026-10-04)
  assert.deepEqual(b, ['repin-record']);
  assert.ok(!b.includes('pin-not-a2'), 'the re-pin happened: baseline-env.json must not still pin A2');
  assert.ok(!b.includes('plan-a3-authoritative'), 'A3 is pinned now: the PLAN status must not block');
  assert.ok(!b.includes('plan-h-decided'), 'the hardware decision is made: the CPU target must not block');
  assert.ok(!b.includes('pin-model-fits-target'), 'the CPU target keeps the validated CPU model: the model pin must not block');
  assert.ok(!b.includes('plan-c-not-started'));
});
test('cpreflight runs the offline suite with a glob (node 26 treats a directory argument as one module)', () => {
  const src = fs.readFileSync(path.join(EVALS, 'bench', 'cpreflight.mjs'), 'utf8');
  assert.match(src, /\['--test', 'evals\/test\/\*\.test\.mjs'\]/);
});
test('target.mjs: the target comes from PLAN, placement is judged against it, CPU keeps the validated model', () => {
  assert.equal(targetOf({ phases: { H_hardware: { target_environment: { placement: 'cpu' } } } }), 'CPU');
  assert.equal(targetOf({ phases: { H_hardware: {} } }), null);
  assert.equal(targetOf({ phases: { H_hardware: { target_environment: { placement: 'TPU' } } } }), null);
  const m = (size, vr) => ({ size, size_vram: vr });
  assert.equal(placementOk('CPU', m(20e9, 0)), true);
  assert.equal(placementOk('CPU', m(20e9, 12e9)), false);
  assert.equal(placementOk('GPU', m(20e9, 20e9)), true);
  assert.equal(placementOk('GPU', m(20e9, 12e9)), false);
  assert.equal(placementOk('CPU', m(20e9, undefined)), false);
  assert.equal(placementOk('CPU', null), false);
  assert.equal(placementOk(null, m(20e9, 0)), false, 'no target never passes');
  assert.equal(requiredModelDigest('CPU'), CPU_MODEL_DIGEST); assert.equal(requiredModelDigest('GPU'), null);
});
test('hardwareCheck: CPU target needs the baseline CPU/RAM; GPU target needs a discrete GPU', () => {
  const base = { cpu: [{ name: 'AMD Ryzen AI 7 PRO 350' }], ram: { total_gib: 31.2 } };
  assert.equal(hardwareCheck('CPU', { cpu: [{ name: 'AMD Ryzen AI 7 PRO 350' }], ram: { total_gib: 31.2 } }, base).ok, true);
  assert.equal(hardwareCheck('CPU', { cpu: [{ name: 'AMD Ryzen AI 7 PRO 350' }], ram: { total_gib: 15.5 } }, base).ok, false);
  assert.equal(hardwareCheck('CPU', { cpu: [{ name: 'Intel i9' }], ram: { total_gib: 31.2 } }, base).ok, false);
  assert.equal(hardwareCheck('CPU', null, base).ok, false);
  assert.equal(hardwareCheck('GPU', { nvidia: { gpus: [{ name: 'RTX 4090', memory_total_mib: 24564, driver: 'x' }] } }, base).ok, true);
  assert.equal(hardwareCheck('GPU', { nvidia: { gpus: [] } }, base).ok, false);
  assert.equal(hardwareCheck('GPU', { rocm: { rocm_smi: true } }, base).ok, true);
  assert.equal(hardwareCheck('TPU', {}, base).ok, false);
});
test('modelfileDiff: a different FROM blob only with a declared quant switch, parameters still identical', () => {
  const cpu = 'FROM C:\b\sha256-1194192c\nPARAMETER num_ctx 32768\nPARAMETER num_gpu 0\nPARAMETER temperature 0.15\n';
  const q8 = 'FROM C:\b\sha256-q8blob\nPARAMETER num_ctx 32768\nPARAMETER temperature 0.15\n';
  assert.equal(modelfileDiff(cpu, q8).ok, false);
  assert.equal(modelfileDiff(cpu, q8, { allowFrom: true }).ok, true);
  assert.equal(modelfileDiff(cpu, q8.replace('0.15', '0.3'), { allowFrom: true }).ok, false);
  assert.equal(modelfileDiff(cpu, q8.replace(/^FROM .*\n/, ''), { allowFrom: true }).ok, false);
});
