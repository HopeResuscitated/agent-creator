import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentOrchestrator } from '../orchestrator.ts';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'eval-orch-')); }

test('hidden: runTask success path', async () => {
  const ws = await tmp();
  try {
    const o: any = new AgentOrchestrator();
    const task = await o.runTask('write then read', ws, async () => [
      { title: 'write', tool: 'write_file', args: { path: 'out/x.txt', content: 'X42' } },
      { title: 'read', tool: 'read_file', args: { path: 'out/x.txt' } },
    ]);
    assert.equal(task.status, 'completed');
    assert.equal(task.objective, 'write then read');
    assert.equal(task.steps.length, 2);
    assert.ok(task.steps.every((s: any) => s.status === 'completed'), JSON.stringify(task.steps));
    assert.equal(task.steps[1].result, 'X42');
    assert.notEqual(task.steps[0].id, task.steps[1].id);
    assert.equal(await fs.readFile(path.join(ws, 'out/x.txt'), 'utf8'), 'X42');
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test('hidden: runTask stops at first failure', async () => {
  const ws = await tmp();
  try {
    const o: any = new AgentOrchestrator();
    const task = await o.runTask('fail early', ws, async () => [
      { title: 'read missing', tool: 'read_file', args: { path: 'missing.txt' } },
      { title: 'should not run', tool: 'write_file', args: { path: 'never.txt', content: 'no' } },
    ]);
    assert.equal(task.status, 'failed');
    assert.equal(task.steps.length, 2);
    assert.equal(task.steps[0].status, 'failed');
    assert.ok(typeof task.steps[0].error === 'string' && task.steps[0].error.length > 0);
    assert.equal(task.steps[1].status, 'pending');
    await assert.rejects(fs.access(path.join(ws, 'never.txt')));
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test('hidden: planner throwing -> failed, no throw', async () => {
  const ws = await tmp();
  try {
    const o: any = new AgentOrchestrator();
    const task = await o.runTask('bad plan', ws, async () => { throw new Error('planner exploded'); });
    assert.equal(task.status, 'failed');
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});
