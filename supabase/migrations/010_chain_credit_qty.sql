-- Add credit_qty to component_chains (default 1)
-- When scanning an item, credit the linked item with this quantity instead of the scanned qty.
-- Example: scan electrode pack → credit 1 (not 10) because UOM is "pack"
ALTER TABLE component_chains ADD COLUMN IF NOT EXISTS credit_qty numeric NOT NULL DEFAULT 1;
