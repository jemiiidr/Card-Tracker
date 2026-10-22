-- Run this in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  set_name text,
  card_number text,
  category text not null default 'Pokémon',
  condition text,
  grade text,
  image_path text,
  market_value numeric(12,2) not null default 0,
  purchase_price numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null unique references public.cards(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  asking_price numeric(12,2) not null check (asking_price > 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  status text not null default 'active' check (status in ('active','reserved','sold','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete restrict,
  subtotal numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','paid','shipped','completed','cancelled','refunded')),
  payment_reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete restrict,
  card_name_snapshot text not null,
  unit_price numeric(12,2) not null check (unit_price > 0),
  quantity integer not null default 1 check (quantity > 0)
);

create index if not exists cards_owner_created_idx on public.cards(owner_id, created_at desc);
create index if not exists listings_active_created_idx on public.listings(status, created_at desc);
create index if not exists orders_buyer_created_idx on public.orders(buyer_id, created_at desc);

alter table public.cards enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- A portfolio is visible only to its owner.
create policy "owners manage their cards" on public.cards for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
-- Active public listings can be browsed by signed-in users; sellers manage their own.
create policy "active listings are public" on public.listings for select using (status = 'active' or auth.uid() = seller_id);
create policy "sellers manage listings" on public.listings for insert with check (auth.uid() = seller_id);
create policy "sellers update listings" on public.listings for update using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
create policy "sellers remove listings" on public.listings for delete using (auth.uid() = seller_id);
create policy "buyers view own orders" on public.orders for select using (auth.uid() = buyer_id);
create policy "buyers create own orders" on public.orders for insert with check (auth.uid() = buyer_id);
create policy "buyers view own order items" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid())
);

-- Store listing photos in a private bucket. Add signed URL reads in the app for owners.
insert into storage.buckets (id, name, public) values ('card-photos', 'card-photos', false) on conflict (id) do nothing;
create policy "owners upload card photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "owners read card photos" on storage.objects for select to authenticated using (
  bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "owners delete card photos" on storage.objects for delete to authenticated using (
  bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
