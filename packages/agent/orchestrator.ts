import { readFileSync } from 'node:fs';
import type { Task, TaskStep, ToolResult } from '@agent-creator/protocol';
import { executeTool, resolveInRoot } from './tools/index.ts';

export type VerifyCheck =
  | { kind: 'file_exists'; path: string }
  | { kind: 'file_contains'; path: string; pattern: string };

export interface PlanStep {
  id: string;
  title?: string;
  tool: string;
  args: Record<string, unknown>;
  verify?: VerifyCheck;
}

/** Step 2 planner contract. */
export type Planner = (
  task: Task
) => Promise<Array<{ title: string; tool: string; args: Record<string, unknown> }>>;

export interface StepReport {
  id: string;
  tool: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface RunReport {
  taskId: string;
  objective: string;
  ok: boolean;
  stepsCompleted: number;
  totalSteps: number;
  steps: StepReport[];
  failedStepId?: string;
  error?: string;
  durationMs: number;
  finishedAt: string;
}

/**
 * Test/demo helper. It now conforms to the Step 2 Planner contract while
 * retaining the legacy verify metadata used by the existing local tests.
 */
export const scriptedPlanner = (steps: PlanStep[]): Planner =>
  async () =>
    steps.map((step) => ({
      title: step.title ?? step.id,
      tool: step.tool,
      args: {
        ...step.args,
        ...(step.verify ? { __orchestratorVerify: step.verify } : {}),
      },
    }));

export class AgentOrchestrator {
  private taskIdCounter = 0;
  private workspace = '';

  async initialize(workspace: string): Promise<void> {
    this.workspace = workspace;
  }

  createTask(objective: string, options?: Partial<Task>): Task {
    this.taskIdCounter++;

    const now = new Date().toISOString();

    return {
      id: `task_${this.taskIdCounter}`,
      objective,
      status: 'pending',
      phase: 'understanding',
      createdAt: now,
      updatedAt: now,
      steps: [],
      ...options,
    };
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: { workspace: string; taskId?: string }
  ): Promise<ToolResult> {
    return executeTool(toolName, args, {
      context: context
        ? {
            workspace: context.workspace,
            taskId: context.taskId,
            timestamp: new Date().toISOString(),
          }
        : undefined,
    });
  }

  /**
   * Step 2 API:
   * runTask(objective, workspace, planner) -> Task
   */
  async runTask(
    objective: string,
    workspace: string,
    planner: Planner
  ): Promise<Task>;

  /**
   * Legacy local-test API retained for compatibility:
   * runTask(objective, scriptedPlanner(...)) -> RunReport
   */
  async runTask(
    objective: string,
    planner: Planner,
  ): Promise<RunReport>;

  async runTask(
    objective: string,
    workspaceOrPlanner: string | Planner,
    maybePlanner?: Planner
  ): Promise<Task | RunReport> {
    if (typeof workspaceOrPlanner === 'string' && maybePlanner) {
      return this.runTaskV2(objective, workspaceOrPlanner, maybePlanner);
    }

    return this.runLegacyTask(
      objective,
      workspaceOrPlanner as Planner
    );
  }

  /**
   * Step 2 contract implementation.
   */
  private async runTaskV2(
    objective: string,
    workspace: string,
    planner: Planner
  ): Promise<Task> {
    this.workspace = workspace;

    const task = this.createTask(objective);
    task.status = 'running';
    task.phase = 'planning';
    task.updatedAt = new Date().toISOString();

    try {
      const plannedSteps = await planner(task);

      if (!Array.isArray(plannedSteps)) {
        throw new Error('planner returned an invalid plan');
      }

      task.steps = plannedSteps.map((step, index): TaskStep => ({
        id: `step_${index + 1}`,
        title: step.title,
        status: 'pending',
      }));

      task.updatedAt = new Date().toISOString();
      task.phase = 'implementation';

      for (let index = 0; index < plannedSteps.length; index++) {
        const planned = plannedSteps[index];
        const step = task.steps[index];

        step.status = 'active';
        step.startedAt = new Date().toISOString();
        task.updatedAt = step.startedAt;

        const result = await this.executeTool(
          planned.tool,
          planned.args,
          {
            workspace,
            taskId: task.id,
          }
        );

        if (!result.success) {
          step.status = 'failed';
          step.error = result.error ?? 'tool execution failed';
          step.completedAt = new Date().toISOString();

          task.status = 'failed';
          task.phase = 'review';
          task.updatedAt = step.completedAt;
          return task;
        }

        step.status = 'completed';
        step.result = result.data;
        step.completedAt = new Date().toISOString();
        task.updatedAt = step.completedAt;
      }

      task.status = 'completed';
      task.phase = 'complete';
      task.updatedAt = new Date().toISOString();
      return task;
    } catch (error) {
      task.status = 'failed';
      task.phase = 'review';
      task.updatedAt = new Date().toISOString();

      if (task.steps.length > 0) {
        const active = task.steps.find((step) => step.status === 'active');
        if (active) {
          active.status = 'failed';
          active.error = error instanceof Error ? error.message : String(error);
          active.completedAt = task.updatedAt;
        }
      }

      return task;
    }
  }

