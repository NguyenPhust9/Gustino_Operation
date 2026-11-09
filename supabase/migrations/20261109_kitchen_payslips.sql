-- Cho phép tài khoản Bếp (role = 'kitchen') xác nhận phiếu lương của chính mình.
-- Bếp không gán chi nhánh nên phiếu lương lưu với branch_id = 'central-kitchen'
-- (payroll_entries.branch_id là text, không có khóa ngoại). Không đổi dữ liệu hiện có.
begin;
set local lock_timeout = '5s';

create or replace function public.confirm_own_payslip(p_entry_id uuid, p_published_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  confirmed_at timestamptz;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role::text in ('staff', 'shift_leader', 'cashier', 'kitchen')
  ) then
    raise exception 'Chỉ nhân viên được xác nhận phiếu lương của chính mình.';
  end if;

  update public.payroll_entries
  set employee_confirmed_at = coalesce(employee_confirmed_at, now())
  where id = p_entry_id
    and employee_id = auth.uid()
    and published_at is not null
    and published_at = p_published_at
  returning employee_confirmed_at into confirmed_at;

  if not found then
    raise exception 'Phiếu lương đã thu hồi, thay đổi hoặc không thuộc tài khoản hiện tại. Vui lòng tải lại.';
  end if;
  return confirmed_at;
end;
$$;

revoke all on function public.confirm_own_payslip(uuid, timestamptz) from public;
grant execute on function public.confirm_own_payslip(uuid, timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
