alter table public.analytics_financial_configs
  add column if not exists tier_1_rate numeric not null default 1 check (tier_1_rate > 0),
  add column if not exists tier_2_rate numeric not null default 1.05 check (tier_2_rate > 0),
  add column if not exists tier_3_rate numeric not null default 1.15 check (tier_3_rate > 0);

update public.analytics_financial_configs
set tier_1_rate = 1,
    tier_2_rate = 1.05,
    tier_3_rate = 1.15,
    updated_at = now()
where period_month = date '2026-10-01';

notify pgrst, 'reload schema';
