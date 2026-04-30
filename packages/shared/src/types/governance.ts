export interface MergeConfidenceScore {
  overall: number;
  testHealth: number;
  scopeContainment: number;
  reviewDepth: number;
  agentTrust: number;
  sizeDiscipline: number;
  provenanceQuality: number;
  weights: MergeConfidenceWeights;
  isAgentAuthored: boolean;
  version: number;
  computedAt: number;
}

export interface MergeConfidenceWeights {
  testHealth: number;
  scopeContainment: number;
  reviewDepth: number;
  agentTrust: number;
  sizeDiscipline: number;
  provenanceQuality: number;
}

export const DEFAULT_WEIGHTS: MergeConfidenceWeights = {
  testHealth: 25,
  scopeContainment: 20,
  reviewDepth: 20,
  agentTrust: 15,
  sizeDiscipline: 10,
  provenanceQuality: 10,
};

export const DEFAULT_SIZE_THRESHOLDS = {
  excellent: 200,
  good: 500,
  acceptable: 1000,
} as const;

export interface SizeThresholds {
  excellent: number;
  good: number;
  acceptable: number;
}

export interface ProvenanceEvent {
  type: string;
  actor: string;
  actorType: 'agent' | 'human' | 'system';
  data: Record<string, unknown>;
  timestamp: number;
}

export interface GovernanceConfig {
  confidenceWeights?: Partial<MergeConfidenceWeights>;
  confidenceMinimum?: number;
  sizeThresholds?: SizeThresholds;
  scopeMappings?: Record<string, string[]>;
  applyToHumanPrs?: boolean;
  detectionEnabled?: boolean;
  detectionLabelFormat?: string;
  detectionPostComment?: boolean;
  provenanceEnabled?: boolean;
  exemptBots?: string[];
}

export interface AgentDetectionResult {
  detected: boolean;
  provider: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}
