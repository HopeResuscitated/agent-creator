import { ToolResult, AgentEvent, Task } from '@agent-creator/protocol';

export namespace FSUtils {
  export interface ListDirectoryOptions {
    path: string;
    recursive?: boolean;
    includeHidden?: boolean;
  }

  export interface ReadFileOptions {
    path: string;
    encoding?: 'utf8' | 'binary';
    limit?: number;
  }

  export function listDirectory(options: ListDirectoryOptions): Promise<ToolResult> {
    // Implementation delegated to tool executor
    throw new Error('Not implemented');
  }

  export function readFile(options: ReadFileOptions): Promise<ToolResult> {
    // Implementation delegated to tool executor
    throw new Error('Not implemented');
  }
}
