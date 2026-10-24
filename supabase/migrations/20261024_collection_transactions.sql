-- Track card acquisition and sale details on each private collection entry.
alter table public.collection_items
  add column if not exists transaction_type text not null default 'bought'
    check (transaction_type in ('bought','sold')),
  add column if not exists acquired_date date,
  add column if not exists sold_at date,
  add column if not exists vendor_description text not null default '',
  add column if not exists sale_price numeric(12,2)
    check (sale_price is null or sale_price >= 0);

update public.collection_items
set acquired_date = coalesce(acquired_date, acquired_at::date, current_date)
where acquired_date is null;

alter table public.collection_items alter column acquired_date set default current_date;
alter table public.collection_items alter column acquired_date set not null;

notify pgrst, 'reload schema';
