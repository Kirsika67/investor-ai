-- Käivita see Supabase projektis: SQL Editor > New query > kleebi ja käivita

create table if not exists watchlist_items (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  note text,
  created_at timestamp with time zone default now()
);

create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  shares numeric not null,
  cost_basis numeric not null,
  created_at timestamp with time zone default now()
);

-- V1-s pole veel kasutajakontosid, seega lubame avaliku ligipääsu.
-- Kui lisad hiljem Supabase Auth'i (V2), asenda need reeglid auth.uid() kontrolliga.
alter table watchlist_items enable row level security;
alter table holdings enable row level security;

create policy "Public access v1" on watchlist_items for all using (true) with check (true);
create policy "Public access v1" on holdings for all using (true) with check (true);
