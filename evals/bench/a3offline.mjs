// a3offline.mjs - offline behaviour comparison of two REAL jcode builds against the same scripted fake provider.
//
//   "$NODE_BIN" evals/bench/a3offline.mjs --a <A2 jcode.exe> --b <A3 jcode.exe> [--out <dir>] [--only S1,T3,...]
//
// A3 (710560f91) = A2 (7ed7403f8) + one change in crates/jcode-app-core/src/tool/edit.rs (the `edits` argument may
// be a JSON string). So, outside the edit-string scenarios, both builds must behave IDENTICALLY: same exit code,
// same number of model requests, same message-role sequence in every request, same tool results (normalized),
// same files. Edit-string scenarios E2/E3 are EXPECTED to differ (applied by A3, rejected by A2).
// Each build must also satisfy the invariants below on its own. This does NOT promote A3; it de-risks the re-pin.
//
// Invariants (both builds):
//   S5a  a tool call streamed before EOF runs exactly once (no duplicate execution on the retried response)
//   S6   discarded partial text never reaches a later request
//   T3/T5/E4  an invalid call is an error result for the model; the file is untouched
//   T4   a call to a tool that does not exist: OBSERVED on both builds: jcode ends the run ("Error: Tool 'x' is not
//        allowed", exit 1) after 1 request instead of returning an error result; the file is untouched
//   T1   two tool calls in one response run in order, each result carries its own call id
//   T6   arguments split across deltas are assembled once (file written once, correct content)
// Output: one line per scenario per build, then COMPARE lines and A3OFFLINE PASS|FAIL. Exit 0/1, 3 usage.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { R, runScenario, jcodeHomeFingerprint } from './fakeprov.mjs';

const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const A = flag('a'), B = flag('b'), RECOMPARE = flag('recompare');
if (!RECOMPARE && (!A || !B || !fs.existsSync(A) || !fs.existsSync(B))) { console.error('usage: a3offline.mjs --a <A2 jcode.exe> --b <A3 jcode.exe> [--out <dir>] [--only ids] | --recompare <a3offline.json>'); process.exit(3); }
const OUT = RECOMPARE ? path.dirname(path.resolve(RECOMPARE)) : flag('out') ? path.resolve(flag('out')) : fs.mkdtempSync(path.join(os.tmpdir(), 'a3offline-'));
fs.mkdirSync(OUT, { recursive: true });
const SEED = 'alpha\nbeta\n';
const APPLIED = SEED.replace('alpha\n', 'ALPHA\n\tx\n');
const editArr = [{ old_string: 'alpha\n', new_string: 'ALPHA\n\tx\n' }];

