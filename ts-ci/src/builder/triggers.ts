import type {
  PullRequestTriggerConfig,
  PushTriggerConfig,
  Trigger,
  WorkflowDispatchConfig,
} from '../types.js';

export const triggers = {
  push(config: PushTriggerConfig = {}): Trigger {
    return { event: 'push', config };
  },
  pullRequest(config: PullRequestTriggerConfig = {}): Trigger {
    return { event: 'pull_request', config };
  },
  workflowDispatch(config: WorkflowDispatchConfig = {}): Trigger {
    return { event: 'workflow_dispatch', config };
  },
  schedule(cron: string): Trigger {
    if (!cron || !cron.trim()) {
      throw new Error('triggers.schedule(): cron expression is required');
    }
    return { event: 'schedule', config: { cron } };
  },
  release(types?: string[]): Trigger {
    return { event: 'release', config: types ? { types } : undefined };
  },
  workflowRun(config: { workflows?: string[]; types?: string[] } = {}): Trigger {
    return { event: 'workflow_run', config };
  },
};
