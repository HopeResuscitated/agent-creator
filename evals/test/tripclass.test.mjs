// Fixture tests for evals/bench/tripclass.mjs. Lines are real watch.log lines from the archive (pids kept).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrip, classifyTrip, classifyLog } from '../bench/tripclass.mjs';

const L = {
  warmCurl: '2026-10-01T07:31:29 TRIP ollama-connection-from-non-meter pid=996 name=curl.exe cmd=C:\\Users\\cierra\\AppData\\Local\\hermes\\git\\mingw64\\bin\\curl.exe -s -m 600 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"hermes-local-32k\\",\\"prompt\\":\\"ok\\",\\"stream\\":false,\\"options\\":{\\"num_predict\\":1}}"',
  vanished: '\uFEFF2026-10-03T12:11:05 TRIP ollama-connection-from-non-meter pid=38500 name=? cmd=',
  hermesNode: '2026-10-02T17:50:18 TRIP ollama-connection-from-non-meter pid=6320 name=node.exe cmd="C:\\Users\\cierra\\AppData\\Local\\hermes\\node\\node.exe" server/server.js',
  manualJcode: '2026-10-02T12:00:00 TRIP ollama-connection-from-non-meter pid=1 name=jcode.exe cmd="C:\\Users\\cierra\\jcode-evalpin-a2-bin\\jcode.exe" run --provider ollama --model hermes-local-32k:latest "Inspect this repository"',
  gate: '2026-10-04T10:00:00 TRIP ollama-connection-from-non-meter pid=2 name=node.exe cmd="C:\\x\\node.exe" evals/run.ts --agent jcode --provider ollama',
  ctrlMeter: '2026-10-03T12:11:58 TRIP meter-connection-from-non-broker pid=29688 name=jcode.exe cmd="C:\\Users\\cierra\\jcode-evalpin-a2-bin\\jcode.exe" -p openai-compatible --provider-profile evalbroker -m hermes-local-32k run --no-update "The task"',
  loop2: '2026-10-03T12:11:58 TRIP agent-nonloopback-connection pid=29688 remote=127.0.0.2:11439',
  cf: '2026-09-30T10:00:00 TRIP agent-nonloopback-connection pid=5 remote=2606:4700::6810:622:443',
  probe: '2026-10-01T23:44:00 TRIP meter-connection-from-non-broker pid=15448 name=node.exe cmd="C:\\x\\_agent-tools\\node.exe" streamprobe.mjs control 127.0.0.2 11439 probe-out 2',
  outside: '2026-10-01T00:00:00 TRIP outside-dir-written entries=x.txt',
};
const warm = [Date.parse('2026-10-03T12:11:03'), Date.parse('2026-10-03T12:11:08')];
const C = (line, mode, warmup = null, probe = false) => classifyTrip(parseTrip(line), { mode, warmup, probe });
const warmCurlWin = [Date.parse('2026-10-01T07:31:20'), Date.parse('2026-10-01T07:31:40')];

test('parse: BOM, fields', () => {
  const t = parseTrip(L.vanished);
  assert.equal(t.kind, 'ollama-connection-from-non-meter'); assert.equal(t.name, '?'); assert.equal(t.cmd, ''); assert.equal(t.time, '2026-10-03T12:11:05');
  assert.equal(parseTrip('2026-10-01T00:00:00 heartbeat samples=30'), null);
});
test('warm-up curl is harness traffic in both modes, inside the warm-up window only', () => {
  assert.equal(C(L.warmCurl, 'contain', warmCurlWin), 'harness-warmup'); assert.equal(C(L.warmCurl, 'control', warmCurlWin), 'harness-warmup');
  assert.equal(C(L.warmCurl, 'control'), 'UNATTRIBUTED'); assert.equal(C(L.warmCurl, 'control', warm), 'UNATTRIBUTED');
});
test('vanished process: warm-up only inside the window', () => {
  assert.equal(C(L.vanished, 'control', warm), 'harness-warmup');
  assert.equal(C(L.vanished, 'control', [warm[0] + 60000, warm[1] + 60000]), 'UNATTRIBUTED');
  assert.equal(C(L.vanished, 'control', null), 'UNATTRIBUTED');
});
test('other Ollama clients are never attributed', () => {
  for (const m of ['contain', 'control']) { assert.equal(C(L.hermesNode, m), 'UNATTRIBUTED'); assert.equal(C(L.manualJcode, m), 'UNATTRIBUTED'); }
});
test('run.ts pin query is harness-gate', () => { assert.equal(C(L.gate, 'contain'), 'harness-gate'); });
test('meter client: expected in control, VIOLATION in contained', () => {
  assert.equal(C(L.ctrlMeter, 'control'), 'control-expected'); assert.equal(C(L.ctrlMeter, 'contain'), 'VIOLATION');
});
test('127.0.0.2 is loopback; real egress is VIOLATION when contained', () => {
  assert.equal(C(L.loop2, 'control'), 'loopback-misreported'); assert.equal(C(L.loop2, 'contain'), 'loopback-misreported');
  assert.equal(C(L.cf, 'control'), 'control-egress'); assert.equal(C(L.cf, 'contain'), 'VIOLATION');
});
test('probe and outside-dir', () => {
  assert.equal(C(L.probe, 'control', null, true), 'probe'); assert.equal(C(L.probe, 'control'), 'UNATTRIBUTED'); assert.equal(C(L.probe, 'contain'), 'VIOLATION'); assert.equal(C(L.outside, 'control'), 'VIOLATION'); assert.equal(C(L.outside, 'contain'), 'VIOLATION');
});
test('unknown TRIP kind is UNATTRIBUTED', () => { assert.equal(C('2026-10-01T00:00:00 TRIP something-new pid=1', 'contain'), 'UNATTRIBUTED'); });
test('classifyLog counts and flags', () => {
  const r = classifyLog([L.vanished, L.ctrlMeter, L.loop2, L.hermesNode, 'x heartbeat'].join('\r\n'), { mode: 'control', warmup: warm });
  assert.equal(r.total, 4);
  assert.deepEqual(r.counts, { 'harness-warmup': 1, 'control-expected': 1, 'loopback-misreported': 1, UNATTRIBUTED: 1 });
  assert.equal(r.flagged.length, 1); assert.match(r.flagged[0], /server\/server\.js/);
});
test('agent egress root: external jcode tree is never attributed', () => {
  const ext = '2026-10-05T00:00:00 TRIP agent-nonloopback-connection pid=7 remote=192.168.1.20:443 name=node.exe root=external';
  const ev = '2026-10-05T00:00:00 TRIP agent-nonloopback-connection pid=7 remote=192.168.1.20:443 name=node.exe root=eval';
  assert.equal(C(ext, 'control'), 'UNATTRIBUTED'); assert.equal(C(ext, 'contain'), 'UNATTRIBUTED');
  assert.equal(C(ev, 'control'), 'control-egress'); assert.equal(C(ev, 'contain'), 'VIOLATION');
});