  /**
   * Existing local Step 2 tests use the original report-oriented API.
   */
  private async runLegacyTask(
    objective: string,
    planner: Planner
  ): Promise<RunReport> {
    const task = this.createTask(objective);
    const t0 = Date.now();
    const log = (message: string) =>
      console.log(`[orchestrator] ${task.id} ${message}`);

    log('phase=planning');

    let planned: Array<{
      title: string;
      tool: string;
      args: Record<string, unknown>;
    }>;

    try {
      planned = await planner(task);
    } catch (error) {
      return this.finish(task, t0, [], {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!Array.isArray(planned) || planned.length === 0) {
      return this.finish(task, t0, [], {
        ok: false,
        error: 'planner returned an empty or invalid plan',
      });
    }

    log(`phase=executing steps=${planned.length}`);

    const steps: StepReport[] = [];

    for (let index = 0; index < planned.length; index++) {
      const step = planned[index];
      const s0 = Date.now();

      const verify = this.extractVerify(step.args);

      const result = await this.executeTool(
        step.tool,
        this.removeInternalArgs(step.args),
        {
          workspace: this.workspace,
          taskId: task.id,
        }
      );

      if (!result.success) {
        const report = {
          id: `s${index + 1}`,
          tool: step.tool,
          ok: false,
          error: String(result.error),
          durationMs: Date.now() - s0,
        };

        steps.push(report);
        log(`step=${report.id} tool_failed error=${report.error}`);

        return this.finish(task, t0, steps, {
          ok: false,
          failedStepId: report.id,
          error: report.error,
        });
      }

      if (verify) {
        const vErr = this.verifyStep(verify);

        if (vErr) {
          const report = {
            id: `s${index + 1}`,
            tool: step.tool,
            ok: false,
            error: `verify failed: ${vErr}`,
            durationMs: Date.now() - s0,
          };

          steps.push(report);
          log(`step=${report.id} verify_failed error=${vErr}`);

          return this.finish(task, t0, steps, {
            ok: false,
            failedStepId: report.id,
            error: report.error,
          });
        }
      }

      steps.push({
        id: `s${index + 1}`,
        tool: step.tool,
        ok: true,
        durationMs: Date.now() - s0,
      });

      log(`step=s${index + 1} ok`);
    }

    log('phase=review ok=true');
    return this.finish(task, t0, steps, { ok: true });
  }

  run(objective: string, planner: Planner): Promise<RunReport> {
    return this.runTask(objective, planner);
  }

  private extractVerify(
    args: Record<string, unknown>
  ): VerifyCheck | undefined {
    const value = args.__orchestratorVerify;

    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      'path' in value
    ) {
      return value as VerifyCheck;
    }

    return undefined;
  }

  private removeInternalArgs(
    args: Record<string, unknown>
  ): Record<string, unknown> {
    const clean = { ...args };
    delete clean.__orchestratorVerify;
    return clean;
  }

  private verifyStep(check: VerifyCheck): string | undefined {
    try {
      const full = resolveInRoot(this.workspace, check.path);

      if (check.kind === 'file_exists') {
        readFileSync(full);
        return undefined;
      }

      const content = readFileSync(full, 'utf8');

      if (!content.includes(check.pattern)) {
        return `${check.path} does not contain expected pattern`;
      }

      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private finish(
    task: Task,
    t0: number,
    steps: StepReport[],
    outcome: {
      ok: boolean;
      failedStepId?: string;
      error?: string;
    }
  ): RunReport {
    const report: RunReport = {
      taskId: task.id,
      objective: task.objective,
      ok: outcome.ok,
      stepsCompleted: steps.filter((step) => step.ok).length,
      totalSteps: steps.length,
      steps,
      failedStepId: outcome.failedStepId,
      error: outcome.error,
      durationMs: Date.now() - t0,
      finishedAt: new Date().toISOString(),
    };

    console.log(
      `[orchestrator] ${task.id} report ok=${report.ok} ` +
        `steps=${report.stepsCompleted}/${report.steps.length}` +
        (report.error ? ` error="${report.error}"` : '')
    );

    return report;
  }
}
