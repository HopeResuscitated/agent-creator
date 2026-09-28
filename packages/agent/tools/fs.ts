// @agent-creator/agent/tools/fs
// read_file, write_file, edit_file, list_dir

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionOptions, ToolResult } from '@agent-creator/protocol';
import { fail, ok, resolveInRoot, rootOf, str } from './sandbox.ts';

const MAX_READ_BYTES = 1024 * 1024;

export async function readFile(args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
  const t = Date.now();
  try {
    const abs = resolveInRoot(rootOf(options), str(args, 'path'));
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error(`not a file: ${args.path}`);
    if (stat.size > MAX_READ_BYTES) throw new Error(`file too large (${stat.size} bytes > ${MAX_READ_BYTES})`);
    const content = await fs.readFile(abs, 'utf8');
    return ok('read_file', content, t, { path: abs, sizeBytes: stat.size });
  } catch (e) {
    return fail('read_file', e, t);
  }
}

export async function writeFile(args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
  const t = Date.now();
  try {
    const abs = resolveInRoot(rootOf(options), str(args, 'path'));
    const content = str(args, 'content')!;
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (args.append === true) await fs.appendFile(abs, content, 'utf8');
    else await fs.writeFile(abs, content, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    return ok('write_file', `wrote ${bytes} bytes`, t, { path: abs, bytes, append: args.append === true });
  } catch (e) {
    return fail('write_file', e, t);
  }
}

/** Exact find-and-replace. old_string must match exactly once unless replace_all. */
export async function editFile(args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
  const t = Date.now();
  try {
    const abs = resolveInRoot(rootOf(options), str(args, 'path'));
    const oldStr = str(args, 'old_string')!;
    const newStr = str(args, 'new_string')!;
    if (oldStr.length === 0) throw new Error('old_string must not be empty');
    if (oldStr === newStr) throw new Error('old_string and new_string are identical');
    const content = await fs.readFile(abs, 'utf8');
    const count = content.split(oldStr).length - 1;
    if (count === 0) throw new Error('old_string not found');
    if (count > 1 && args.replace_all !== true) {
      throw new Error(`old_string matches ${count} times; add context or set replace_all`);
    }
    const updated = args.replace_all === true ? content.split(oldStr).join(newStr) : content.replace(oldStr, () => newStr);
    await fs.writeFile(abs, updated, 'utf8');
    return ok('edit_file', `replaced ${args.replace_all === true ? count : 1} occurrence(s)`, t, { path: abs, replacements: args.replace_all === true ? count : 1 });
  } catch (e) {
    return fail('edit_file', e, t);
  }
}

export async function listDir(args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
  const t = Date.now();
  try {
    const root = rootOf(options);
    const abs = resolveInRoot(root, str(args, 'path', false) ?? '.');
    const recursive = args.recursive === true;
    const entries = await fs.readdir(abs, { withFileTypes: true, recursive });
    const items = entries
      .filter((e) => args.include_hidden === true || !e.name.startsWith('.'))
      .map((e) => {
        const full = path.join(e.parentPath ?? abs, e.name);
        return { path: path.relative(root, full).split(path.sep).join('/'), type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    return ok('list_dir', items, t, { path: abs, count: items.length, recursive });
  } catch (e) {
    return fail('list_dir', e, t);
  }
}
