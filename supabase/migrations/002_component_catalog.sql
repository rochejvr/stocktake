-- ── Component Catalog ─────────────────────────────────────────────────────────
-- Permanent store of part number → description mappings.
-- Populated/updated from each Pastel inventory import.

create table if not exists component_catalog (
  part_number      text primary key,
  description      text not null default '',
  last_updated_at  timestamptz not null default now()
);

-- Add description + validation columns to bom_mappings
alter table bom_mappings
  add column if not exists component_description  text,
  add column if not exists missing_from_inventory boolean not null default false;
