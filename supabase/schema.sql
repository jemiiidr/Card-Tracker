-- Cardhaus MVP schema. Run in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

-- Preserve tables created by the earlier demo schema without reusing incompatible table shapes.
do $$
begin
  if to_regclass('public.listings') is not null and not exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='inventory_item_id'
  ) and to_regclass('public.listings_legacy') is null then
    alter table public.listings rename to listings_legacy;
  end if;
  if to_regclass('public.orders') is not null and not exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='buyer_name'
  ) and to_regclass('public.orders_legacy') is null then
    alter table public.orders rename to orders_legacy;
  end if;
  if to_regclass('public.order_items') is not null and not exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='unit_cost_snapshot'
  ) and to_regclass('public.order_items_legacy') is null then
    alter table public.order_items rename to order_items_legacy;
  end if;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Collector',
  is_store_owner boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.card_catalog (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null unique,
  name text not null,
  set_name text not null,
  card_number text not null,
  game text not null,
  rarity text,
  image_url text,
  market_value numeric(12,2),
  price_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.card_catalog(id) on delete restrict,
  quantity integer not null default 1 check (quantity >= 0),
  condition text not null default 'Near Mint',
  grade text not null default 'Ungraded',
  purchase_price numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  acquired_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  collection_item_id uuid references public.collection_items(id) on delete set null,
  description text not null check (char_length(description) between 1 and 160),
  category text not null check (category in ('Card purchase','Grading','Supplies','Shipping','Fees','Other')),
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.card_catalog(id) on delete restrict,
  inventory_item_id uuid references public.collection_items(id) on delete set null,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  asking_price numeric(12,2) not null check (asking_price > 0),
  quantity integer not null check (quantity > 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  discount_min_quantity integer not null default 1 check (discount_min_quantity > 0),
  discount_starts_at timestamptz,
  discount_ends_at timestamptz,
  status text not null default 'active' check (status in ('active','sold','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_ends_at is null or discount_starts_at is null or discount_ends_at > discount_starts_at)
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  buyer_name text not null,
  buyer_email text not null,
  shipping_address text not null,
  subtotal numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  card_id uuid references public.card_catalog(id) on delete set null,
  card_name_snapshot text not null,
  set_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost_snapshot numeric(12,2) check (unit_cost_snapshot is null or unit_cost_snapshot >= 0)
);
create table if not exists public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  snapshot_date date not null default (now() at time zone 'utc')::date,
  market_value numeric(14,2) not null default 0,
  cost_basis numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(owner_id,snapshot_date)
);

create index if not exists collection_owner_created_idx on public.collection_items(owner_id, created_at desc);
create index if not exists collection_card_idx on public.collection_items(card_id);
create index if not exists expenses_owner_date_idx on public.expenses(owner_id, expense_date desc, created_at desc);
create index if not exists cardhaus_listings_active_created_idx on public.listings(status, created_at desc);
create unique index if not exists listing_inventory_item_unique on public.listings(inventory_item_id) where inventory_item_id is not null;
create index if not exists cardhaus_orders_buyer_created_idx on public.orders(buyer_id, created_at desc);
create index if not exists cardhaus_orders_status_created_idx on public.orders(status, created_at desc);

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'Collector'))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_cardhaus on auth.users;
create trigger on_auth_user_created_cardhaus after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();
insert into public.profiles(id,display_name)
select id, coalesce(nullif(raw_user_meta_data->>'display_name',''), split_part(email,'@',1), 'Collector')
from auth.users on conflict (id) do nothing;

create or replace function public.prevent_store_owner_self_promotion()
returns trigger language plpgsql as $$
begin
  if new.is_store_owner is distinct from old.is_store_owner
     and current_user not in ('postgres','service_role')
     and coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Store owner access is managed by the shop administrator.';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_store_owner_flag on public.profiles;
create trigger protect_store_owner_flag before update on public.profiles
for each row execute procedure public.prevent_store_owner_self_promotion();

alter table public.profiles enable row level security;
alter table public.card_catalog enable row level security;
alter table public.collection_items enable row level security;
alter table public.expenses enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.portfolio_snapshots enable row level security;

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "catalog is readable" on public.card_catalog;
create policy "catalog is readable" on public.card_catalog for select to authenticated using (true);
drop policy if exists "store owner manages catalog" on public.card_catalog;
create policy "store owner manages catalog" on public.card_catalog for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner));
drop policy if exists "portfolio is private to owner" on public.collection_items;
create policy "portfolio is private to owner" on public.collection_items for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "users manage own expenses" on public.expenses;
create policy "users manage own expenses" on public.expenses for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "active listings are visible" on public.listings;
create policy "active listings are visible" on public.listings for select to authenticated
using (status = 'active' or seller_id = auth.uid());
drop policy if exists "store owner manages listings" on public.listings;
create policy "store owner manages listings" on public.listings for all to authenticated
using (seller_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner))
with check (seller_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner)
  and (inventory_item_id is null or exists (select 1 from public.collection_items ci where ci.id = inventory_item_id and ci.owner_id = auth.uid() and ci.card_id = public.listings.card_id)));
