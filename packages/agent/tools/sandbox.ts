// @agent-creator/agent/tools/sandbox
// Path sandboxing + ToolResult helpers shared by all tools.

import path from 'node:path';
import type { ExecutionOptions, ToolResult } from '@agent-creator/protocol';

export function callId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function ok(tool: string, data: unknown, startedAt: number, metadata?: Record<string, unknown>): ToolResult {
  return { callId: callId(), tool, success: true, data, durationMs: Date.now() - startedAt, metadata };
}

export function fail(tool: string, error: unknown, startedAt: number, metadata?: Record<string, unknown>): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { callId: callId(), tool, success: false, error: message, durationMs: Date.now() - startedAt, metadata };
}

/** Repo root for this call: options.context.workspace, else process.cwd(). */
export function rootOf(options?: ExecutionOptions): string {
  return path.resolve(options?.context?.workspace ?? process.cwd());
}

/**
 * Resolve `p` against `root` and refuse anything that escapes it.
 * Throws on escape; returns the absolute path otherwise.
 */
export function resolveInRoot(root: string, p: unknown): string {
  if (typeof p !== 'string' || p.length === 0) throw new Error('path must be a non-empty string');
  if (p.includes('\0')) throw new Error('path contains a null byte');
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes repo root: ${p}`);
  }
  return abs;
}

export function str(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) {
    if (required) throw new Error(`missing required argument: ${key}`);
    return undefined;
  }
  if (typeof v !== 'string') throw new Error(`argument ${key} must be a string`);
  return v;
}
