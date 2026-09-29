// @agent-creator/agent/test
// Step 2 verification: one real end-to-end task + truthful-failure cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentOrchestrator, scriptedPlanner } from '../orchestrator.ts';

const withWs = async (fn: (ws: string) => Promise<void>) => {
  const ws = mkdtempSync(join(tmpdir(), 'orch-test-'));
  try { await fn(ws); } finally { rmSync(ws, { recursive: true, force: true }); }
};

test('end-to-end: create a file, read it back, confirm content', async () =>
  withWs(async (ws) => {
    const orch = new AgentOrchestrator();
    await orch.initialize(ws);

    const report = await orch.runTask(
      'create notes/hello.txt containing "hello agent", then read it back and confirm',
      scriptedPlanner([
        {
          id: 's1', tool: 'write_file',
          args: { path: 'notes/hello.txt', content: 'hello agent' },
          verify: { kind: 'file_contains', path: 'notes/hello.txt', pattern: 'hello agent' },
        },
        {
          id: 's2', tool: 'read_file',
          args: { path: 'notes/hello.txt' },
          verify: { kind: 'file_exists', path: 'notes/hello.txt' },
        },
      ])
    );

    assert.equal(report.ok, true);
    assert.equal(report.stepsCompleted, 2);
    assert.match(readFileSync(join(ws, 'notes/hello.txt'), 'utf8'), /hello agent/);
  }));

test('truthful failure: sandbox escape is reported, not hidden', async () =>
  withWs(async (ws) => {
    const orch = new AgentOrchestrator();
    await orch.initialize(ws);

    const report = await orch.runTask(
      'attempt to write outside the workspace',
      scriptedPlanner([
        { id: 's1', tool: 'write_file', args: { path: '../../escape.txt', content: 'x' } },
        { id: 's2', tool: 'write_file', args: { path: 'never.txt', content: 'y' } },
      ])
    );

    assert.equal(report.ok, false);
    assert.equal(report.failedStepId, 's1');
    assert.equal(report.stepsCompleted, 0);
    assert.ok(report.error);
  }));

test('verify failure is caught even when the tool call succeeds', async () =>
  withWs(async (ws) => {
    const orch = new AgentOrchestrator();
    await orch.initialize(ws);

    const report = await orch.runTask(
      'write A but claim B',
      scriptedPlanner([
        {
          id: 's1', tool: 'write_file',
          args: { path: 'out.txt', content: 'actual' },
          verify: { kind: 'file_contains', path: 'out.txt', pattern: 'expected' },
        },
      ])
    );

    assert.equal(report.ok, false);
    assert.match(report.error!, /verify failed/);
  }));
