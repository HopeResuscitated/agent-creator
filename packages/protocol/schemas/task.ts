// @agent-creator/protocol
// Shared type definitions for the autonomous agent platform

export interface Task {
  id: string;
  objective: string;
  status: TaskStatus;
  phase: TaskPhase;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  steps: TaskStep[];
}

export type TaskStatus = 
  | 'pending'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type TaskPhase = 
  | 'understanding'
  | 'inspection'
  | 'planning'
  | 'implementation'
  | 'debugging'
  | 'verification'
  | 'review'
  | 'complete';

export interface TaskStep {
  id: string;
  title: string;
  description?: string;
  status: StepStatus;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  toolCalls?: ToolCall[];
  result?: any;
  error?: string;
}

export type StepStatus = 
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed';

export interface ChatMessage {
  id: string;
  taskId: string;
  role: MessageRole;
  content: string;
  timestamp: ISODateString;
  toolCalls?: ToolCall[];
}

export type MessageRole = 
  | 'user'
  | 'assistant'
  | 'system';

export interface ToolCall {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  timestamp: ISODateString;
}

export interface ToolResult {
  callId: string;
  tool: string;
  success: boolean;
  data?: any;
  error?: string;
  durationMs?: number;
}

export interface AgentEvent {
  id: string;
  taskId: string;
  timestamp: ISODateString;
  type: EventTypes;
  payload: Record<string, unknown>;
}

export type EventTypes = 
  | 'task.created'
  | 'task.started'
  | 'phase.changed'
  | 'plan.created'
  | 'step.started'
  | 'step.completed'
  | 'model.requested'
  | 'model.completed'
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'file.modified'
  | 'verification.started'
  | 'verification.completed';

export interface Agent {
  id: string;
  role: AgentRole;
  taskId?: string;
  status: AgentStatus;
  capabilities: string[];
  workspace: string;
}

export type AgentRole = 
  | 'director'
  | 'scout'
  | 'builder'
  | 'synthesizer'
  | 'negotiator'
  | 'auditor'
  | 'caretaker';

export type AgentStatus = 
  | 'idle'
  | 'active'
  | 'busy'
  | 'completed'
  | 'failed';

export interface FileChange {
  path: string;
  action: FileAction;
  content?: string;
  preview?: string;
}

export type FileAction = 
  | 'created'
  | 'modified'
  | 'deleted'
  | 'renamed';

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  summary: string;
}

export interface VerificationCheck {
  name: string;
  status: CheckStatus;
  message?: string;
}

export type CheckStatus = 
  | 'passed'
  | 'failed'
  | 'skipped';
