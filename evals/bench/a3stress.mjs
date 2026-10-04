// a3stress.mjs - offline stress of the ONE behaviour where A3 differs from A2 (the `edits` argument of the edit tool may
// be a JSON string on A3), plus the edit paths around it. REAL A2 and A3 binaries, scripted fake provider
// (fakeprov.mjs), fresh JCODE_HOME per scenario, ~/.jcode guarded. Candidate evidence only: it does not pin A3.
//
//   "$NODE_BIN" evals/bench/a3stress.mjs --a <A2 jcode.exe> --b <A3 jcode.exe> [--out <dir>] [--only X1,X2]
//
// Each scenario states the expected final files for A2 and for A3, and whether the two builds must behave identically
// (same exit, request count, roles, tool calls, normalized tool results, files). Invariants checked on every run:
//   no tool call id gets more than one result in any request (no duplicate execution / duplicate result);
//   PARTIAL-XYZ (discarded partial text) never reaches a later request;
//   the out-of-sandbox canary is never changed by a string-form edit unless the array form changes it too on the
//   same build (the string form must not be more permissive than the native form);
//   every run ends by itself (not killed by the 240 s guard).
// Output: one line per scenario per build, COMPARE lines, A3STRESS PASS|FAIL. Exit 0/1, 3 usage.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { R, chunk, runScenario, jcodeHomeFingerprint } from './fakeprov.mjs';

const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const A = flag('a'), B = flag('b');
if (!A || !B || !fs.existsSync(A) || !fs.existsSync(B)) { console.error('usage: a3stress.mjs --a <A2 jcode.exe> --b <A3 jcode.exe> [--out <dir>] [--only ids]'); process.exit(3); }
const OUT = flag('out') ? path.resolve(flag('out')) : fs.mkdtempSync(path.join(os.tmpdir(), 'a3stress-'));
fs.mkdirSync(OUT, { recursive: true });

const SEED = 'alpha\nbeta\n';
const E_A = { old_string: 'alpha\n', new_string: 'ALPHA\n' };
const E_B = { old_string: 'beta\n', new_string: 'BETA\n' };
const ONE = 'ALPHA\nbeta\n', BOTH = 'ALPHA\nBETA\n';
const DONE = R.complete('Done.');
const call = (id, name, args) => ({ id, name, args });
const editCall = (id, edits, file = 'out.txt') => call(id, 'edit', { file_path: file, intent: 'edit', edits });
// an edit call streamed, then EOF with no finish_reason (the response is retried by A2's stream fix)
const editEof = (id, edits) => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: 'edit', arguments: JSON.stringify({ file_path: 'out.txt', intent: 'edit', edits }) } }] }) });
const CANARY = (k) => path.join(OUT, `canary-${k}.txt`);

