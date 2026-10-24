-- Secure COD storefront schema. Run once in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;
create policy "Admins can read own membership"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (char_length(name_ar) between 1 and 160),
  name_fr text not null check (char_length(name_fr) between 1 and 160),
  description_ar text not null default '' check (char_length(description_ar) <= 2000),
  description_fr text not null default '' check (char_length(description_fr) <= 2000),
  category text not null default '' check (char_length(category) <= 100),
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  image_url text check (image_url is null or char_length(image_url) <= 2000),
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_active_created_idx on public.products (is_active, created_at desc);
alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
create policy "Public can read active products"
  on public.products for select to anon, authenticated
  using (is_active = true or exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
create policy "Admins can insert products"
  on public.products for insert to authenticated
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
create policy "Admins can update products"
  on public.products for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
create policy "Admins can delete products"
  on public.products for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null unique,
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  phone text not null check (char_length(phone) between 7 and 25),
  address text not null check (char_length(address) between 5 and 500),
  city text not null check (char_length(city) between 2 and 100),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  status text not null default 'pending' check (status in ('pending','confirmed','shipped','delivered','cancelled')),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant select, update on public.orders to authenticated;
create policy "Admins can read orders"
  on public.orders for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
create policy "Admins can update orders"
  on public.orders for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
-- Intentionally NO anonymous INSERT policy on orders. Only the Edge Function can create orders.

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name_ar text not null,
  product_name_fr text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
alter table public.order_items enable row level security;
revoke all on public.order_items from anon, authenticated;
grant select on public.order_items to authenticated;
create policy "Admins can read order items"
  on public.order_items for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  old_status text,
  new_status text not null check (new_status in ('pending','confirmed','shipped','delivered','cancelled')),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table public.order_status_history enable row level security;
revoke all on public.order_status_history from anon, authenticated;
grant select on public.order_status_history to authenticated;
create policy "Admins can read order status history"
  on public.order_status_history for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.log_order_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_history(order_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists orders_status_history_trigger on public.orders;
create trigger orders_status_history_trigger after update of status on public.orders
for each row execute function public.log_order_status_change();

-- After creating your admin in Supabase Auth, run:
-- insert into public.admin_users (user_id) values ('YOUR_AUTH_USER_UUID');
-- Do this only from the SQL Editor as project owner; never expose this privilege to the browser.