drop policy if exists "buyers and shop owner read orders" on public.orders;
create policy "buyers and shop owner read orders" on public.orders for select to authenticated
using (buyer_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner));
drop policy if exists "buyers and shop owner read order items" on public.order_items;
create policy "buyers and shop owner read order items" on public.order_items for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner))));
drop policy if exists "users manage own portfolio snapshots" on public.portfolio_snapshots;
create policy "users manage own portfolio snapshots" on public.portfolio_snapshots for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Checkout trusts prices, discounts, and available inventory from the database.
create or replace function public.place_order(p_items jsonb, p_buyer_name text, p_buyer_email text, p_shipping_address text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_buyer uuid := auth.uid();
  v_order uuid;
  v_line jsonb;
  v_listing public.listings%rowtype;
  v_card public.card_catalog%rowtype;
  v_item public.collection_items%rowtype;
  v_qty integer;
  v_unit_price numeric(12,2);
  v_unit_cost numeric(12,2);
  v_subtotal numeric(12,2) := 0;
begin
  if v_buyer is null then raise exception 'Sign in to place an order.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'Cart must contain between 1 and 30 listings.';
  end if;
  if length(trim(p_buyer_name)) < 1 or length(trim(p_buyer_email)) < 3 or length(trim(p_shipping_address)) < 5 then
    raise exception 'Enter your name, email, and shipping address.';
  end if;
  insert into public.orders(buyer_id,buyer_name,buyer_email,shipping_address)
  values (v_buyer,trim(p_buyer_name),trim(p_buyer_email),trim(p_shipping_address)) returning id into v_order;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_qty := greatest(0, (v_line->>'quantity')::integer);
    if v_qty < 1 then raise exception 'Cart quantity must be at least one.'; end if;
    select * into v_listing from public.listings where id = (v_line->>'listing_id')::uuid and status = 'active' for update;
    if not found or v_listing.quantity < v_qty then raise exception 'A listing is no longer available in that quantity.'; end if;
    if v_listing.seller_id = v_buyer then raise exception 'You cannot purchase your own listing.'; end if;
    select * into v_card from public.card_catalog where id = v_listing.card_id;
    v_unit_price := v_listing.asking_price;
    if v_listing.discount_percent > 0 and v_qty >= v_listing.discount_min_quantity
       and (v_listing.discount_starts_at is null or v_listing.discount_starts_at <= now())
       and (v_listing.discount_ends_at is null or v_listing.discount_ends_at > now()) then
      v_unit_price := round(v_listing.asking_price * (1 - v_listing.discount_percent / 100), 2);
    end if;
    v_unit_cost := null;
    if v_listing.inventory_item_id is not null then
      select * into v_item from public.collection_items where id = v_listing.inventory_item_id for update;
      if found then v_unit_cost := v_item.purchase_price; end if;
    end if;
    insert into public.order_items(order_id,listing_id,card_id,card_name_snapshot,set_snapshot,quantity,unit_price,unit_cost_snapshot)
    values (v_order,v_listing.id,v_card.id,v_card.name,v_card.set_name,v_qty,v_unit_price,v_unit_cost);
    update public.listings set quantity = quantity - v_qty, status = case when quantity - v_qty = 0 then 'sold' else status end, updated_at = now()
    where id = v_listing.id;
    if v_listing.inventory_item_id is not null then
      update public.collection_items set quantity = quantity - v_qty where id = v_listing.inventory_item_id;
    end if;
    v_subtotal := v_subtotal + v_unit_price * v_qty;
  end loop;
  update public.orders set subtotal = v_subtotal where id = v_order;
  return v_order;
end;
$$;
revoke all on function public.place_order(jsonb,text,text,text) from public, anon;
grant execute on function public.place_order(jsonb,text,text,text) to authenticated;

create or replace function public.complete_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner) then
    raise exception 'Only the store owner can complete orders.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'pending' then raise exception 'Order is not pending.'; end if;
  update public.orders set status = 'completed', updated_at = now() where id = p_order_id;
  insert into public.collection_items(owner_id,card_id,quantity,condition,grade,purchase_price)
  select v_order.buyer_id, oi.card_id, oi.quantity, 'Near Mint', 'Ungraded', oi.unit_price
  from public.order_items oi where oi.order_id = p_order_id and oi.card_id is not null;
end;
$$;
revoke all on function public.complete_order(uuid) from public, anon;
grant execute on function public.complete_order(uuid) to authenticated;

create or replace function public.cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_item record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'pending' then raise exception 'Order is not pending.'; end if;
  if auth.uid() <> v_order.buyer_id and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_store_owner) then
    raise exception 'Not allowed to cancel this order.';
  end if;
  for v_item in select listing_id,quantity from public.order_items where order_id = p_order_id loop
    if v_item.listing_id is not null then
      update public.listings set quantity = quantity + v_item.quantity, status = 'active', updated_at = now() where id = v_item.listing_id;
      update public.collection_items set quantity = quantity + v_item.quantity where id = (select inventory_item_id from public.listings where id = v_item.listing_id);
    end if;
  end loop;
  update public.orders set status = 'cancelled', updated_at = now() where id = p_order_id;
end;
$$;
revoke all on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;

insert into storage.buckets (id,name,public) values ('card-photos','card-photos',false) on conflict (id) do nothing;
drop policy if exists "users manage their card photos" on storage.objects;
create policy "users manage their card photos" on storage.objects for all to authenticated
using (bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Refresh PostgREST after the tables and policies are created.
notify pgrst, 'reload schema';

-- After signing up, grant the single-store owner role in SQL Editor:
-- update public.profiles set is_store_owner = true where id = 'AUTH_USER_UUID';
