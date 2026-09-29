// @agent-creator/protocol
// Tool registration and execution contracts

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions: PermissionLevel;
}

export type PermissionLevel =
  | 'read'
  | 'write'
  | 'execute'
  | 'admin';

export interface ToolRegistry {
  [name: string]: ToolDefinition;
}

export interface ToolExecutionContext {
  workspace: string;
  taskId: string;
  agentId?: string;
}

export interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
  context: ToolExecutionContext;
}

/**
 * Result structure for ANY tool execution.
 * NEVER return plain prose - always use this structured format.
 */
export type ToolExecutionResult<T = any> =
  | { success: true; data: T }
  | { success: false; error: string };
