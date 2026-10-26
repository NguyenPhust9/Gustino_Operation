alter table public.analytics_financial_configs
  add column if not exists branch_break_even jsonb not null default '{}'::jsonb;

update public.analytics_financial_configs
set branch_break_even = jsonb_build_object(
  'B001', 156500000,
  'B002', 52500000,
  'B003', 60000000,
  'B004', 52500000,
  'B005', 52727273,
  'B006', 47500000,
  'B007', 60000000
), updated_at = now()
where period_month = date '2026-10-01';

notify pgrst, 'reload schema';
