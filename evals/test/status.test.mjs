// Tests for evals/bench/status.mjs: the consistency checks must fail when an invariant is broken (mutation tests on
// an in-memory copy of the real status + docs; nothing on disk is changed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { collect, checks, statusWord } from '../bench/status.mjs';

const EVALS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = () => ({ plan: fs.readFileSync(path.join(EVALS, 'PLAN.yaml'), 'utf8'), handoff: fs.readFileSync(path.join(EVALS, 'HANDOFF.md'), 'utf8'), repin: fs.readFileSync(path.join(EVALS, 'REPIN.md'), 'utf8') });
const failing = (s, d) => checks(s, d).filter((r) => !r.ok).map((r) => r.name);
const clone = (x) => JSON.parse(JSON.stringify(x));

test('statusWord', () => {
  assert.equal(statusWord('NOT STARTED - BLOCKED on H (A2 ...)'), 'NOT STARTED');
  assert.equal(statusWord('COMPLETE (14f50f2)'), 'COMPLETE');
  assert.equal(statusWord('ADOPTED AS CANDIDATE (user, 2026-10-03), NOT YET AUTHORITATIVE - x'), 'ADOPTED AS CANDIDATE');
  assert.equal(statusWord('AUTHORITATIVE - PINNED 2026-10-04 (REPIN.md 1-12 PASS)'), 'AUTHORITATIVE');
});
test('the real repository passes every offline check', async () => {
  const s = await collect({ offline: true });
  assert.deepEqual(failing(s, docs()), []);
});
test('mutations are caught', async () => {
  const base = await collect({ offline: true }); const d = docs();
  const m = (f) => { const s = clone(base); f(s); return failing(s, d); };
  assert.ok(m((s) => { s.phases.C_rebaseline = 'IN PROGRESS'; }).includes('c-complete-recorded'));
  assert.ok(m((s) => { s.phase_detail.C_rebaseline = 'COMPLETE - no verdict'; }).includes('c-complete-recorded'));
  // the pin must be A3: rolling it back to A2 (the superseded pin) fails
  const A2 = 'f76eff118ae42e9876727095c100420f485e7ea7a8904d3dd62e93f55beaf8e3';
  assert.ok(m((s) => { s.pins.jcode_sha256 = A2; }).includes('pin-is-a3'));
  assert.ok(m((s) => { s.phase_detail.A3_edit_string_args = 'ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE - not pinned'; }).includes('a3-authoritative'));
  assert.ok(failing(base, { ...d, plan: d.plan.split(A2).join('') }).includes('superseded-a2-still-recorded'));
  assert.ok(m((s) => { s.d_gate_proposal = 'ADOPTED: C passes, then one 18-task run'; }).includes('d-proposed-not-adopted'));
  assert.ok(m((s) => { s.d_gate_proposal = 'C passes, then one 18-task run'; }).includes('d-proposed-not-adopted'));
  assert.ok(m((s) => { s.pins.ollama_version = '0.35.1'; }).includes('ollama-pin-0.34.4'));
  assert.ok(m((s) => { s.human_decisions = []; }).includes('human-decisions-listed'));
  const l = m((s) => { s.live = { jcode_a2: { sha256: A2 }, jcode_a3_candidate: { sha256: 'x' }, ollama_version: '0.35.1', model_digests: {} }; });
  assert.ok(l.includes('live-ollama-matches-pin')); assert.ok(l.includes('live-pin-is-a3-binary'));
  assert.ok(failing(base, { ...d, handoff: d.handoff.replace(/A3: PINNED/g, 'A3: whatever') }).includes('a3-wording-handoff'));
  assert.ok(failing(base, { ...d, repin: d.repin.split(base.pins.jcode_sha256).join('') }).includes('pin-sha-in-docs'));
});
