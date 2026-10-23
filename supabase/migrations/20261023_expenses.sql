-- Add a private expense ledger for each authenticated Cardhaus account.
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

create index if not exists expenses_owner_date_idx on public.expenses(owner_id, expense_date desc, created_at desc);
alter table public.expenses enable row level security;
drop policy if exists "users manage own expenses" on public.expenses;
create policy "users manage own expenses" on public.expenses for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

notify pgrst, 'reload schema';