export const SCENARIOS = [
  { id: 'S1_complete', desc: 'normal 200 with finish_reason', script: [R.complete('All done.')] },
  { id: 'S2_text_eof_always', desc: '200 text then EOF, no finish_reason, every time', script: [R.textEof('partial A'), R.textEof('partial B'), R.textEof('partial C'), R.textEof('partial D'), R.textEof('partial E')] },
  { id: 'S3_ollama_rejected_then_ok', desc: 'Ollama rejected-tool-call tail, then a good response', script: [R.ollamaRejected("I'll update the parser now."), R.complete('Fixed it.')] },
  { id: 'S4a_500_then_ok', desc: 'HTTP 500 (Ollama parse error body), then a good response', script: [R.http500(), R.complete('Recovered after 500.')] },
  { id: 'S4b_500_always', desc: 'HTTP 500 every time', script: [R.http500()] },
  { id: 'S5a_tool_then_eof', desc: 'tool call streamed, then EOF without finish_reason', script: [R.toolEof('out.txt', 'from-S5a'), R.complete('Wrote the file.')] },
  { id: 'S5b_tool_then_text_eof', desc: 'earlier turn ran a tool; next response is text+EOF', script: [R.toolDone('out.txt', 'from-S5b'), R.ollamaRejected('Now checking the file.'), R.complete('Checked.')] },
  { id: 'S6_partial_not_in_history', desc: 'text+EOF (PARTIAL-XYZ), retry gives a tool call, then completion', script: [R.ollamaRejected('PARTIAL-XYZ thinking'), R.toolDone('out.txt', 'from-S6'), R.complete('Finished.')] },
  { id: 'T1_two_tools_ordered', desc: 'two write calls in one response (a.txt then b.txt)', script: [R.tools([{ id: 'call_a', name: 'write', args: { file_path: 'a.txt', content: 'A', intent: 'a' } }, { id: 'call_b', name: 'write', args: { file_path: 'b.txt', content: 'B', intent: 'b' } }]), R.complete('Both written.')] },
  { id: 'T2_duplicate_call_ids', desc: 'two write calls sharing one id (records behaviour; must match across builds)', script: [R.tools([{ id: 'call_d', name: 'write', args: { file_path: 'out.txt', content: 'first', intent: 'w' } }, { id: 'call_d', name: 'write', args: { file_path: 'out.txt', content: 'second', intent: 'w' } }]), R.complete('Done.')] },
  { id: 'T3_malformed_args', desc: 'write call whose arguments are truncated JSON', script: [R.tools([{ id: 'call_m', name: 'write', args: '{"file_path": "out.txt", "content": ' }]), R.complete('Done.')] },
  { id: 'T4_unknown_tool', desc: 'call to a tool that does not exist', script: [R.tools([{ id: 'call_u', name: 'no_such_tool', args: { x: 1 } }]), R.complete('Done.')] },
  { id: 'T5_edit_not_found', desc: 'edit (native array) whose old_string is absent', script: [R.edit([{ old_string: 'zzz-not-there', new_string: 'q' }]), R.complete('Done.')] },
  { id: 'T6_args_split_deltas', desc: 'write arguments streamed in 5 deltas', script: [R.toolSplit('call_s', 'write', { file_path: 'out.txt', content: 'split-ok\n', intent: 'w' }, 5), R.complete('Done.')] },
  { id: 'E1_native_array', desc: 'edits as a JSON array', script: [R.edit(editArr), R.complete('Done.')] },
  { id: 'E2_string_strict', desc: 'edits as a strict-JSON string', script: [R.edit(JSON.stringify(editArr)), R.complete('Done.')], differs: true },
  { id: 'E3_string_raw_newlines', desc: 'edits as a string with raw newline/tab inside its strings', script: [R.edit('[{"new_string":"ALPHA\n\tx\n","old_string":"alpha\n"}]'), R.complete('Done.')], differs: true },
  { id: 'E4_string_garbage', desc: 'edits as an unparseable string', script: [R.edit('[{"old_string": alpha'), R.complete('Done.')] },
];

