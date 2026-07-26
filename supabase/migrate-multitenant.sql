-- Käivita olemasolevas V1 projektis (kui tabelid juba olemas ilma user_id-ta).
-- HOIATUS: vanad jagatud read kustutatakse, sest neil pole omanikku.

-- 1) Lisa user_id veerud (kui puuduvad)
alter table watchlist_items add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table holdings add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2) Eemalda vanad jagatud / omanikuta read
delete from watchlist_items where user_id is null;
delete from holdings where user_id is null;

-- 3) Muuda user_id kohustuslikuks
alter table watchlist_items alter column user_id set not null;
alter table holdings alter column user_id set not null;

-- 4) Chat / project tabelid
create table if not exists ai_chats (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Uus vestlus',
  messages jsonb not null default '[]'::jsonb,
  pinned boolean not null default false,
  updated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone default now()
);

create table if not exists ai_projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamp with time zone default now()
);

create index if not exists watchlist_items_user_id_idx on watchlist_items(user_id);
create index if not exists holdings_user_id_idx on holdings(user_id);
create index if not exists ai_chats_user_id_updated_idx on ai_chats(user_id, updated_at desc);
create index if not exists ai_projects_user_id_idx on ai_projects(user_id);

alter table watchlist_items enable row level security;
alter table holdings enable row level security;
alter table ai_chats enable row level security;
alter table ai_projects enable row level security;

drop policy if exists "Public access v1" on watchlist_items;
drop policy if exists "Public access v1" on holdings;
drop policy if exists "Users manage own watchlist" on watchlist_items;
drop policy if exists "Users manage own holdings" on holdings;
drop policy if exists "Users manage own chats" on ai_chats;
drop policy if exists "Users manage own projects" on ai_projects;

create policy "Users manage own watchlist" on watchlist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own holdings" on holdings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own chats" on ai_chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own projects" on ai_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
