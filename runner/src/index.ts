export { run } from './orchestrator.js';
export { plan } from './planner.js';
export { runJobs } from './scheduler.js';
export { HostBackend } from './backends/host.js';
export { ContainerBackend } from './backends/container.js';
export { evalBody, evalCondition, evalExpr } from './expression.js';
export { expandMatrix, parseMatrix, cellId } from './matrix.js';
export type {
  Backend,
  BackendName,
  ExpressionContext,
  JobResult,
  JobSession,
  JobStatus,
  PlannedJob,
  PlannedStep,
  RunOptions,
  RunResult,
  StepResult,
  StepStatus,
} from './types.js';
