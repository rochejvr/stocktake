-- Add store_code to scan_records (defaults to Main Store)
ALTER TABLE scan_records ADD COLUMN store_code text NOT NULL DEFAULT '001';
