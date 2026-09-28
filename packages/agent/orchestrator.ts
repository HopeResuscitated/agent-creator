// @agent-creator/agent
// Main orchestrator entry point for the autonomous agent platform

import type { Task, ToolResult } from '@agent-creator/protocol';
import { executeTool } from './tools/index.ts';

/**
 * Agent orchestrator - manages task lifecycle and tool execution.
 */
export class AgentOrchestrator {
  private taskIdCounter = 0;
  
  async initialize(workspace: string): Promise<void> {
    console.log(`[Agent] Initialized in workspace: ${workspace}`);
  }

  /**
   * Create a new task from user input.
   */
  createTask(objective: string, options?: Partial<Task>): Task {
    this.taskIdCounter++;
    
    const task: Task = {
      id: `task_${this.taskIdCounter}`,
      objective,
      status: 'pending',
      phase: 'understanding',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: []
    };

    console.log(`[Agent] Created task ${task.id}: ${objective}`);
    return task;
  }

  /**
   * Execute a tool call.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: { workspace: string; taskId?: string }
  ): Promise<ToolResult> {
    return executeTool(toolName, args, {
      context: context && {
        workspace: context.workspace,
        taskId: context.taskId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Process a tool call response.
   */
  processToolResult(
    callId: string,
    result: Record<string, any>
  ): { success: boolean; data?: unknown; error?: string } {
    
    if (!result || typeof result !== 'object') {
      return {
        success: false,
        error: 'Invalid tool response format. Expected structured data.'
      };
    }

    const { callId: receivedCallId, tool, success, data, error }: any = result;

    if (receivedCallId !== callId) {
      return {
        success: false,
        error: `Tool response mismatch: expected ${callId}, got ${receivedCallId}`
      };
    }

    if (!success && !error) {
      return {
        success: false,
        error: 'Tool execution failed but no error message provided'
      };
    }

    return {
      success: true,
      data,
      error: error || undefined
    };
  }
}

export const createOrchestrator = (): AgentOrchestrator => 
  new AgentOrchestrator();
