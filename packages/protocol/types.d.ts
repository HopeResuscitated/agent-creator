/** ISO Date string format (YYYY-MM-DDTHH:mm:ss.sssZ) */
export type ISODateString = string;
export interface Task {
    id: string;
    objective: string;
    status: TaskStatus;
    phase: TaskPhase;
    createdAt: ISODateString;
    updatedAt: ISODateString;
    steps: TaskStep[];
    parentTaskId?: string;
}
export type TaskStatus = 'pending' | 'running' | 'blocked' | 'failed' | 'completed' | 'cancelled';
export type TaskPhase = 'understanding' | 'inspection' | 'planning' | 'implementation' | 'debugging' | 'verification' | 'review' | 'complete';
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
export type StepStatus = 'pending' | 'active' | 'completed' | 'failed';
export interface ChatMessage {
    id: string;
    taskId?: string;
    role: MessageRole;
    content: string;
    timestamp: ISODateString;
    toolCalls?: ToolCall[];
}
export type MessageRole = 'user' | 'assistant' | 'system';
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
    metadata?: Record<string, unknown>;
}
export type ToolResponse<T = any> = T extends object ? {
    callId: string;
    tool: string;
    success: boolean;
    data?: T;
    error?: string;
} : ToolResult;
export interface Agent {
    id: string;
    role: AgentRole;
    taskId?: string;
    status: AgentStatus;
    capabilities: string[];
    workspace: string;
}
export type AgentRole = 'director' | 'scout' | 'builder' | 'synthesizer' | 'negotiator' | 'auditor' | 'caretaker';
export type AgentStatus = 'idle' | 'active' | 'busy' | 'completed' | 'failed';
export interface FileChange {
    path: string;
    action: FileAction;
    content?: string;
    preview?: string;
}
export type FileAction = 'created' | 'modified' | 'deleted' | 'renamed';
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
export type CheckStatus = 'passed' | 'failed' | 'skipped';
export interface AgentEvent {
    id: string;
    taskId: string;
    timestamp: ISODateString;
    type: EventTypes;
    payload: Record<string, unknown>;
}
export type EventTypes = 'task.created' | 'task.started' | 'phase.changed' | 'plan.created' | 'step.started' | 'step.completed' | 'model.requested' | 'model.completed' | 'tool.requested' | 'tool.started' | 'tool.completed' | 'tool.failed' | 'file.modified' | 'verification.started' | 'verification.completed';
export interface SwarmNode {
    id: string;
    role: AgentRole;
    status: NodeStatus;
    lastHeartbeat?: ISODateString;
    capabilities: string[];
}
export type NodeStatus = 'connected' | 'disconnected' | 'reconnecting' | 'error';
export interface Channel {
    name: string;
    topic: ChannelTopic;
    subscribers: string[];
    publishers: string[];
}
export type ChannelTopic = 'k3.reports' | 'k3.status' | 'k3.flags' | 'k3.validation' | 'k3.deals' | 'k3.health' | 'k3.directives' | 'k3.targets' | 'k3.specs' | 'k3.intelligence' | 'k3.leads' | 'k3.artifacts' | 'k3.code';
export interface BroadcastMessage {
    channelId: ChannelTopic;
    payload: Record<string, unknown>;
}
export interface ExecutionContext {
    workspace: string;
    taskId?: string;
    sessionId?: string;
    timestamp: ISODateString;
}
export interface ExecutionOptions {
    timeoutMs?: number;
    retryCount?: number;
    retryDelayMs?: number;
    context?: ExecutionContext;
}
export interface ToolDefinition<T = any> {
    name: string;
    description: string;
    parameters: ToolParameter[];
    implementation: (args: Record<string, unknown>, options?: ExecutionOptions) => Promise<ToolResponse<T>>;
}
export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object';
    required?: boolean;
    description?: string;
}
export interface StatusReport {
    agentId: string;
    status: AgentStatus;
    currentTask?: Task;
    recentEvents: AgentEvent[];
    timestamp: ISODateString;
}
