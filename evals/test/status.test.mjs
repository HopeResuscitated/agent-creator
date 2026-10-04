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
});
test('the real repository passes every offline check', async () => {
  const s = await collect({ offline: true });
  assert.deepEqual(failing(s, docs()), []);
});
test('mutations are caught', async () => {
  const base = await collect({ offline: true }); const d = docs();
  const m = (f) => { const s = clone(base); f(s); return failing(s, d); };
  assert.ok(m((s) => { s.phases.C_rebaseline = 'IN PROGRESS'; }).includes('c-not-started'));
  assert.ok(m((s) => { s.pins.jcode_sha256 = '42ed4012e129cc36e9d3f3c299b3015fbde5c8cb95cab36ed41f0d526fd0bab7'; }).includes('a3-not-pinned'));
  assert.ok(m((s) => { s.pins.jcode_sha256 = '42ed4012e129cc36e9d3f3c299b3015fbde5c8cb95cab36ed41f0d526fd0bab7'; }).includes('a2-pin-is-authoritative'));
  assert.ok(m((s) => { s.phase_detail.A3_edit_string_args = 'AUTHORITATIVE (pinned)'; }).includes('a3-candidate-not-authoritative'));
  assert.ok(m((s) => { s.d_gate_proposal = 'ADOPTED: C passes, then one 18-task run'; }).includes('d-proposed-not-adopted'));
  assert.ok(m((s) => { s.d_gate_proposal = 'C passes, then one 18-task run'; }).includes('d-proposed-not-adopted'));
  assert.ok(m((s) => { s.pins.ollama_version = '0.35.1'; }).includes('ollama-pin-0.34.4'));
  assert.ok(m((s) => { s.human_decisions = []; }).includes('human-decisions-listed'));
  assert.ok(m((s) => { s.live = { jcode_a2: { sha256: 'x' }, ollama_version: '0.35.1', model_digests: {} }; }).includes('live-ollama-matches-pin'));
  assert.ok(failing(base, { ...d, handoff: d.handoff.replace(/ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE/g, 'ADOPTED') }).includes('a3-wording-handoff'));
  assert.ok(failing(base, { ...d, repin: d.repin.split(base.pins.jcode_sha256).join('') }).includes('a2-sha-in-docs'));
});
