-- Idempotent — safe to run even if 002 was already applied

alter table bom_mappings
  add column if not exists component_description  text,
  add column if not exists missing_from_inventory boolean not null default false;

create table if not exists component_catalog (
  part_number      text primary key,
  description      text not null default '',
  active           boolean not null default true,   -- false = not seen in latest import
  last_seen_at     timestamptz not null default now(),
  last_updated_at  timestamptz not null default now()
);

-- If table was created by migration 002 without these columns, add them
alter table component_catalog
  add column if not exists active boolean not null default true,
  add column if not exists last_seen_at timestamptz not null default now();

-- ── sync_bom_descriptions() ───────────────────────────────────────────────────
-- Called after every Pastel import (from the app).
-- 1. Updates bom_mappings descriptions from component_catalog.
-- 2. Flags BOM components not in catalog as missing_from_inventory.

create or replace function sync_bom_descriptions()
returns jsonb language plpgsql as $$
declare
  updated_count int;
  missing_count int;
begin
  -- Update descriptions + clear missing flag for components found in catalog
  update bom_mappings bm
  set
    component_description  = cc.description,
    missing_from_inventory = false,
    updated_at             = now()
  from component_catalog cc
  where bm.component_code = cc.part_number
    and (bm.component_description is distinct from cc.description
         or bm.missing_from_inventory = true);

  get diagnostics updated_count = row_count;

  -- Flag BOM components not present in catalog at all
  update bom_mappings
  set
    missing_from_inventory = true,
    updated_at             = now()
  where component_code not in (select part_number from component_catalog)
    and missing_from_inventory = false;

  get diagnostics missing_count = row_count;

  return jsonb_build_object(
    'descriptions_updated', updated_count,
    'newly_missing', missing_count
  );
end;
$$;
