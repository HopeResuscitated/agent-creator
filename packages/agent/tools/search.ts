// @agent-creator/agent/tools/search
// grep: pure-Node recursive regex/literal search inside the repo root.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionOptions, ToolResult } from '@agent-creator/protocol';
import { fail, ok, resolveInRoot, rootOf, str } from './sandbox.ts';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', 'coverage']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full);
    } else if (e.isFile()) yield full;
  }
}

function globToRegex(glob: string): RegExp {
  const src = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${src}$`, 'i');
}

export async function grep(args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
  const t = Date.now();
  try {
    const root = rootOf(options);
    const pattern = str(args, 'pattern')!;
    const base = resolveInRoot(root, str(args, 'path', false) ?? '.');
    const glob = str(args, 'glob', false);
    const maxResults = typeof args.max_results === 'number' ? args.max_results : 200;
    const flags = args.case_sensitive === true ? '' : 'i';
    const source = args.literal === true ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
    let re: RegExp;
    try { re = new RegExp(source, flags); } catch { throw new Error(`invalid regex: ${pattern}`); }
    const globRe = glob ? globToRegex(glob) : undefined;

    const matches: Array<{ file: string; line: number; content: string }> = [];
    const stat = await fs.stat(base);
    const files = stat.isFile() ? [base] : walk(base);
    outer: for await (const file of files) {
      if (globRe && !globRe.test(path.basename(file))) continue;
      if ((await fs.stat(file)).size > MAX_FILE_BYTES) continue;
      const text = await fs.readFile(file, 'utf8');
      if (text.includes('\0')) continue; // binary
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          matches.push({ file: path.relative(root, file).split(path.sep).join('/'), line: i + 1, content: lines[i] });
          if (matches.length >= maxResults) break outer;
        }
      }
    }
    return ok('grep', matches, t, { pattern, count: matches.length, truncated: matches.length >= maxResults });
  } catch (e) {
    return fail('grep', e, t);
  }
}
