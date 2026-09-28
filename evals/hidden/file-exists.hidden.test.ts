import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeTool, tools } from '../tools/index.ts';

let root = '';
let opts: any;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-fe-'));
  opts = { context: { workspace: root, timestamp: new Date().toISOString() } };
  await fs.writeFile(path.join(root, 'f.txt'), 'x');
  await fs.mkdir(path.join(root, 'sub'));
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('hidden: registered', () => assert.ok(tools.some((t) => t.name === 'file_exists')));
test('hidden: file', async () => {
  const r = await executeTool('file_exists', { path: 'f.txt' }, opts);
  assert.equal(r.success, true, r.error);
  assert.deepEqual(r.data, { exists: true, type: 'file' });
});
test('hidden: dir', async () => {
  const r = await executeTool('file_exists', { path: 'sub' }, opts);
  assert.equal(r.success, true, r.error);
  assert.deepEqual(r.data, { exists: true, type: 'dir' });
});
test('hidden: missing', async () => {
  const r = await executeTool('file_exists', { path: 'nope.txt' }, opts);
  assert.equal(r.success, true, r.error);
  assert.deepEqual(r.data, { exists: false, type: null });
});
test('hidden: escape refused', async () => {
  const r = await executeTool('file_exists', { path: '../outside.txt' }, opts);
  assert.equal(r.success, false);
});
test('hidden: missing arg refused', async () => {
  const r = await executeTool('file_exists', {}, opts);
  assert.equal(r.success, false);
});
