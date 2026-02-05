export const FINAL_SCHEMA_VERSION = 3 as const;

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type FixEffort = 'xs' | 's' | 'm' | 'l';

export type FinalIssue = {
  issue_id: string;
  title: string;
  severity: Severity;
  category: string;

  // location
  file: string;
  line_range?: { start: number; end: number; side?: 'RIGHT' | 'LEFT' };

  // content
  why_this_matters: string;
  description: string;
  evidence: string; // MUST include exact snippet from diff
  suggestion: string;

  // scoring
  confidence: number; // 0..1
  risk: number; // 0..1
  fix_effort: FixEffort;

  tags?: string[];
};

export type FinalOutput = {
  schemaVersion: typeof FINAL_SCHEMA_VERSION;
  summary: {
    confirmedCount: number;
    uncertainCount: number;
    truncatedDiff: boolean;
  };
  issues: {
    confirmed: FinalIssue[];
    uncertain: FinalIssue[];
  };
  models: {
    reviewers: string[];
    judge: string;
    verifier: string;
    verifier2?: string;
    critic?: string;
    finalizer?: string;
  };
  usage?: Record<string, { inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
};
