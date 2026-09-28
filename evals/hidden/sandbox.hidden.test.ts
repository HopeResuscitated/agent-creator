import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeTool } from '../tools/index.ts';

let root = '';
let outside = '';
let opts: any;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-sbx-root-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-sbx-out-'));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET');
  await fs.writeFile(path.join(root, 'normal.txt'), 'fine');
  await fs.symlink(outside, path.join(root, 'link'), 'junction');
  opts = { context: { workspace: root, timestamp: new Date().toISOString() } };
});
after(async () => {
  await fs.rm(path.join(root, 'link'), { force: true, recursive: false }).catch(() => fs.unlink(path.join(root, 'link')).catch(() => {}));
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test('hidden: read through junction refused', async () => {
  const r = await executeTool('read_file', { path: 'link/secret.txt' }, opts);
  assert.equal(r.success, false, 'read escaped the sandbox');
});
test('hidden: write through junction refused', async () => {
  const r = await executeTool('write_file', { path: 'link/evil.txt', content: 'x' }, opts);
  assert.equal(r.success, false, 'write escaped the sandbox');
  await assert.rejects(fs.access(path.join(outside, 'evil.txt')));
});
test('hidden: list_dir through junction refused', async () => {
  const r = await executeTool('list_dir', { path: 'link' }, opts);
  assert.equal(r.success, false);
});
test('hidden: run_command cwd through junction refused', async () => {
  const r = await executeTool('run_command', { command: 'echo hi', cwd: 'link' }, opts);
  assert.equal(r.success, false);
});
test('hidden: normal paths still work', async () => {
  const r1 = await executeTool('read_file', { path: 'normal.txt' }, opts);
  assert.equal(r1.success, true, r1.error);
  const r2 = await executeTool('write_file', { path: 'new/deep/ok.txt', content: 'ok' }, opts);
  assert.equal(r2.success, true, r2.error);
});