// expect: { a: files-or-fn, b: ..., same: bool }; files compare out.txt (and b.txt where given)
export const SCENARIOS = [
  { id: 'X1_garbage_string_twice', desc: 'unparseable edits string, twice, then stop', script: [R.tools([editCall('c1', '[{"old_string": alpha')]), R.tools([editCall('c2', '{not json')]), DONE], a: { 'out.txt': SEED }, b: { 'out.txt': SEED }, same: true },
  { id: 'X2_array_two_edits', desc: 'valid structured (array) edit with two edits', script: [R.tools([editCall('c1', [E_A, E_B])]), DONE], a: { 'out.txt': BOTH }, b: { 'out.txt': BOTH }, same: true },
  { id: 'X3_string_two_edits', desc: 'string-form edit with two edits', script: [R.tools([editCall('c1', JSON.stringify([E_A, E_B]))]), DONE], a: { 'out.txt': SEED }, b: { 'out.txt': BOTH }, same: false },
  { id: 'X4_mixed_forms_two_turns', desc: 'array edit (alpha), next turn string edit (beta)', script: [R.tools([editCall('c1', [E_A])]), R.tools([editCall('c2', JSON.stringify([E_B]))]), DONE], a: { 'out.txt': ONE }, b: { 'out.txt': BOTH }, same: false },
  { id: 'X5_edit_then_tool_same_response', desc: 'string edit then a write, in one response', script: [R.tools([editCall('c1', JSON.stringify([E_A])), call('w1', 'write', { file_path: 'b.txt', content: 'B', intent: 'w' })]), DONE], a: { 'out.txt': SEED, 'b.txt': 'B' }, b: { 'out.txt': ONE, 'b.txt': 'B' }, same: false },
  { id: 'X6_tool_then_edit_same_response', desc: 'write then array edit, in one response', script: [R.tools([call('w1', 'write', { file_path: 'b.txt', content: 'B', intent: 'w' }), editCall('c1', [E_A])]), DONE], a: { 'out.txt': ONE, 'b.txt': 'B' }, b: { 'out.txt': ONE, 'b.txt': 'B' }, same: true },
  { id: 'X7_rejected_then_array_retry', desc: 'garbage string edit rejected, model retries with an array', script: [R.tools([editCall('c1', '[{"old_string": alpha')]), R.tools([editCall('c2', [E_A])]), DONE], a: { 'out.txt': ONE }, b: { 'out.txt': ONE }, same: true },
  { id: 'X8_string_then_same_as_array', desc: 'string edit, then the same edit as an array (A2: first rejected; A3: second finds nothing)', script: [R.tools([editCall('c1', JSON.stringify([E_A]))]), R.tools([editCall('c2', [E_A])]), DONE], a: { 'out.txt': ONE }, b: { 'out.txt': ONE }, same: false },
  { id: 'X9_string_edit_then_eof', desc: 'string edit streamed, then EOF without finish_reason, then completion', script: [editEof('c1', JSON.stringify([E_A])), DONE], a: { 'out.txt': SEED }, b: { 'out.txt': ONE }, same: false },
  { id: 'X10_array_edit_then_eof', desc: 'array edit streamed, then EOF without finish_reason, then completion', script: [editEof('c1', [E_A]), DONE], a: { 'out.txt': ONE }, b: { 'out.txt': ONE }, same: true },
  { id: 'X11_duplicate_edit_ids', desc: 'two array edit calls sharing one id in one response', script: [R.tools([editCall('dup', [E_A]), editCall('dup', [E_B])]), DONE], a: null, b: null, same: true },
  { id: 'X12_500_then_string_edit', desc: 'HTTP 500, then a string edit, then completion', script: [R.http500(), R.tools([editCall('c1', JSON.stringify([E_A]))]), DONE], a: { 'out.txt': SEED }, b: { 'out.txt': ONE }, same: false },
  { id: 'X13_partial_then_string_edit', desc: 'text+EOF (PARTIAL-XYZ), retry gives a string edit, then completion', script: [R.ollamaRejected('PARTIAL-XYZ thinking'), R.tools([editCall('c1', JSON.stringify([E_A]))]), DONE], a: { 'out.txt': SEED }, b: { 'out.txt': ONE }, same: false },
  { id: 'X14_outside_array', desc: 'array edit on an absolute path outside the sandbox (canary)', outside: true, script: (k) => [R.tools([editCall('c1', [{ old_string: 'canary\n', new_string: 'CHANGED\n' }], CANARY(k))]), DONE], a: null, b: null, same: true },
  { id: 'X15_outside_string', desc: 'string edit on the same outside path (must not be more permissive than X14)', outside: true, script: (k) => [R.tools([editCall('c1', JSON.stringify([{ old_string: 'canary\n', new_string: 'CHANGED\n' }]), CANARY(k))]), DONE], a: null, b: null, same: false },
  { id: 'X16_string_wrong_shape', desc: 'string that parses to an object, not an array', script: [R.tools([editCall('c1', JSON.stringify(E_A))]), DONE], a: { 'out.txt': SEED }, b: null, same: null },
];

