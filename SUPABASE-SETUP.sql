-- Field Manifest · Crew Sync schema
-- Run this in Supabase SQL Editor

-- Trips table — one row per shared trip
create table trips (
  id          text primary key,           -- 6-char code e.g. "SIMPSON"
  name        text not null,
  created_at  timestamptz default now()
);

-- Claims table — one row per claimed item
create table claims (
  id          uuid primary key default gen_random_uuid(),
  trip_id     text references trips(id) on delete cascade,
  item_id     text not null,              -- e.g. "recovery_MaxTrax"
  item_name   text not null,              -- display name
  category    text not null,              -- category title
  claimed_by  text not null,              -- person's name
  claimed_at  timestamptz default now(),
  unique(trip_id, item_id)               -- one claim per item per trip
);

-- Enable Row Level Security but allow all for now (no auth needed)
alter table trips  enable row level security;
alter table claims enable row level security;

create policy "public read trips"  on trips  for select using (true);
create policy "public insert trips" on trips for insert with check (true);
create policy "public read claims"  on claims for select using (true);
create policy "public insert claims" on claims for insert with check (true);
create policy "public update claims" on claims for update using (true);
create policy "public delete claims" on claims for delete using (true);

-- Enable realtime on claims so all crew see updates instantly
alter publication supabase_realtime add table claims;
