-- Migration 013: External supplier stock tracking
-- Adds source column to scan_records to distinguish physical scans from external stock entries
-- Adds external qty breakdown columns to count_results

ALTER TABLE scan_records ADD COLUMN source text NOT NULL DEFAULT 'physical'
  CHECK (source IN ('physical', 'external'));

ALTER TABLE count_results ADD COLUMN count1_external_qty numeric;
ALTER TABLE count_results ADD COLUMN count2_external_qty numeric;
