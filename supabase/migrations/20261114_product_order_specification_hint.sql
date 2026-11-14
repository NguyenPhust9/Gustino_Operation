-- A per-SKU suggestion shown to staff while creating supply requests.
alter table public.products
add column if not exists order_specification_hint text;

notify pgrst, 'reload schema';