/** Behaviour signature used for the A2/A3 comparison: no timings, paths or temp names. */
export function signature(r) {
  const norm = (s) => String(s ?? '').replace(/\[tool timing:[^\]]*\]\s*/g, '').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z?/g, '<ts>').replace(/[A-Za-z]:[\\/][^\s"']*/g, '<path>').replace(/\b\d+(\.\d+)?\s*(ms|s)\b/g, '<t>').slice(0, 160);
  return JSON.stringify({ exit: r.exit, killed: r.killed, requests: r.requests,
    roles: r.reqs.map((q) => q.roles), calls: r.reqs.map((q) => q.assistantToolCalls.join('|')),
    results: r.reqs.map((q) => q.toolResults.map((t) => `${t.id}:${t.content.startsWith('[Error]') ? 'ERR' : 'OK'}:${norm(t.content)}`).join('|')),
    partial: r.reqs.map((q) => q.hasPartial), files: r.files });
}
const lastResults = (r) => (r.reqs.length ? r.reqs[r.reqs.length - 1].toolResults : []);
const isErr = (t) => /^\[Error\]|error/i.test(t.content);
export const INVARIANTS = {
  S5a_tool_then_eof: (r) => r.files['out.txt'] === 'from-S5a' && r.reqs.flatMap((q) => q.toolResults.map((t) => t.id)).filter((x) => x === 'call_w1').length <= r.requests - 1 && new Set(lastResults(r).map((t) => t.id)).size === lastResults(r).length || 'tool result duplicated or file not written',
  S6_partial_not_in_history: (r) => r.reqs.slice(1).every((q) => !q.hasPartial) || 'discarded partial text reached a later request',
  T1_two_tools_ordered: (r) => (r.files['a.txt'] === 'A' && r.files['b.txt'] === 'B' && lastResults(r).map((t) => t.id).join(',') === 'call_a,call_b') || `order/ids: ${lastResults(r).map((t) => t.id).join(',')}`,
  T3_malformed_args: (r) => (r.files['out.txt'] === SEED && lastResults(r).some(isErr)) || 'malformed arguments not reported as an error, or file changed',
  T4_unknown_tool: (r) => (r.files['out.txt'] === SEED && (lastResults(r).some(isErr) || r.exit !== 0)) || 'unknown tool neither an error result nor a failed run, or file changed',
  T5_edit_not_found: (r) => (r.files['out.txt'] === SEED && lastResults(r).some(isErr)) || 'failed edit not an error, or file changed',
  T6_args_split_deltas: (r) => r.files['out.txt'] === 'split-ok\n' || `file=${JSON.stringify(r.files['out.txt'])}`,
  E1_native_array: (r) => r.files['out.txt'] === APPLIED || 'native-array edit not applied',
  E4_string_garbage: (r) => (r.files['out.txt'] === SEED && lastResults(r).some(isErr)) || 'garbage edits string not rejected',
};
const EXPECT_E = { a: { E2_string_strict: SEED, E3_string_raw_newlines: SEED }, b: { E2_string_strict: APPLIED, E3_string_raw_newlines: APPLIED } };

const only = flag('only') ? flag('only').split(',') : null;
const evBefore = RECOMPARE ? null : jcodeHomeFingerprint();
let fails = 0; const all = RECOMPARE ? JSON.parse(fs.readFileSync(RECOMPARE, 'utf8')) : { a: {}, b: {} };
for (const sc of SCENARIOS) {
  if (only && !only.includes(sc.id)) continue;
  for (const [k, bin] of [['a', A], ['b', B]]) {
    if (RECOMPARE && !all[k][sc.id]) continue;
    const r = RECOMPARE ? all[k][sc.id] : await runScenario(bin, sc, OUT, k === 'a' ? 'A2' : 'A3'); all[k][sc.id] = r;
    const inv = INVARIANTS[sc.id]?.(r) ?? true; const exp = EXPECT_E[k][sc.id];
    const ok = inv === true && (exp === undefined || r.files['out.txt'] === exp) && !r.killed;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${k === 'a' ? 'A2' : 'A3'} ${sc.id.padEnd(28)} exit=${r.exit} requests=${r.requests} ${r.seconds}s${inv === true ? '' : ` | ${inv}`}${exp !== undefined && r.files['out.txt'] !== exp ? ` | out.txt=${JSON.stringify(r.files['out.txt'])}` : ''}${r.killed ? ' | KILLED at timeout' : ''}`);
  }
  if (!all.a[sc.id] || !all.b[sc.id]) continue;
  const same = signature(all.a[sc.id]) === signature(all.b[sc.id]);
  const ok = sc.differs ? !same : same; if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} COMPARE ${sc.id.padEnd(28)} ${same ? 'identical' : 'differs'}${sc.differs ? ' (expected to differ)' : ''}`);
}
if (!RECOMPARE) {
  const evAfter = jcodeHomeFingerprint(); const same = !!evBefore && evBefore === evAfter; if (!same) fails++;
  console.log(`${same ? 'ok  ' : 'FAIL'} ~/.jcode unchanged: ${evAfter}${same ? '' : ` (before: ${evBefore})`}`);
}
if (!RECOMPARE) fs.writeFileSync(path.join(OUT, 'a3offline.json'), JSON.stringify(all, null, 1));
console.log(`A3OFFLINE ${fails ? `FAIL (${fails})` : 'PASS'} out=${OUT}`);
process.exit(fails ? 1 : 0);
