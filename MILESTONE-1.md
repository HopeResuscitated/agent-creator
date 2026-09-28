# @agent-creator/ai - Milestone Specifications

## NEXT RECOMMENDED MILESTONE 1: Core AI Abstraction Layer

### Objective
Build the foundational abstraction layer for AI model interactions, including types, orchestration interfaces, and core utilities.

---

## Files to Create

### 1. `packages/ai/types/index.ts`
- **Purpose**: Define all TypeScript type definitions for AI operations
- **Key Types**:
  - `AgentMessage` - Message interface with role/content metadata
  - `AgentTask` - Task specification with context and parameters
  - `ModelResponse` - Response from AI model with usage metrics
  - `ToolCall` - Tool invocation structure
  - `ContextState` - Runtime state for agent sessions

### 2. `packages/ai/orchestrator/index.ts`  
- **Purpose**: Core orchestrator class managing multi-turn conversations and tool execution
- **Key Methods**:
  - `initialize()` - Setup orchestrator with model configuration
  - `createTask()` - Create new task with context
  - `executeTool()` - Execute a tool call within agent context
  - `submitMessage()` - Submit message to LLM (mock interface)
  - `processResponse()` - Parse and structure model responses
  - `getHistory()` - Retrieve conversation history

### 3. `packages/ai/orchestrator/types.ts`
- **Purpose**: Internal types specific to orchestrator implementation
- **Key Types**:
  - `OrchestratorState` - State machine for agent lifecycle
  - `TurnContext` - Per-turn execution context
  - `ToolRegistry` - Registration interface for available tools

### 4. `packages/ai/utils/index.ts`
- **Purpose**: Utility functions for AI operations
- **Key Functions**:
  - `formatMessage()` - Format message for LLM API
  - `parseUsage()` - Extract usage metrics from response
  - `truncateText()` - Truncate long strings with ellipsis
  - `hashContext()` - Generate context hash for deduplication

---

## Implementation Priority

1. **Type definitions** (highest) - Foundation for all other code
2. **Orchestrator interface** - Core API surface
3. **Utility functions** - Support operations  
4. **Internal types** - Implementation details

---

## Verification Steps After Creation

```bash
# 1. Typecheck the packages
npm run typecheck

# 2. Verify exports are accessible
node -e "import('@agent-creator/ai').then(m => console.log(Object.keys(m)))"

# 3. Run linting
npm run lint
```

---

## Dependencies to Install (if needed)

Add these to root `package.json` when ready for full implementation:
```json
{
  "dependencies": {
    "@types/node": "^22.15.30",
    "typescript": "^5.8.3"
  }
}
```