// Sampling race seen once in C (ev-C1-control, pid 36180): first sample name=? cmd= empty, next sample the eval jcode.
const nameless = (time, pid = 36180) => `${time} TRIP meter-connection-from-non-broker pid=${pid} name=? cmd=`;
const evalMeter = (time, pid = 36180) => `${time} TRIP meter-connection-from-non-broker pid=${pid} name=jcode.exe cmd="C:\\Users\\cierra\\jcode-evalpin-a3cand-bin\\jcode.exe" -p openai-compatible --provider-profile evalbroker -m hermes-local-32k run --no-update "task"`;
const L2 = (lines, mode) => classifyLog(lines.join('\n'), { mode, warmup: null });
test('late-name: control, same pid control-expected 10 s later -> attributed, nothing flagged', () => {
  const r = L2([nameless('2026-10-04T21:20:51'), evalMeter('2026-10-04T21:21:01')], 'control');
  assert.deepEqual(r.counts, { 'control-expected-late-name': 1, 'control-expected': 1 }); assert.equal(r.flagged.length, 0);
});
test('late-name never applies in contained mode', () => {
  const r = L2([nameless('2026-10-04T21:20:51'), evalMeter('2026-10-04T21:21:01')], 'contain');
  assert.deepEqual(r.counts, { VIOLATION: 2 }); assert.equal(r.flagged.length, 2);
});
test('late-name stays UNATTRIBUTED: no follow-up, different pid, too late, earlier only, or non-eval process', () => {
  const cases = [
    [nameless('2026-10-04T21:20:51')],
    [nameless('2026-10-04T21:20:51'), evalMeter('2026-10-04T21:21:01', 999)],
    [nameless('2026-10-04T21:20:51'), evalMeter('2026-10-04T21:21:07')],
    [evalMeter('2026-10-04T21:20:41'), nameless('2026-10-04T21:20:51')],
    [nameless('2026-10-04T21:20:51'), '2026-10-04T21:21:01 TRIP meter-connection-from-non-broker pid=36180 name=node.exe cmd="C:\\x\\node.exe" other.mjs'],
  ];
  for (const c of cases) { const r = L2(c, 'control'); assert.equal(r.counts['control-expected-late-name'] ?? 0, 0, c.join(' / ')); assert.ok(r.flagged.some((f) => /name=\? cmd=$/.test(f)), c.join(' / ')); }
});
test('late-name does not touch nameless Ollama clients or nameless lines with a command line', () => {
  const r = L2(['2026-10-04T21:20:51 TRIP ollama-connection-from-non-meter pid=36180 name=? cmd=', evalMeter('2026-10-04T21:21:01')], 'control');
  assert.equal(r.counts.UNATTRIBUTED, 1);
  const r2 = L2(['2026-10-04T21:20:51 TRIP meter-connection-from-non-broker pid=36180 name=? cmd=x.exe', evalMeter('2026-10-04T21:21:01')], 'control');
  assert.equal(r2.counts.UNATTRIBUTED, 1);
});
