export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type Finding = {
  id: string;
  title: string;
  severity: Severity;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  message: string;
  suggestion?: string; // short code snippet or guidance
  confidence?: number; // 0..1
  sourceStage?: string;
};

export type StageOutput = {
  stageId: string;
  model: string;
  role: string;
  rawText: string;
  findings: Finding[];
  meta?: Record<string, unknown>;
  // reserved for cost tracking
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
};

export type CouncilResult = {
  version: 1;
  createdAt: string;
  repoLabel?: string;
  stages: StageOutput[];
  synthesized: {
    summaryMd: string;
    findings: Finding[];
    notes?: string;
  };
  budgets?: {
    maxFiles?: number;
    maxTotalChars?: number;
    maxCostUsd?: number;
  };
};
