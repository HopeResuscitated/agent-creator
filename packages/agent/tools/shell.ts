// @agent-creator/agent/tools/shell
// run_command: shell exec sandboxed to the repo root, with timeout + capture.

import { spawn, spawnSync } from 'node:child_process';
import type { ExecutionOptions, ToolResult } from '@agent-creator/protocol';
import { fail, ok, resolveInRoot, rootOf, str } from './sandbox.ts';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 100_000;

/** Absolute paths or ../ traversal that point outside the root are refused. */
function checkCommand(command: string, root: string): void {
  if (/(^|[\s"'=])\.\.([\\/]|$|\s)/.test(command)) {
    throw new Error('command refused: parent-directory traversal (..) is not allowed');
  }
  const absPaths = command.match(/(?:[A-Za-z]:[\\/]|(?<![\w.])\/)[^\s"'|&;<>]*/g) ?? [];
  for (const p of absPaths) {
    if (p === '/' || /^\/[A-Za-z]$/.test(p)) continue; // flags like /c, /T
    try {
      resolveInRoot(root, p);
    } catch {
      throw new Error(`command refused: absolute path outside repo root: ${p}`);
    }
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

function clip(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + '\n...[truncated]' : s;
}

export async function runCommand(args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
  const t = Date.now();
  try {
    const root = rootOf(options);
    const command = str(args, 'command')!;
    const cwd = resolveInRoot(root, str(args, 'cwd', false) ?? '.');
    const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    checkCommand(command, root);

    const res = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
      const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32' });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    });

    const meta = { command, cwd, exitCode: res.code, stdout: clip(res.stdout), stderr: clip(res.stderr), timedOut: res.timedOut };
    if (res.timedOut) return fail('run_command', `command timed out after ${timeoutMs}ms`, t, meta);
    if (res.code !== 0) return fail('run_command', `command exited with code ${res.code}`, t, meta);
    return ok('run_command', clip(res.stdout), t, meta);
  } catch (e) {
    return fail('run_command', e, t);
  }
}
