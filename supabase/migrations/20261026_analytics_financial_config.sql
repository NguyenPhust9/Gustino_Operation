create table if not exists public.analytics_financial_configs (
  period_month date primary key,
  fixed_cost numeric not null check (fixed_cost >= 0),
  gross_margin_rate numeric not null check (gross_margin_rate > 0 and gross_margin_rate <= 1),
  kpi_target numeric check (kpi_target is null or kpi_target >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.analytics_financial_configs enable row level security;

drop policy if exists "admin manages analytics financial configs" on public.analytics_financial_configs;
create policy "admin manages analytics financial configs"
  on public.analytics_financial_configs
  for all to authenticated
  using ((select (public.current_profile()).role) = 'admin'::public.app_role)
  with check ((select (public.current_profile()).role) = 'admin'::public.app_role);

insert into public.analytics_financial_configs (
  period_month,
  fixed_cost,
  gross_margin_rate,
  kpi_target
)
values (
  date '2026-10-01',
  219000000,
  0.45367231612786874,
  498181819
)
on conflict (period_month) do update set
  fixed_cost = excluded.fixed_cost,
  gross_margin_rate = excluded.gross_margin_rate,
  kpi_target = excluded.kpi_target,
  updated_at = now();

grant select, insert, update, delete on public.analytics_financial_configs to authenticated;

notify pgrst, 'reload schema';
