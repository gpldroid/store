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
grant select on public.orders to authenticated;
grant update(status) on public.orders to authenticated;
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


-- Privacy-preserving fixed-hour rate limit. The Edge Function sends only a keyed hash of the source IP.
create table if not exists public.cod_order_rate_limits (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}
-- It locks products, recalculates prices, reserves stock, and writes order rows atomically.
create or replace function public.create_cod_order(
  p_order_reference text,
  p_customer_name text,
  p_phone text,
  p_address text,
  p_city text,
  p_country_code text,
  p_currency text,
  p_idempotency_key text,
  p_items jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $
declare
  item jsonb;
  product_row public.products%rowtype;
  item_product_id uuid;
  item_quantity integer;
  computed_subtotal numeric(12,2) := 0;
  computed_line_total numeric(12,2);
  created_order_id uuid;
  item_count integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_ITEMS';
  end if;

  for item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    item_count := item_count + 1;
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 or item_quantity > 99 then
      raise exception 'INVALID_QUANTITY';
    end if;

    select * into product_row
      from public.products
      where id = item_product_id
      for update;

    if not found or not product_row.is_active then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    if product_row.currency <> p_currency then
      raise exception 'CURRENCY_MISMATCH';
    end if;
    if product_row.stock < item_quantity then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    computed_line_total := round(product_row.price * item_quantity, 2);
    computed_subtotal := round(computed_subtotal + computed_line_total, 2);
  end loop;

  insert into public.orders (
    order_reference, customer_name, phone, address, city, country_code,
    currency, subtotal, shipping_amount, total_amount, status, idempotency_key
  ) values (
    p_order_reference, p_customer_name, p_phone, p_address, p_city, p_country_code,
    p_currency, computed_subtotal, 0, computed_subtotal, 'pending', p_idempotency_key
  )
  returning id into created_order_id;

  for item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;

    select * into product_row
      from public.products
      where id = item_product_id
      for update;

    update public.products
      set stock = stock - item_quantity
      where id = item_product_id and stock >= item_quantity and is_active = true;
    if not found then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    computed_line_total := round(product_row.price * item_quantity, 2);
    insert into public.order_items (
      order_id, product_id, product_name_ar, product_name_fr, quantity, unit_price, line_total
    ) values (
      created_order_id, product_row.id, product_row.name_ar, product_row.name_fr,
      item_quantity, product_row.price, computed_line_total
    );
  end loop;

  return p_order_reference;
end;
$;

revoke all on function public.create_cod_order(text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_cod_order(text,text,text,text,text,text,text,text,jsonb) to service_role;

-- After creating your admin in Supabase Auth, run:
-- insert into public.admin_users (user_id) values ('YOUR_AUTH_USER_UUID');
-- Do this only from the SQL Editor as project owner; never expose this privilege to the browser.
),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
alter table public.cod_order_rate_limits enable row level security;
revoke all on public.cod_order_rate_limits from public, anon, authenticated, service_role;

create or replace function public.consume_cod_order_rate_limit(p_fingerprint text, p_max_requests integer default 5)
returns boolean
language plpgsql
security definer
set search_path = ''
as $
declare
  current_window timestamptz := date_trunc('hour', now());
  new_count integer;
begin
  if p_fingerprint !~ '^[a-f0-9]{64}
-- It locks products, recalculates prices, reserves stock, and writes order rows atomically.
create or replace function public.create_cod_order(
  p_order_reference text,
  p_customer_name text,
  p_phone text,
  p_address text,
  p_city text,
  p_country_code text,
  p_currency text,
  p_idempotency_key text,
  p_items jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $
declare
  item jsonb;
  product_row public.products%rowtype;
  item_product_id uuid;
  item_quantity integer;
  computed_subtotal numeric(12,2) := 0;
  computed_line_total numeric(12,2);
  created_order_id uuid;
  item_count integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_ITEMS';
  end if;

  for item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    item_count := item_count + 1;
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 or item_quantity > 99 then
      raise exception 'INVALID_QUANTITY';
    end if;

    select * into product_row
      from public.products
      where id = item_product_id
      for update;

    if not found or not product_row.is_active then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    if product_row.currency <> p_currency then
      raise exception 'CURRENCY_MISMATCH';
    end if;
    if product_row.stock < item_quantity then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    computed_line_total := round(product_row.price * item_quantity, 2);
    computed_subtotal := round(computed_subtotal + computed_line_total, 2);
  end loop;

  insert into public.orders (
    order_reference, customer_name, phone, address, city, country_code,
    currency, subtotal, shipping_amount, total_amount, status, idempotency_key
  ) values (
    p_order_reference, p_customer_name, p_phone, p_address, p_city, p_country_code,
    p_currency, computed_subtotal, 0, computed_subtotal, 'pending', p_idempotency_key
  )
  returning id into created_order_id;

  for item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;

    select * into product_row
      from public.products
      where id = item_product_id
      for update;

    update public.products
      set stock = stock - item_quantity
      where id = item_product_id and stock >= item_quantity and is_active = true;
    if not found then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    computed_line_total := round(product_row.price * item_quantity, 2);
    insert into public.order_items (
      order_id, product_id, product_name_ar, product_name_fr, quantity, unit_price, line_total
    ) values (
      created_order_id, product_row.id, product_row.name_ar, product_row.name_fr,
      item_quantity, product_row.price, computed_line_total
    );
  end loop;

  return p_order_reference;
end;
$;

revoke all on function public.create_cod_order(text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_cod_order(text,text,text,text,text,text,text,text,jsonb) to service_role;

-- After creating your admin in Supabase Auth, run:
-- insert into public.admin_users (user_id) values ('YOUR_AUTH_USER_UUID');
-- Do this only from the SQL Editor as project owner; never expose this privilege to the browser.
 or p_max_requests < 1 or p_max_requests > 100 then
    raise exception 'INVALID_RATE_LIMIT_ARGUMENT';
  end if;

  insert into public.cod_order_rate_limits(fingerprint, window_started_at, request_count)
  values (p_fingerprint, current_window, 1)
  on conflict (fingerprint) do update
    set window_started_at = case
          when public.cod_order_rate_limits.window_started_at < current_window then current_window
          else public.cod_order_rate_limits.window_started_at
        end,
        request_count = case
          when public.cod_order_rate_limits.window_started_at < current_window then 1
          else public.cod_order_rate_limits.request_count + 1
        end
  returning request_count into new_count;

  return new_count <= p_max_requests;
end;
$;
revoke all on function public.consume_cod_order_rate_limit(text,integer) from public, anon, authenticated;
grant execute on function public.consume_cod_order_rate_limit(text,integer) to service_role;

-- This RPC is callable only by the Edge Function's service-role key.
-- It locks products, recalculates prices, reserves stock, and writes order rows atomically.
create or replace function public.create_cod_order(
  p_order_reference text,
  p_customer_name text,
  p_phone text,
  p_address text,
  p_city text,
  p_country_code text,
  p_currency text,
  p_idempotency_key text,
  p_items jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $
declare
  item jsonb;
  product_row public.products%rowtype;
  item_product_id uuid;
  item_quantity integer;
  computed_subtotal numeric(12,2) := 0;
  computed_line_total numeric(12,2);
  created_order_id uuid;
  item_count integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_ITEMS';
  end if;

  for item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    item_count := item_count + 1;
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 or item_quantity > 99 then
      raise exception 'INVALID_QUANTITY';
    end if;

    select * into product_row
      from public.products
      where id = item_product_id
      for update;

    if not found or not product_row.is_active then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    if product_row.currency <> p_currency then
      raise exception 'CURRENCY_MISMATCH';
    end if;
    if product_row.stock < item_quantity then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    computed_line_total := round(product_row.price * item_quantity, 2);
    computed_subtotal := round(computed_subtotal + computed_line_total, 2);
  end loop;

  insert into public.orders (
    order_reference, customer_name, phone, address, city, country_code,
    currency, subtotal, shipping_amount, total_amount, status, idempotency_key
  ) values (
    p_order_reference, p_customer_name, p_phone, p_address, p_city, p_country_code,
    p_currency, computed_subtotal, 0, computed_subtotal, 'pending', p_idempotency_key
  )
  returning id into created_order_id;

  for item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;

    select * into product_row
      from public.products
      where id = item_product_id
      for update;

    update public.products
      set stock = stock - item_quantity
      where id = item_product_id and stock >= item_quantity and is_active = true;
    if not found then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    computed_line_total := round(product_row.price * item_quantity, 2);
    insert into public.order_items (
      order_id, product_id, product_name_ar, product_name_fr, quantity, unit_price, line_total
    ) values (
      created_order_id, product_row.id, product_row.name_ar, product_row.name_fr,
      item_quantity, product_row.price, computed_line_total
    );
  end loop;

  return p_order_reference;
end;
$;

revoke all on function public.create_cod_order(text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_cod_order(text,text,text,text,text,text,text,text,jsonb) to service_role;

-- After creating your admin in Supabase Auth, run:
-- insert into public.admin_users (user_id) values ('YOUR_AUTH_USER_UUID');
-- Do this only from the SQL Editor as project owner; never expose this privilege to the browser.
