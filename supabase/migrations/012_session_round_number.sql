-- Add round_number to scan_sessions to distinguish recount rounds
-- Count 1: round 1. Count 2: round 1. Recount of count 2: round 2, 3, etc.
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS round_number integer NOT NULL DEFAULT 1;

-- Add current_round to stock_takes to track which round we're on
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS current_round integer NOT NULL DEFAULT 1;
