-- ============================================================================
-- Stock Take App — Initial Schema
-- ============================================================================

-- ── Users ────────────────────────────────────────────────────────────────────
create table if not exists stocktake_users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null check (role in ('admin', 'supervisor', 'counter')),
  pin_hash    text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Stock Takes ───────────────────────────────────────────────────────────────
create table if not exists stock_takes (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,        -- ST-2026-Q1
  name                text not null,
  quarter             int not null check (quarter between 1 and 4),
  year                int not null,
  status              text not null default 'setup'
                        check (status in ('setup','checklist','counting','recount','reviewing','complete')),
  counting_deadline   timestamptz not null,
  recount_deadline    timestamptz not null,
  frozen_at           timestamptz,
  frozen_by           text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_by          text not null,
  created_at          timestamptz not null default now()
);

-- ── Checklist Items ───────────────────────────────────────────────────────────
create table if not exists checklist_items (
  id              uuid primary key default gen_random_uuid(),
  stock_take_id   uuid not null references stock_takes(id) on delete cascade,
  phase           text not null check (phase in ('48h','24h','day_of')),
  sort_order      int not null default 0,
  item_text       text not null,
  completed_by    text,
  completed_at    timestamptz,
  notes           text
);

-- ── Pastel Inventory ──────────────────────────────────────────────────────────
create table if not exists pastel_inventory (
  id              uuid primary key default gen_random_uuid(),
  stock_take_id   uuid not null references stock_takes(id) on delete cascade,
  store_code      text not null check (store_code in ('001','002')),
  part_number     text not null,
  description     text not null default '',
  pastel_qty      numeric not null default 0,
  tier            text not null default 'C' check (tier in ('A','B','C')),
  unit_cost       numeric,
  imported_at     timestamptz not null default now(),
  unique (stock_take_id, store_code, part_number)
);

-- ── BOM Mappings ──────────────────────────────────────────────────────────────
-- WIP code → component codes with qty per WIP unit
create table if not exists bom_mappings (
  id              uuid primary key default gen_random_uuid(),
  wip_code        text not null,
  component_code  text not null,
  qty_per_wip     numeric not null default 1,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (wip_code, component_code)
);

-- Component chains: scanning code X also credits code Y
create table if not exists component_chains (
  id                uuid primary key default gen_random_uuid(),
  scanned_code      text not null,
  also_credit_code  text not null,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (scanned_code, also_credit_code)
);

-- ── Scan Sessions ─────────────────────────────────────────────────────────────
create table if not exists scan_sessions (
  id              uuid primary key default gen_random_uuid(),
  stock_take_id   uuid not null references stock_takes(id) on delete cascade,
  user_id         uuid references stocktake_users(id),
  user_name       text not null,
  count_number    int not null default 1 check (count_number in (1,2)),
  zone            text,
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  device_info     text
);

-- ── Scan Records ──────────────────────────────────────────────────────────────
create table if not exists scan_records (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references scan_sessions(id) on delete cascade,
  stock_take_id   uuid not null references stock_takes(id) on delete cascade,
  barcode         text not null,
  quantity        numeric not null,
  scanned_at      timestamptz not null default now(),
  user_name       text not null
);

create index if not exists idx_scan_records_stock_take on scan_records(stock_take_id);
create index if not exists idx_scan_records_barcode    on scan_records(stock_take_id, barcode);

-- ── Count Results ─────────────────────────────────────────────────────────────
create table if not exists count_results (
  id                    uuid primary key default gen_random_uuid(),
  stock_take_id         uuid not null references stock_takes(id) on delete cascade,
  part_number           text not null,
  description           text not null default '',
  store_code            text not null,
  tier                  text not null default 'C',
  unit_cost             numeric,
  pastel_qty            numeric not null default 0,
  count1_qty            numeric,
  count2_qty            numeric,
  accepted_qty          numeric,
  variance_qty          numeric,
  variance_pct          numeric,
  recount_flagged       boolean not null default false,
  recount_reasons       text[] not null default '{}',
  deviation_accepted    boolean,
  accepted_by           text,
  accepted_at           timestamptz,
  prev_stock_take_qty   numeric,
  prev_variance_pct     numeric,
  unique (stock_take_id, part_number, store_code)
);

-- ── Supervisor Notifications ──────────────────────────────────────────────────
create table if not exists supervisor_notifications (
  id              uuid primary key default gen_random_uuid(),
  stock_take_id   uuid not null references stock_takes(id) on delete cascade,
  session_id      uuid references scan_sessions(id),
  target_user     text not null,
  message         text not null,
  part_numbers    text[] not null default '{}',
  sent_at         timestamptz not null default now(),
  acknowledged_at timestamptz
);

-- ── Default checklist template ────────────────────────────────────────────────
-- Populated per stock take via the app, but template rows are inserted on create
