// Fuzz / adversarial tests for evals/bench/tripclass.mjs (synthetic watch.log lines; offline, deterministic).
// Goal: legitimate harness activity is attributed, and no line that shows real containment breakage can be
// attributed away, whatever extra fields, duplicates, ordering, encoding or truncation it comes with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrip, classifyTrip, classifyLog, isLoopback, hostOf } from '../bench/tripclass.mjs';

const T0 = '2026-10-05T10:00:00';
const WARM = [Date.parse('2026-10-05T09:59:59'), Date.parse('2026-10-05T10:00:30')];
const ctxC = { mode: 'contain', warmup: WARM }, ctxD = { mode: 'control', warmup: WARM };
const C = (line, ctx) => classifyTrip(parseTrip(line), ctx);
const CURL = 'cmd=C:\\git\\mingw64\\bin\\curl.exe -s -m 600 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"hermes-local-32k\\",\\"prompt\\":\\"ok\\",\\"stream\\":false,\\"options\\":{\\"num_predict\\":1}}"';
const EVAL_JCODE = 'name=jcode.exe cmd="C:\\a2\\jcode.exe" -p openai-compatible --provider-profile evalbroker -m hermes-local-32k run --no-update "task"';
const egress = (remote, root = 'eval', time = T0) => `${time} TRIP agent-nonloopback-connection pid=7 remote=${remote} name=node.exe root=${root}`;

