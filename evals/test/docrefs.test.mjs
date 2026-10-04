// Tests for evals/test/docrefs.mjs reference extraction (the checker must not be vacuous).
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRefs, check } from './docrefs.mjs';

const kinds = (line) => extractRefs(line).map((r) => `${r.kind}:${r.v}`);
test('repo paths in code spans', () => {
  assert.deepEqual(kinds('run `bash evals/bench/suite.sh --out x` now'), ['path:evals/bench/suite.sh']);
  assert.deepEqual(kinds('plain evals/bench/suite.sh outside code is ignored'), []);
});
test('Windows paths: whole span when the span is a path (spaces allowed); URLs are not paths', () => {
  assert.deepEqual(kinds('in `C:\\Users\\cierra\\Desktop\\agent creator`'), ['abs:C:\\Users\\cierra\\Desktop\\agent creator']);
  assert.deepEqual(kinds('`curl -s http://127.0.0.1:11434/api/version`'), []);
  assert.deepEqual(kinds('`sha256sum C:/Users/cierra/x.exe` -> y'), ['abs:C:/Users/cierra/x.exe']);
});
test('commit-like hashes: 7/9/40 hex; 8-hex and ...-elided prefixes are not commits', () => {
  assert.deepEqual(kinds('jcode 7ed7403f8 at HEAD 5d3e8fe'), ['hash:7ed7403f8', 'hash:5d3e8fe']);
  assert.deepEqual(kinds('fingerprint 4dcba4e1 and f76eff11... and sha256 7ed7403f8'), []);
  assert.deepEqual(kinds('deadbeef1234'), []);
});
test('the real docs: some references are checked and all resolve', () => {
  const res = check();
  assert.deepEqual(res.filter((r) => r.level === 'FAIL'), []);
});
