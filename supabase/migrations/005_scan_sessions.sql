-- Scan sessions: one per counter per count round
create table scan_sessions (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references stock_takes(id),
  user_id text not null,
  user_name text not null,
  count_number smallint not null check (count_number in (1, 2)),
  zone text,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  device_info text
);

-- Scan records: individual barcode scans within a session
create table scan_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references scan_sessions(id),
  stock_take_id uuid not null references stock_takes(id),
  barcode text not null,
  quantity integer not null default 1,
  scanned_at timestamptz not null default now(),
  user_name text not null
);

-- Indexes for fast lookups
create index idx_scan_sessions_stock_take on scan_sessions(stock_take_id);
create index idx_scan_records_session on scan_records(session_id);
create index idx_scan_records_stock_take on scan_records(stock_take_id);
create index idx_scan_records_barcode on scan_records(stock_take_id, barcode);
