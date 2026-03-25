-- ============================================================================
-- Migration 004: Checklist Rework — phases, departments, observations, signoffs
-- ============================================================================

-- ── Drop the old checklist_items and recreate with correct phases ────────────
-- The original had phases '48h','24h','day_of' which don't match the real form.
-- New phases: 'pre' (Pre-Stock Take), 'during' (Stock Take), 'post' (Post-Stock Take)

DROP TABLE IF EXISTS checklist_items CASCADE;

CREATE TABLE checklist_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id   uuid NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  phase           text NOT NULL CHECK (phase IN ('pre','during','post')),
  department      text NOT NULL CHECK (department IN ('Finance','Production','Procurement')),
  sort_order      int NOT NULL DEFAULT 0,
  item_text       text NOT NULL,
  completed_by    text,             -- user full name
  completed_by_id uuid,             -- user id (from Supabase auth)
  completed_at    timestamptz,
  notes           text
);

CREATE INDEX idx_checklist_items_stock_take ON checklist_items(stock_take_id);

-- ── Checklist Observations (mini-CAPA) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS checklist_observations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id       uuid NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  checklist_item_id   uuid REFERENCES checklist_items(id) ON DELETE SET NULL,
  phase               text NOT NULL CHECK (phase IN ('pre','during','post')),
  department          text NOT NULL CHECK (department IN ('Finance','Production','Procurement')),
  issue_description   text NOT NULL,
  corrective_action   text,         -- immediate fix
  preventive_action   text,         -- future prevention
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  reported_by         text NOT NULL, -- user full name
  reported_by_id      uuid,          -- user id
  reported_at         timestamptz NOT NULL DEFAULT now(),
  closed_by           text,
  closed_by_id        uuid,
  closed_at           timestamptz
);

CREATE INDEX idx_observations_stock_take ON checklist_observations(stock_take_id);

-- ── Department Signoffs (per phase per department) ──────────────────────────

CREATE TABLE IF NOT EXISTS checklist_signoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id   uuid NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  phase           text NOT NULL CHECK (phase IN ('pre','during','post')),
  department      text NOT NULL CHECK (department IN ('Finance','Production','Procurement')),
  signed_by       text NOT NULL,      -- user full name
  signed_by_id    uuid,               -- user id (nullable until auth added)
  signed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stock_take_id, phase, department)
);

-- ============================================================================
-- Seed function: auto-populate checklist items for a new stock take
-- Called from the application when creating/advancing a stock take
-- ============================================================================

CREATE OR REPLACE FUNCTION seed_checklist_items(p_stock_take_id uuid)
RETURNS int AS $$
DECLARE
  inserted int := 0;
BEGIN
  -- Only seed if no items exist yet for this stock take
  IF EXISTS (SELECT 1 FROM checklist_items WHERE stock_take_id = p_stock_take_id) THEN
    RETURN 0;
  END IF;

  -- ── Pre-Stock Take ──────────────────────────────────────────────────────
  INSERT INTO checklist_items (stock_take_id, phase, department, sort_order, item_text) VALUES
    (p_stock_take_id, 'pre', 'Finance',     1,  'Ensure all manufacturing has been completed in Pastel'),
    (p_stock_take_id, 'pre', 'Finance',     2,  'Ensure all invoicing is up to date'),
    (p_stock_take_id, 'pre', 'Procurement', 3,  'Ensure all scrapping forms are complete'),
    (p_stock_take_id, 'pre', 'Procurement', 4,  'Ensure all scrapping journals have been processed'),
    (p_stock_take_id, 'pre', 'Finance',     5,  'Prepare the Production KPI for the stock count'),
    (p_stock_take_id, 'pre', 'Production',  6,  'Verify all WIP codes in Production KPI'),
    (p_stock_take_id, 'pre', 'Production',  7,  'Verify each WIP bin: correct label, mapping, lot assignment. Place blue sticker on pass.'),
    (p_stock_take_id, 'pre', 'Procurement', 8,  'Verify each Store bin: correct label, version, lot assignment, stock cards. Place blue sticker on pass.'),
    (p_stock_take_id, 'pre', 'Procurement', 9,  'Finalize warehouse list and quantities'),
    (p_stock_take_id, 'pre', 'Production',  10, 'Confirm that all stock movements have been halted during the stock take period'),
    (p_stock_take_id, 'pre', 'Finance',     11, 'Confirm members of the stock take team');

  -- ── Stock Take (during) ─────────────────────────────────────────────────
  INSERT INTO checklist_items (stock_take_id, phase, department, sort_order, item_text) VALUES
    (p_stock_take_id, 'during', 'Production',  1, 'Assign stock take team members to specific areas'),
    (p_stock_take_id, 'during', 'Procurement', 2, 'All bins in the Store have been labeled after counted'),
    (p_stock_take_id, 'during', 'Production',  3, 'All bins in Production have been labeled after counted'),
    (p_stock_take_id, 'during', 'Finance',     4, 'Confirm the recount variance level'),
    (p_stock_take_id, 'during', 'Finance',     5, 'Pre-qualify the count: ensure all figures entered on Production KPI, new codes added, variances above threshold sent for recount'),
    (p_stock_take_id, 'during', 'Production',  6, 'Production is released from Stock HOLD'),
    (p_stock_take_id, 'during', 'Finance',     7, 'Cross-check counts with Pastel records'),
    (p_stock_take_id, 'during', 'Finance',     8, 'Final Stock Variance achieved');

  -- ── Post-Stock Take ─────────────────────────────────────────────────────
  INSERT INTO checklist_items (stock_take_id, phase, department, sort_order, item_text) VALUES
    (p_stock_take_id, 'post', 'Finance',     1, 'Complete any follow-up actions'),
    (p_stock_take_id, 'post', 'Production',  2, 'Remove all Stock Take stickers from bins in Production'),
    (p_stock_take_id, 'post', 'Procurement', 3, 'Remove all Stock Take stickers from bins in Store'),
    (p_stock_take_id, 'post', 'Finance',     4, 'Update Stock Variance KPI on Perdoo'),
    (p_stock_take_id, 'post', 'Finance',     5, 'Update Stock journals in Pastel'),
    (p_stock_take_id, 'post', 'Finance',     6, 'Archive Production KPI file with date and "Stock Take" indicated'),
    (p_stock_take_id, 'post', 'Finance',     7, 'Schedule next stock take date');

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$ LANGUAGE plpgsql;
