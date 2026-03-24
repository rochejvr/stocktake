// Recount threshold by tier
export const RECOUNT_THRESHOLDS: Record<'A' | 'B' | 'C', number> = {
  A: 0,    // 0% — every unit must be accounted for
  B: 3,    // 3% variance triggers recount
  C: 5,    // 5% variance triggers recount
};

// Absolute ZAR value threshold for recount (regardless of %)
export const RECOUNT_ZAR_THRESHOLD = 500;

// Round number detection — variances that are exact multiples of these
export const ROUND_NUMBER_MULTIPLES = [50, 100, 200, 500, 1000];

// Stock take reference format: ST-YYYY-QN
export function buildReference(year: number, quarter: number): string {
  return `ST-${year}-Q${quarter}`;
}

// Counting deadline: 12:00 on count day
export const DEFAULT_COUNT_DEADLINE_HOUR = 12;

// Recount deadline: 15:00 on count day
export const DEFAULT_RECOUNT_DEADLINE_HOUR = 15;

export const STORE_LABELS: Record<string, string> = {
  '001': 'Main Store',
  '002': 'Quarantine',
};

export const TIER_LABELS: Record<string, string> = {
  A: 'Tier A — High Value (0% tolerance)',
  B: 'Tier B — Mid Value (3% tolerance)',
  C: 'Tier C — Low Value (5% tolerance)',
};
