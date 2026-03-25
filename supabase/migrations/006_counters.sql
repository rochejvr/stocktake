-- Counters: registered people who can scan during a stock take
create table counters (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references stock_takes(id),
  name text not null,
  pin char(4) not null,
  zone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(stock_take_id, pin),
  unique(stock_take_id, name)
);

create index idx_counters_stock_take on counters(stock_take_id);