test('loopback forms: 127/8, ::1, IPv4-mapped; everything else is not loopback', () => {
  for (const a of ['127.0.0.1', '127.0.0.2', '127.1.2.3', '127.255.255.254', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.2', '[::1]', '0:0:0:0:0:0:0:1']) assert.ok(isLoopback(a), a);
  for (const a of ['10.0.0.1', '192.168.1.20', '128.0.0.1', '126.255.255.255', '::ffff:10.0.0.1', '::ffff:192.168.0.1', '2606:4700::6810:622', '::', '0.0.0.0', '127.256.0.1', '127.0.0', '127.0.0.1.evil.com', '1127.0.0.1', '', 'localhost']) assert.ok(!isLoopback(a), a);
});

test('host extraction from remote=<addr>:<port>, IPv4 and IPv6', () => {
  assert.equal(hostOf('127.0.0.2:11439'), '127.0.0.2');
  assert.equal(hostOf('::1:443'), '::1');
  assert.equal(hostOf('::ffff:127.0.0.1:11434'), '::ffff:127.0.0.1');
  assert.equal(hostOf('2606:4700::6810:622:443'), '2606:4700::6810:622');
});

test('agent egress: loopback forms are misreported loopback in both modes; real addresses are VIOLATION when contained', () => {
  for (const r of ['127.0.0.1:11434', '127.0.0.2:11439', '127.9.9.9:80', '::1:443', '::ffff:127.0.0.1:11434']) {
    assert.equal(C(egress(r), ctxC), 'loopback-misreported', r); assert.equal(C(egress(r), ctxD), 'loopback-misreported', r);
  }
  for (const r of ['10.0.0.1:443', '192.168.1.20:443', '::ffff:10.0.0.1:443', '2606:4700::6810:622:443', '128.0.0.1:80', '127.256.0.1:80']) {
    assert.equal(C(egress(r), ctxC), 'VIOLATION', r);
    assert.equal(C(egress(r), ctxD), 'control-egress', r);
    assert.equal(C(egress(r, 'external'), ctxD), 'UNATTRIBUTED', r);
    assert.equal(C(egress(r, 'external'), ctxC), 'UNATTRIBUTED', r);
  }
  // no root field (older watch.ps1) and an unknown root value: never an attributed class when contained
  assert.equal(C(`${T0} TRIP agent-nonloopback-connection pid=7 remote=10.0.0.1:443 name=x`, ctxC), 'VIOLATION');
  assert.equal(C(egress('10.0.0.1:443', 'weird'), ctxC), 'VIOLATION');
  // malformed remote is not loopback
  assert.equal(C(`${T0} TRIP agent-nonloopback-connection pid=7 remote=garbage name=x root=eval`, ctxC), 'VIOLATION');
  assert.equal(C(`${T0} TRIP agent-nonloopback-connection pid=7 name=x root=eval`, ctxC), 'VIOLATION');
});

test('meter clients: broker-less client is VIOLATION when contained, whatever it is called', () => {
  for (const who of [EVAL_JCODE, 'name=node.exe cmd="C:\\x\\_agent-tools\\node.exe" streamprobe.mjs control 127.0.0.2 11439 o 2', 'name=powershell.exe cmd=powershell -File run-in-job.ps1', 'name=? cmd=', 'name=curl.exe cmd=curl http://127.0.0.2:11439/v1/models'])
    assert.equal(C(`${T0} TRIP meter-connection-from-non-broker pid=9 ${who}`, ctxC), 'VIOLATION', who);
  assert.equal(C(`${T0} TRIP meter-connection-from-non-broker pid=9 ${EVAL_JCODE}`, ctxD), 'control-expected');
  // a non-eval jcode (no evalbroker profile) dialing the meter in control mode is not expected traffic
  assert.equal(C(`${T0} TRIP meter-connection-from-non-broker pid=9 name=jcode.exe cmd="jcode.exe" run "x"`, ctxD), 'UNATTRIBUTED');
});

test('Ollama clients: warm-up curl only inside the window (or the same curl pid continuing); imitations are not attributed', () => {
  const at = (time, pid = 50) => `${time} TRIP ollama-connection-from-non-meter pid=${pid} name=curl.exe ${CURL}`;
  assert.equal(C(at(T0), ctxC), 'harness-warmup');
  assert.equal(C(at('2026-10-05T11:00:00'), ctxC), 'UNATTRIBUTED');
  assert.equal(C(at('2026-10-05T11:00:00'), ctxD), 'UNATTRIBUTED');
  // a cold load outlasting the window: the same pid keeps its attribution; a different pid later does not
  const r = classifyLog([at(T0, 50), at('2026-10-05T10:01:30', 50), at('2026-10-05T10:01:30', 51)].join('\n'), ctxD);
  assert.deepEqual(r.counts, { 'harness-warmup': 2, UNATTRIBUTED: 1 });
  // a curl with a different request (not the 1-token warm-up) is never warm-up, even inside the window
  assert.equal(C(`${T0} TRIP ollama-connection-from-non-meter pid=50 name=curl.exe cmd=curl http://127.0.0.1:11434/api/chat -d "{}"`, ctxC), 'UNATTRIBUTED');
  // run.ts pin query vs an agent-launched node running a sandbox copy of run.ts
  assert.equal(C(`${T0} TRIP ollama-connection-from-non-meter pid=2 name=node.exe cmd="C:\\x\\node.exe" evals/run.ts --agent jcode`, ctxC), 'harness-gate');
  assert.equal(C(`${T0} TRIP ollama-connection-from-non-meter pid=2 name=node.exe cmd="C:\\T\\agent-evals\\r\\_agent-tools\\node.exe" evals/run.ts`, ctxD), 'UNATTRIBUTED');
  assert.equal(C(`${T0} TRIP ollama-connection-from-non-meter pid=2 name=node.exe cmd="node.exe" C:\\T\\agent-evals\\r\\T01\\evals\\run.ts`, ctxD), 'UNATTRIBUTED');
  // streamprobe attribution only for probe.sh evidence
  const sp = `${T0} TRIP ollama-connection-from-non-meter pid=3 name=node.exe cmd=node streamprobe.mjs`;
  assert.equal(C(sp, ctxD), 'UNATTRIBUTED'); assert.equal(C(sp, { ...ctxD, probe: true }), 'probe');
  // jcode talking to Ollama directly is never attributed (both modes)
  assert.equal(C(`${T0} TRIP ollama-connection-from-non-meter pid=4 ${EVAL_JCODE}`, ctxC), 'UNATTRIBUTED');
  assert.equal(C(`${T0} TRIP ollama-connection-from-non-meter pid=4 ${EVAL_JCODE}`, ctxD), 'UNATTRIBUTED');
});

test('vanished process (name=?) at a partial or unparsable timestamp is never warm-up', () => {
  for (const ts of ['2026-10-05T10:00', '2026-10-05', 'garbage', '10:00:00', '2026-13-45T99:99:99'])
    assert.equal(C(`${ts} TRIP ollama-connection-from-non-meter pid=1 name=? cmd=`, ctxC), ts === '2026-10-05T10:00' ? 'harness-warmup' : 'UNATTRIBUTED', ts);
});

test('malformed / truncated / garbled TRIP lines are counted and flagged, never dropped', () => {
  const lines = [
    `${T0} TRIP agent-nonloopback-connection`,             // truncated: no fields
    `${T0} TRIP`,                                          // truncated: no kind
    `  ${T0} TRIP outside-dir-written entries=a`,          // leading junk
    `${T0}TRIP meter-connection-from-non-broker pid=1`,    // missing space
    `\uFEFF${T0} TRIP outside-dir-written entries=a`,      // BOM: parses
    `${T0} heartbeat samples=30 maxConcurrentJcode=1`,     // not a TRIP: ignored
    `${T0} watch stop samples=99`,                         // not a TRIP: ignored
  ];
  const r = classifyLog(lines.join('\r\n'), ctxC);
  assert.equal(r.total, 5);
  assert.equal(r.flagged.length, 5);
  assert.equal(r.counts.VIOLATION, 1);
  assert.equal(r.counts.UNATTRIBUTED, 4);
});

test('duplicates: every repeated line is counted and flagged again (no de-duplication hides a repeat)', () => {
  const v = egress('10.0.0.1:443');
  const r = classifyLog([v, v, v].join('\n'), ctxC);
  assert.equal(r.counts.VIOLATION, 3); assert.equal(r.flagged.length, 3);
});

test('property: a breakage line stays VIOLATION/UNATTRIBUTED whatever noise surrounds it', () => {
  const breakages = [
    [egress('192.168.1.20:443'), ctxC], [egress('::ffff:8.8.8.8:53'), ctxC], [`${T0} TRIP outside-dir-written entries=x`, ctxC],
    [`${T0} TRIP outside-dir-written entries=x`, ctxD], [`${T0} TRIP meter-connection-from-non-broker pid=9 ${EVAL_JCODE}`, ctxC],
    [egress('10.0.0.1:443', 'external'), ctxD], [`${T0} TRIP ollama-connection-from-non-meter pid=4 ${EVAL_JCODE}`, ctxD],
  ];
  const noise = ['', ' extra=1', ' cmd=curl.exe /api/generate num_predict":1', ' root=eval', ' name=curl.exe', ' remote=127.0.0.1:11434', ' cmd=streamprobe.mjs evals/run.ts'];
  let n = 0;
  for (const [line, ctx] of breakages) for (const a of noise) {
    // appended noise must not turn it into an attributed class (the first field occurrence is the one parsed)
    const c = C(line + a, ctx);
    assert.ok(c === 'VIOLATION' || c === 'UNATTRIBUTED', `${line + a} -> ${c}`);
    n++;
  }
  assert.equal(n, breakages.length * noise.length);
});

test('time-ordered log: attribution of one line never changes another line\'s class (except the warm-up curl pid rule)', () => {
  const v = egress('10.0.0.1:443');
  const alone = classifyLog(v, ctxC).counts;
  const mixed = classifyLog([`${T0} TRIP ollama-connection-from-non-meter pid=50 name=curl.exe ${CURL}`, v, `${T0} TRIP meter-connection-from-non-broker pid=9 ${EVAL_JCODE}`].join('\n'), ctxD).counts;
  assert.deepEqual(alone, { VIOLATION: 1 });
  assert.deepEqual(mixed, { 'harness-warmup': 1, 'control-egress': 1, 'control-expected': 1 });
});

test('parseTrip takes the first occurrence of each field', () => {
  const t = parseTrip(`${T0} TRIP agent-nonloopback-connection pid=7 remote=10.0.0.1:443 name=x root=eval remote=127.0.0.1:1`);
  assert.equal(t.remote, '10.0.0.1:443');
});
