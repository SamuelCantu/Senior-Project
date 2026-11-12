-- Apply once in the Supabase SQL Editor. Backup first. This does not publish items.
-- This is a single-owner prototype; do not add browser policies to these tables.
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  marketplace text not null check (marketplace = 'bonanza'),
  external_item_id text not null,
  status text not null default 'publishing',
  published_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, marketplace, external_item_id),
  unique (user_id, marketplace, product_id)
);

create table if not exists public.bonanza_order_lines (
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null,
  item_id text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null check (status in ('applied','oversold')),
  processed_at timestamptz not null default now(),
  primary key (user_id, order_id, item_id)
);

alter table public.marketplace_listings enable row level security;
alter table public.bonanza_order_lines enable row level security;
revoke all on public.marketplace_listings from anon, authenticated;
revoke all on public.bonanza_order_lines from anon, authenticated;
grant select, insert, update on public.marketplace_listings to service_role;
grant select, insert, update on public.bonanza_order_lines to service_role;

-- Called ONLY from server code using the service-role client. Locks central
-- inventory and idempotently applies each paid order line once.
create or replace function public.apply_bonanza_sale(
  p_user_id uuid, p_product_id uuid, p_order_id text,
  p_item_id text, p_quantity integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_available integer;
  v_previous public.bonanza_order_lines%rowtype;
  v_remaining integer;
begin
  if p_quantity is null or p_quantity <= 0 or
     p_order_id is null or p_order_id = '' or
     p_item_id is null or p_item_id = '' then
    raise exception 'Invalid order parameters';
  end if;

  select quantity into v_available
  from public.products
  where id = p_product_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Product does not belong to seller';
  end if;

  select * into v_previous
  from public.bonanza_order_lines
  where user_id = p_user_id and order_id = p_order_id and item_id = p_item_id;

  if found then
    if v_previous.product_id <> p_product_id or v_previous.quantity <> p_quantity then
      return jsonb_build_object('result','conflict','remaining',v_available);
    end if;
    return jsonb_build_object('result','duplicate','remaining',v_available,'priorStatus',v_previous.status);
  end if;

  if v_available < p_quantity then
    insert into public.bonanza_order_lines
      (user_id,order_id,item_id,product_id,quantity,status)
    values (p_user_id,p_order_id,p_item_id,p_product_id,p_quantity,'oversold');
    return jsonb_build_object('result','oversold','remaining',v_available);
  end if;

  v_remaining := v_available - p_quantity;
  update public.products
  set quantity = v_remaining,
      status = case when v_remaining = 0 then 'SOLD_OUT' else 'AVAILABLE' end,
      updated_at = now()
  where id = p_product_id and user_id = p_user_id;

  insert into public.bonanza_order_lines
    (user_id,order_id,item_id,product_id,quantity,status)
  values (p_user_id,p_order_id,p_item_id,p_product_id,p_quantity,'applied');

  return jsonb_build_object('result','applied','remaining',v_remaining);
end;
$$;

revoke all on function public.apply_bonanza_sale(uuid,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.apply_bonanza_sale(uuid,uuid,text,text,integer) to service_role;
