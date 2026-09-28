// @agent-creator/agent/tools
// Tool registry + executor. Types come from @agent-creator/protocol only.

import type { ExecutionOptions, ToolDefinition, ToolResult } from '@agent-creator/protocol';
import { editFile, listDir, readFile, writeFile } from './fs.ts';
import { grep } from './search.ts';
import { runCommand } from './shell.ts';
import { fail } from './sandbox.ts';

export { resolveInRoot } from './sandbox.ts';

export const tools: ToolDefinition<unknown>[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the repo root.',
    parameters: [{ name: 'path', type: 'string', required: true }],
    implementation: readFile,
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file (append: true to append). Creates parent dirs.',
    parameters: [
      { name: 'path', type: 'string', required: true },
      { name: 'content', type: 'string', required: true },
      { name: 'append', type: 'boolean' },
    ],
    implementation: writeFile,
  },
  {
    name: 'edit_file',
    description: 'Exact find-and-replace. old_string must be unique unless replace_all.',
    parameters: [
      { name: 'path', type: 'string', required: true },
      { name: 'old_string', type: 'string', required: true },
      { name: 'new_string', type: 'string', required: true },
      { name: 'replace_all', type: 'boolean' },
    ],
    implementation: editFile,
  },
  {
    name: 'list_dir',
    description: 'List directory entries (recursive optional).',
    parameters: [
      { name: 'path', type: 'string' },
      { name: 'recursive', type: 'boolean' },
      { name: 'include_hidden', type: 'boolean' },
    ],
    implementation: listDir,
  },
  {
    name: 'run_command',
    description: 'Run a shell command with cwd inside the repo root. Captures stdout/stderr; times out.',
    parameters: [
      { name: 'command', type: 'string', required: true },
      { name: 'cwd', type: 'string' },
      { name: 'timeout_ms', type: 'number' },
    ],
    implementation: runCommand,
  },
  {
    name: 'grep',
    description: 'Search file contents by regex (or literal) under a path.',
    parameters: [
      { name: 'pattern', type: 'string', required: true },
      { name: 'path', type: 'string' },
      { name: 'glob', type: 'string' },
      { name: 'literal', type: 'boolean' },
      { name: 'case_sensitive', type: 'boolean' },
      { name: 'max_results', type: 'number' },
    ],
    implementation: grep,
  },
];

const byName = new Map(tools.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition<unknown> | undefined {
  return byName.get(name);
}

/** Validate required params, then run the tool. Never throws. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  options?: ExecutionOptions,
): Promise<ToolResult> {
  const t = Date.now();
  const tool = byName.get(name);
  if (!tool) return fail(name, `unknown tool: ${name}`, t);
  for (const p of tool.parameters) {
    if (p.required && (args[p.name] === undefined || args[p.name] === null)) {
      return fail(name, `missing required argument: ${p.name}`, t);
    }
  }
  try {
    return (await tool.implementation(args, options)) as ToolResult;
  } catch (e) {
    return fail(name, e, t);
  }
}
