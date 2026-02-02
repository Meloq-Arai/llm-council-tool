export type FeedbackEvent = {
  kind: 'feedback';
  ts: string;
  suggestionId: string;
  accepted: boolean;
  note?: string;
};

export type StyleRule = {
  rule: string;
  weight: number; // simple score
  examples?: string[];
};