const norm = (s) => String(s ?? '').replace(/\[tool timing:[^\]]*\]\s*/g, '').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z?/g, '<ts>').replace(/[A-Za-z]:[\\/][^\s"']*/g, '<path>').replace(/\b\d+(\.\d+)?\s*(ms|s)\b/g, '<t>').slice(0, 160);
export function signature(r) {
  return JSON.stringify({ exit: r.exit, requests: r.requests, roles: r.reqs.map((q) => q.roles), calls: r.reqs.map((q) => q.assistantToolCalls.join('|')),
    results: r.reqs.map((q) => q.toolResults.map((t) => `${t.id}:${/^\[Error\]|error/i.test(t.content) ? 'ERR' : 'OK'}:${norm(t.content)}`).join('|')), files: r.files });
}
export function invariants(r) {
  const bad = [];
  for (const [n, q] of r.reqs.entries()) {
    const ids = q.toolResults.map((t) => t.id); const dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
    // duplicate ids are only acceptable when the model itself sent duplicate ids (X11), never otherwise
    if (dupIds.length && !dupIds.every((x) => x === 'dup')) bad.push(`request ${n + 1}: tool id(s) answered twice: ${dupIds.join(',')}`);
  }
  if (r.reqs.slice(1).some((q) => q.hasPartial)) bad.push('discarded partial text reached a later request');
  if (r.killed) bad.push('run killed by the 240 s guard');
  if ((r.files['out.txt'] ?? '').split('ALPHA').length > 2) bad.push('edit applied more than once');
  return bad;
}

const only = flag('only') ? flag('only').split(',') : null;
const evBefore = jcodeHomeFingerprint();
let fails = 0; const all = { a: {}, b: {} }; const canary = {};
for (const sc of SCENARIOS) {
  if (only && !only.includes(sc.id)) continue;
  for (const [k, bin] of [['a', A], ['b', B]]) {
    const key = `${k}-${sc.id}`;
    if (sc.outside) fs.writeFileSync(CANARY(key), 'canary\n');
    const r = await runScenario(bin, { ...sc, script: typeof sc.script === 'function' ? sc.script(key) : sc.script }, OUT, k === 'a' ? 'A2' : 'A3');
    if (sc.outside) { canary[key] = fs.readFileSync(CANARY(key), 'utf8'); r.canary = canary[key]; }
    all[k][sc.id] = r;
    const bad = invariants(r);
    const want = sc[k];
    if (want) for (const [f, c] of Object.entries(want)) if (r.files[f] !== c) bad.push(`${f}=${JSON.stringify(r.files[f])} expected ${JSON.stringify(c)}`);
    if (bad.length) fails++;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${k === 'a' ? 'A2' : 'A3'} ${sc.id.padEnd(34)} exit=${r.exit} requests=${r.requests} out=${JSON.stringify(r.files['out.txt'])}${sc.outside ? ` canary=${JSON.stringify(r.canary)}` : ''}${bad.length ? ` | ${bad.join('; ')}` : ''}`);
  }
  const same = signature(all.a[sc.id]) === signature(all.b[sc.id]);
  if (sc.same !== null) { const ok = sc.same ? same : true; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} COMPARE ${sc.id.padEnd(34)} ${same ? 'identical' : 'differs'}${sc.same ? '' : ' (may differ: edit-string form)'}`); }
  else console.log(`info COMPARE ${sc.id.padEnd(34)} ${same ? 'identical' : 'differs'} (recorded)`);
}
// the string form must not reach where the native form cannot, on either build
for (const k of ['a', 'b']) {
  const arr = canary[`${k}-X14_outside_array`], str = canary[`${k}-X15_outside_string`];
  if (arr === undefined || str === undefined) continue;
  const ok = !(str !== 'canary\n' && arr === 'canary\n'); if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${k === 'a' ? 'A2' : 'A3'} outside-path: array form ${arr === 'canary\n' ? 'did not change' : 'CHANGED'} the canary, string form ${str === 'canary\n' ? 'did not change' : 'CHANGED'} it`);
}
const evAfter = jcodeHomeFingerprint(); const same = !!evBefore && evBefore === evAfter; if (!same) fails++;
console.log(`${same ? 'ok  ' : 'FAIL'} ~/.jcode unchanged: ${evAfter}${same ? '' : ` (before: ${evBefore})`}`);
fs.writeFileSync(path.join(OUT, 'a3stress.json'), JSON.stringify(all, null, 1));
console.log(`A3STRESS ${fails ? `FAIL (${fails})` : 'PASS'} out=${OUT}`);
process.exit(fails ? 1 : 0);
