// LAT-172: RunResult type definition
// Implements: status, evidence, agentType, timestamp, error, timing fields
export interface RunResult {
  status: 'success' | 'failed' | 'pending' | 'cancelled';
  evidence: Record<string, unknown>;
  agentType: string;
  timestamp: string;
  error?: string;
  timing?: { start: string; end: string; durationMs: number };
}
