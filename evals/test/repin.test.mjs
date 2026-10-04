// Tests for the pure logic of evals/bench/repin.mjs and evals/bench/cpreflight.mjs (no live system touched).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gate, editPins, modelfileDiff, STAGES } from '../bench/repin.mjs';
import { staticChecks, PREREG_KEYS, REPIN_STAGES, A2_SHA, CPU_MODEL_DIGEST } from '../bench/cpreflight.mjs';

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

const ready = () => ({
  plan: { branch: 'b', phases: { H_hardware: { status: 'DECIDED - x' }, A3_edit_string_args: { status: 'AUTHORITATIVE (pinned)' }, C_rebaseline: { status: 'NOT STARTED - ready', preregistration: Object.fromEntries(PREREG_KEYS.map((k) => [k, 'x'])) } } },
  env: { jcode_sha256: 'a'.repeat(64), model_server: { ollama_version: '0.34.4', models: { 'hermes-local-32k': 'b'.repeat(64) } } },
  record: { stages: Object.fromEntries(REPIN_STAGES.map((s) => [s, { status: 'PASS' }])), pins: { jcode_sha256: 'a'.repeat(64), models: { 'hermes-local-32k': 'b'.repeat(64) }, ollama_version: '0.34.4' } },
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
  assert.ok(m((s) => { s.env.model_server.models['hermes-local-32k'] = CPU_MODEL_DIGEST; s.record.pins.models['hermes-local-32k'] = CPU_MODEL_DIGEST; }).includes('pin-not-cpu-model'));
  assert.deepEqual(m((s) => { s.plan.phases.H_hardware.status = 'BLOCKED - open decision'; }), ['plan-h-decided']);
  assert.deepEqual(m((s) => { s.plan.phases.A3_edit_string_args.status = 'ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE'; }), ['plan-a3-authoritative']);
  assert.deepEqual(m((s) => { s.plan.phases.C_rebaseline.status = 'IN PROGRESS'; }), ['plan-c-not-started']);
  assert.deepEqual(m((s) => { delete s.plan.phases.C_rebaseline.preregistration.timeouts; }), ['plan-c-preregistered']);
  assert.deepEqual(m((s) => { s.gitClean = false; }), ['git-clean']);
});
test('cpreflight: the current repository is BLOCKED (A2 pinned, H open, A3 candidate, C not pre-registered)', () => {
  const yaml = createRequire(path.join(EVALS, '..', 'package.json'))('js-yaml');
  const plan = yaml.load(fs.readFileSync(path.join(EVALS, 'PLAN.yaml'), 'utf8'));
  const env = JSON.parse(fs.readFileSync(path.join(EVALS, 'baseline-env.json'), 'utf8'));
  const b = blocked({ plan, env, record: null, gitClean: true, branch: plan.branch });
  for (const n of ['repin-record', 'pin-not-a2', 'pin-not-cpu-model', 'plan-h-decided', 'plan-a3-authoritative', 'plan-c-preregistered']) assert.ok(b.includes(n), n);
  assert.ok(!b.includes('plan-c-not-started'));
});
