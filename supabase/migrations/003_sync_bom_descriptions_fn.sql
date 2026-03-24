-- Run migration 002 first if not already done
alter table bom_mappings
  add column if not exists component_description  text,
  add column if not exists missing_from_inventory boolean not null default false;

create table if not exists component_catalog (
  part_number      text primary key,
  description      text not null default '',
  last_updated_at  timestamptz not null default now()
);

-- ── sync_bom_descriptions() ───────────────────────────────────────────────────
-- Updates bom_mappings descriptions and missing flags from component_catalog.
-- Called after every Pastel inventory import. Runs server-side in one shot.

create or replace function sync_bom_descriptions()
returns jsonb language plpgsql as $$
declare
  updated_count int;
  missing_count int;
begin
  -- Set description + clear missing flag for components found in catalog
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

  -- Flag components not present in catalog
  update bom_mappings
  set
    missing_from_inventory = true,
    updated_at             = now()
  where component_code not in (select part_number from component_catalog)
    and missing_from_inventory = false;

  get diagnostics missing_count = row_count;

  return jsonb_build_object(
    'updated', updated_count,
    'newly_missing', missing_count
  );
end;
$$;
