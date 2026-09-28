// Real-execution tests for the tool executor, against a temp directory.
// Run: node --test packages/agent/test/tools.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ExecutionOptions } from '@agent-creator/protocol';
import { executeTool } from '../tools/index.ts';

let root = '';
let opts: ExecutionOptions;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tools-'));
  opts = { context: { workspace: root, timestamp: new Date().toISOString() } };
});
after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('write_file creates file and parent dirs', async () => {
  const r = await executeTool('write_file', { path: 'src/a.txt', content: 'hello\nworld\n' }, opts);
  assert.equal(r.success, true, r.error);
  assert.equal(await fs.readFile(path.join(root, 'src/a.txt'), 'utf8'), 'hello\nworld\n');
});

test('read_file returns content', async () => {
  const r = await executeTool('read_file', { path: 'src/a.txt' }, opts);
  assert.equal(r.success, true, r.error);
  assert.equal(r.data, 'hello\nworld\n');
});

test('edit_file replaces unique match, rejects ambiguous/missing', async () => {
  const r = await executeTool('edit_file', { path: 'src/a.txt', old_string: 'world', new_string: 'there' }, opts);
  assert.equal(r.success, true, r.error);
  assert.equal(await fs.readFile(path.join(root, 'src/a.txt'), 'utf8'), 'hello\nthere\n');

  await fs.writeFile(path.join(root, 'dup.txt'), 'x x x');
  const amb = await executeTool('edit_file', { path: 'dup.txt', old_string: 'x', new_string: 'y' }, opts);
  assert.equal(amb.success, false);
  assert.match(amb.error!, /matches 3 times/);
  const all = await executeTool('edit_file', { path: 'dup.txt', old_string: 'x', new_string: 'y', replace_all: true }, opts);
  assert.equal(all.success, true, all.error);
  assert.equal(await fs.readFile(path.join(root, 'dup.txt'), 'utf8'), 'y y y');

  const miss = await executeTool('edit_file', { path: 'src/a.txt', old_string: 'nope', new_string: 'z' }, opts);
  assert.equal(miss.success, false);
});

test('list_dir lists entries (recursive)', async () => {
  const r = await executeTool('list_dir', { path: '.', recursive: true }, opts);
  assert.equal(r.success, true, r.error);
  const paths = (r.data as Array<{ path: string }>).map((e) => e.path);
  assert.ok(paths.includes('src/a.txt'), JSON.stringify(paths));
  assert.ok(paths.includes('src'));
});

test('grep finds matches with line numbers', async () => {
  const r = await executeTool('grep', { pattern: 'there' }, opts);
  assert.equal(r.success, true, r.error);
  assert.deepEqual(r.data, [{ file: 'src/a.txt', line: 2, content: 'there' }]);
});

test('run_command captures stdout and exit code', async () => {
  const r = await executeTool('run_command', { command: 'node -e "console.log(process.cwd())"' }, opts);
  assert.equal(r.success, true, r.error);
  assert.equal(path.resolve(String(r.data).trim()), path.resolve(root));

  const bad = await executeTool('run_command', { command: 'node -e "process.exit(3)"' }, opts);
  assert.equal(bad.success, false);
  assert.equal(bad.metadata?.exitCode, 3);
});

test('run_command times out', async () => {
  const r = await executeTool('run_command', { command: 'node -e "setTimeout(()=>{},10000)"', timeout_ms: 500 }, opts);
  assert.equal(r.success, false);
  assert.match(r.error!, /timed out/);
});

test('sandbox refuses path escape', async () => {
  for (const [tool, args] of [
    ['read_file', { path: '../outside.txt' }],
    ['write_file', { path: '../../evil.txt', content: 'x' }],
    ['list_dir', { path: '..' }],
    ['grep', { pattern: 'x', path: os.homedir() }],
    ['run_command', { command: 'echo hi', cwd: '..' }],
    ['run_command', { command: 'cat ../secret' }],
    ['run_command', { command: `ls ${os.homedir()}` }],
  ] as const) {
    const r = await executeTool(tool, { ...args }, opts);
    assert.equal(r.success, false, `${tool} ${JSON.stringify(args)} should be refused`);
    assert.match(r.error!, /escapes repo root|refused/);
  }
});

test('unknown tool and missing args return structured errors', async () => {
  const u = await executeTool('nope', {}, opts);
  assert.equal(u.success, false);
  const m = await executeTool('read_file', {}, opts);
  assert.equal(m.success, false);
  assert.match(m.error!, /missing required argument: path/);
});
