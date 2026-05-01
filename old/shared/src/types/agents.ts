export interface AgentIdentity {
  id: string;
  orgId: string;
  name: string;
  provider: string;
  matchRules: AgentMatchRules;
  status: 'active' | 'paused';
}

export interface AgentMatchRules {
  committerEmails?: string[];
  botUsernames?: string[];
  prBodyPatterns?: string[];
}

export interface AgentBudget {
  id: string;
  orgId: string;
  scopeType: 'org' | 'repo' | 'agent';
  scopeId: string;
  period: 'daily' | 'weekly' | 'monthly';
  limitUnits: number;
  costPerUnit?: number;
  alertThresholdPct: number;
  enforcement: 'alert' | 'comment' | 'block-check';
}

export interface LeaderboardEntry {
  agentProvider: string;
  prsOpened: number;
  prsMerged: number;
  mergeRate: number;
  avgMergeConfidence: number;
  avgRevisionCycles: number;
  firstPassMergeRate: number;
  avgTimeToMerge: number;
  ciFirstPassRate: number;
  activityUnits: number;
  efficiencyRatio: number;
}
