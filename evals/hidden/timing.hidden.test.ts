import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentOrchestrator } from '../orchestrator.ts';

test('hidden: one timing line per tool call', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-timing-'));
  try {
    const o = new AgentOrchestrator();
    const r1 = await o.executeTool('write_file', { path: 'a.txt', content: 'hi' }, { workspace: ws, taskId: 't1' });
    assert.equal(r1.success, true, r1.error);
    const r2 = await o.executeTool('read_file', { path: 'nope.txt' }, { workspace: ws, taskId: 't1' });
    assert.equal(r2.success, false, 'ToolResult must be returned unchanged');
    const log = await fs.readFile(path.join(ws, 'docs', 'tool-timing.log'), 'utf8');
    const lines = log.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    assert.equal(lines.length, 2, log);
    const expect = [['write_file', 'ok'], ['read_file', 'error']];
    lines.forEach((line, i) => {
      const f = line.split('|').map((x) => x.trim());
      assert.equal(f.length, 5, line);
      assert.ok(!Number.isNaN(Date.parse(f[0])), `timestamp: ${f[0]}`);
      assert.equal(f[1], expect[i][0]);
      assert.equal(f[2], 't1');
      assert.ok(/^\d+$/.test(f[3]), `durationMs: ${f[3]}`);
      assert.equal(f[4], expect[i][1]);
    });
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});
