// ── Users & Auth ─────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'finance' | 'production' | 'procurement' | 'readonly';

export type Department = 'Finance' | 'Production' | 'Procurement';

export const DEPARTMENTS: Department[] = ['Finance', 'Production', 'Procurement'];

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  department?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Map user department/role to the checklist Department */
export function getUserDepartment(user: User): Department | null {
  if (user.role === 'admin') return null; // admin can act on all
  const dept = (user.department || user.role).toLowerCase();
  if (dept.includes('finance')) return 'Finance';
  if (dept.includes('production')) return 'Production';
  if (dept.includes('procurement')) return 'Procurement';
  return null;
}

/** Check if user can act on a given department's items */
export function canActOnDepartment(user: User, department: Department): boolean {
  if (user.role === 'admin') return true;
  return getUserDepartment(user) === department;
}

// ── Stock Take ────────────────────────────────────────────────────────────────

export type StockTakeStatus =
  | 'setup'       // importing Pastel data, editing BOM
  | 'checklist'   // pre-count checklist sign-off
  | 'counting'    // counters scanning on mobile
  | 'recount'     // targeted recounts in progress
  | 'reviewing'   // supervisor reviewing, accepting/rejecting variances
  | 'complete';   // Pastel export generated, stock take closed

export interface StockTake {
  id: string;
  reference: string;           // ST-2026-Q1
  name: string;                // "Q1 2026 Stock Take"
  quarter: number;             // 1-4
  year: number;
  status: StockTakeStatus;
  counting_deadline: string;   // ISO datetime -- target 12:00
  recount_deadline: string;    // ISO datetime -- target 15:00
  frozen_at: string | null;
  frozen_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
}

// ── Checklist ─────────────────────────────────────────────────────────────────

export type ChecklistPhase = 'pre' | 'during' | 'post';

export const PHASE_LABELS: Record<ChecklistPhase, string> = {
  pre: 'Pre-Stock Take',
  during: 'Stock Take',
  post: 'Post-Stock Take',
};

export interface ChecklistItem {
  id: string;
  stock_take_id: string;
  phase: ChecklistPhase;
  department: Department;
  sort_order: number;
  item_text: string;
  completed_by: string | null;    // user name
  completed_at: string | null;
  notes: string | null;
}

export type ObservationStatus = 'open' | 'in_progress' | 'closed';

export interface ChecklistObservation {
  id: string;
  stock_take_id: string;
  checklist_item_id: string | null; // null = general observation
  phase: ChecklistPhase;
  department: Department;
  issue_description: string;
  corrective_action: string | null;
  preventive_action: string | null;
  status: ObservationStatus;
  reported_by: string;
  reported_at: string;
  closed_by: string | null;
  closed_at: string | null;
}

export interface ChecklistSignoff {
  id: string;
  stock_take_id: string;
  phase: ChecklistPhase;
  department: Department;
  signed_by: string;     // user name
  signed_by_id: string;  // user id
  signed_at: string;
}

// ── Pastel Inventory ──────────────────────────────────────────────────────────

export interface PastelInventory {
  id: string;
  stock_take_id: string;
  store_code: '001' | '002';       // 001 = Main, 002 = Quarantine
  part_number: string;
  description: string;
  pastel_qty: number;
  tier: 'A' | 'B' | 'C';          // recount threshold tier
  unit_cost: number | null;
  imported_at: string;
}

// ── BOM Mapping ───────────────────────────────────────────────────────────────

export interface BomMapping {
  id: string;
  wip_code: string;                    // e.g. WIP230002
  component_code: string;              // e.g. XM400-01B01-02
  qty_per_wip: number;
  notes: string | null;
  component_description: string | null; // from component_catalog
  missing_from_inventory: boolean;      // true if not found in last Pastel import
  created_at: string;
  updated_at: string;
}

// When scanning WIP code X, also credit component Y (component chains)
export interface ComponentChain {
  id: string;
  scanned_code: string;           // e.g. XM400-16B01-0401
  also_credit_code: string;       // e.g. XM400-16A01-0401
  credit_qty: number;             // qty to credit per scan (default 1)
  notes: string | null;
  created_at: string;
}

// ── Counters ─────────────────────────────────────────────────────────────────

export interface Counter {
  id: string;
  stock_take_id: string;
  name: string;
  pin: string;
  zone: string | null;
  is_active: boolean;
  created_at: string;
}

// ── Scanning ──────────────────────────────────────────────────────────────────

export type CountNumber = 1 | 2;

export interface ScanSession {
  id: string;
  stock_take_id: string;
  user_id: string;
  user_name: string;
  count_number: CountNumber;
  zone: string | null;            // optional zone assignment
  started_at: string;
  submitted_at: string | null;
  device_info: string | null;
}

export interface ScanRecord {
  id: string;
  session_id: string;
  stock_take_id: string;
  barcode: string;                // scanned barcode (= part number)
  quantity: number;
  scanned_at: string;
  user_name: string;
}

// ── Count Results ─────────────────────────────────────────────────────────────

export interface CountResult {
  id: string;
  stock_take_id: string;
  part_number: string;
  description: string;
  store_code: '001' | '002';
  tier: 'A' | 'B' | 'C';
  unit_cost: number | null;
  pastel_qty: number;
  count1_qty: number | null;
  count1_direct_qty: number | null;
  count1_wip_qty: number | null;
  count2_qty: number | null;
  count2_direct_qty: number | null;
  count2_wip_qty: number | null;
  count1_external_qty: number | null;
  count2_external_qty: number | null;
  accepted_qty: number | null;    // which count qty was accepted
  variance_qty: number | null;    // accepted_qty - pastel_qty
  variance_pct: number | null;    // variance_qty / pastel_qty * 100
  recount_flagged: boolean;
  recount_reasons: string[];
  deviation_accepted: boolean | null;
  accepted_by: string | null;
  accepted_at: string | null;
  prev_stock_take_qty: number | null;
  prev_variance_pct: number | null;
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export interface StockTakeStats {
  totalParts: number;
  countedParts: number;
  activeSessions: number;
  submittedSessions: number;
  flaggedForRecount: number;
  overallVariancePct: number | null;
}

// ── Recount flags ─────────────────────────────────────────────────────────────

export type RecountReason =
  | 'variance_exceeds_threshold'
  | 'round_number_variance'
  | 'zero_count_with_pastel_balance'
  | 'significant_change_vs_prior'
  | 'manual_supervisor_flag';
