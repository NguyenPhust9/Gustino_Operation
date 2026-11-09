-- 1. Thêm cờ cho phép nhân sự di chuyển nhiều chi nhánh (roaming staff / quản lý điểm bán)
alter table public.profiles
  add column if not exists can_roam_branches boolean not null default false;

-- Tự động bật quyền di chuyển đa chi nhánh cho tài khoản Thảo Vy
update public.profiles
set can_roam_branches = true
where lower(trim(full_name)) like '%thảo vy%'
   or lower(trim(full_name)) like '%thao vy%';

-- 2. RPC cho phép nhân sự có quyền can_roam_branches chuyển đổi chi nhánh làm việc hiện tại
create or replace function public.switch_my_active_branch(p_branch_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_target_branch text := trim(coalesce(p_branch_id, ''));
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.id is null or not coalesce(v_actor.active, true) then
    raise exception 'Tài khoản không hợp lệ hoặc đã ngừng hoạt động';
  end if;

  if not (
    coalesce(v_actor.can_roam_branches, false)
    or v_actor.role in ('admin', 'manager', 'supmt')
  ) then
    raise exception 'Tài khoản này không được phép chuyển chi nhánh làm việc';
  end if;

  if v_target_branch = '' or not exists (
    select 1 from public.branches b where b.id = v_target_branch and coalesce(b.active, true) = true
  ) then
    raise exception 'Chi nhánh không hợp lệ hoặc đã ngừng hoạt động';
  end if;

  update public.profiles
  set branch_id = v_target_branch
  where id = v_actor.id;

  return v_target_branch;
end;
$$;

grant execute on function public.switch_my_active_branch(text) to authenticated;

-- 3. RPC cho Admin bật/tắt quyền di chuyển đa chi nhánh cho nhân viên bất kỳ trong trang Quản trị
create or replace function public.admin_set_employee_roaming(
  p_employee_id uuid,
  p_can_roam boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.id is null or not coalesce(v_actor.active, true) or v_actor.role <> 'admin' then
    raise exception 'Chỉ Admin mới được cấp quyền di chuyển đa chi nhánh';
  end if;

  update public.profiles
  set can_roam_branches = coalesce(p_can_roam, false)
  where id = p_employee_id;

  return coalesce(p_can_roam, false);
end;
$$;

grant execute on function public.admin_set_employee_roaming(uuid, boolean) to authenticated;

-- 4. Cập nhật hàm kiểm tra quyền chi nhánh và đăng ký ca để hỗ trợ nhân sự đa chi nhánh
create or replace function public.can_manage_branch(p_branch_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles actor
    where actor.id = auth.uid()
      and actor.active = true
      and (
        actor.role in ('admin', 'kitchen', 'supmt')
        or (
          actor.role in ('shift_leader', 'manager')
          and (actor.branch_id = p_branch_id or coalesce(actor.can_roam_branches, false) = true)
        )
      )
  );
$$;

create or replace function public.add_shift_registration_safe(
  p_branch_id text,
  p_shift_date date,
  p_shift_code text,
  p_note text default ''
)
returns public.shift_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_inserted public.shift_registrations;
  v_branch text := trim(coalesce(p_branch_id, ''));
  v_code text := trim(coalesce(p_shift_code, ''));
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập';
  end if;

  select *
  into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.id is null or not coalesce(v_actor.active, true) then
    raise exception 'Tài khoản không hợp lệ';
  end if;

  if v_branch = '' then
    v_branch := coalesce(v_actor.branch_id, '');
  end if;

  if v_actor.role not in ('admin', 'manager')
     and not coalesce(v_actor.can_roam_branches, false)
     and v_actor.branch_id is distinct from v_branch then
    raise exception 'Không có quyền đăng ký ca cho chi nhánh khác';
  end if;

  if v_code not in ('M1', 'M2', 'A1', 'A2', 'E1', 'FULL') then
    raise exception 'Ca làm không hợp lệ';
  end if;

  insert into public.shift_registrations (
    id, user_id, employee_name, role, branch_id, shift_date, shift_code, status, note, created_by, approved_by
  )
  values (
    'sr-' || extract(epoch from clock_timestamp())::bigint::text || '-' || substr(md5(random()::text), 1, 6),
    v_actor.id,
    coalesce(nullif(trim(v_actor.full_name), ''), 'Nhân sự'),
    v_actor.role,
    v_branch,
    p_shift_date,
    v_code,
    case when v_actor.role in ('admin', 'manager', 'shift_leader') then 'approved' else 'registered' end,
    coalesce(p_note, ''),
    v_actor.full_name,
    case when v_actor.role in ('admin', 'manager', 'shift_leader') then v_actor.full_name else null end
  )
  on conflict (user_id, shift_date, shift_code)
  do update set
    branch_id = excluded.branch_id,
    note = excluded.note
  returning * into v_inserted;

  return v_inserted;
end;
$$;

create or replace function public.add_manual_shift_registration(
  p_user_id uuid,
  p_branch_id text,
  p_shift_date date,
  p_shift_code text,
  p_note text default '',
  p_start_time time default null,
  p_end_time time default null
)
returns public.shift_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_inserted public.shift_registrations;
  v_branch text := trim(coalesce(p_branch_id, ''));
  v_code text := trim(coalesce(p_shift_code, ''));
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập';
  end if;

  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or not coalesce(v_actor.active, true) then
    raise exception 'Tài khoản không hợp lệ';
  end if;

  if v_actor.role not in ('admin', 'manager', 'shift_leader') then
    raise exception 'Chỉ quản lý hoặc ca trưởng mới được xếp ca trực tiếp';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if v_target.id is null or not coalesce(v_target.active, true) then
    raise exception 'Nhân sự được phân ca không tồn tại hoặc đã nghỉ';
  end if;

  if v_branch = '' then
    v_branch := coalesce(v_target.branch_id, v_actor.branch_id, '');
  end if;

  if v_actor.role in ('manager', 'shift_leader')
     and not coalesce(v_actor.can_roam_branches, false)
     and v_actor.branch_id is distinct from v_branch then
    raise exception 'Chỉ được xếp ca trong chi nhánh bạn phụ trách';
  end if;

  if v_target.role not in ('admin', 'manager')
     and not coalesce(v_target.can_roam_branches, false)
     and v_target.branch_id is distinct from v_branch then
    raise exception 'Nhân sự không thuộc chi nhánh này';
  end if;

  if v_code = 'CUSTOM' then
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'Ca tùy chỉnh cần giờ bắt đầu/kết thúc hợp lệ';
    end if;
  elsif v_code not in ('M1', 'M2', 'A1', 'A2', 'E1', 'FULL') then
    raise exception 'Ca làm không hợp lệ';
  end if;

  insert into public.shift_registrations (
    id, user_id, employee_name, role, branch_id, shift_date, shift_code, custom_start_time, custom_end_time, status, note, created_by, approved_by
  )
  values (
    'sr-' || extract(epoch from clock_timestamp())::bigint::text || '-' || substr(md5(random()::text), 1, 6),
    v_target.id,
    coalesce(nullif(trim(v_target.full_name), ''), 'Nhân sự'),
    v_target.role,
    v_branch,
    p_shift_date,
    v_code,
    case when v_code = 'CUSTOM' then p_start_time else null end,
    case when v_code = 'CUSTOM' then p_end_time else null end,
    'approved',
    coalesce(p_note, ''),
    v_actor.full_name,
    v_actor.full_name
  )
  on conflict (user_id, shift_date, shift_code)
  do update set
    branch_id = excluded.branch_id,
    custom_start_time = excluded.custom_start_time,
    custom_end_time = excluded.custom_end_time,
    status = 'approved',
    note = excluded.note,
    approved_by = v_actor.full_name
  returning * into v_inserted;

  return v_inserted;
end;
$$;

create or replace function public.set_schedule_registration_safe(
  p_registration_id text default null,
  p_user_id uuid default null,
  p_branch_id text default null,
  p_shift_date date default null,
  p_shift_code text default null,
  p_note text default '',
  p_start_time time default null,
  p_end_time time default null
)
returns public.shift_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_existing public.shift_registrations;
  v_result public.shift_registrations;
  v_branch text := trim(coalesce(p_branch_id, ''));
  v_code text := trim(coalesce(p_shift_code, ''));
  v_target_user_id uuid;
  v_target_date date;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập';
  end if;

  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or not coalesce(v_actor.active, true) then
    raise exception 'Tài khoản không hợp lệ';
  end if;

  if v_actor.role not in ('admin', 'manager', 'shift_leader') then
    raise exception 'Chỉ quản lý hoặc ca trưởng mới được chỉnh lịch làm việc';
  end if;

  if nullif(trim(coalesce(p_registration_id, '')), '') is not null then
    select * into v_existing
    from public.shift_registrations
    where id = trim(p_registration_id);

    if v_existing.id is null then
      raise exception 'Không tìm thấy ca đăng ký cần sửa';
    end if;
  end if;

  v_target_user_id := coalesce(p_user_id, v_existing.user_id);
  v_target_date := coalesce(p_shift_date, v_existing.shift_date);

  if v_target_user_id is null or v_target_date is null then
    raise exception 'Thiếu thông tin nhân sự hoặc ngày làm việc';
  end if;

  select * into v_target from public.profiles where id = v_target_user_id;
  if v_target.id is null or not coalesce(v_target.active, true) then
    raise exception 'Nhân sự được phân ca không tồn tại hoặc đã nghỉ';
  end if;

  if v_branch = '' then
    v_branch := coalesce(v_existing.branch_id, v_target.branch_id, v_actor.branch_id, '');
  end if;

  if v_actor.role in ('manager', 'shift_leader')
     and not coalesce(v_actor.can_roam_branches, false)
     and v_actor.branch_id is distinct from v_branch then
    raise exception 'Chỉ được chỉnh lịch trong chi nhánh bạn phụ trách';
  end if;

  if v_target.role not in ('admin', 'manager')
     and not coalesce(v_target.can_roam_branches, false)
     and v_target.branch_id is distinct from v_branch then
    raise exception 'Nhân sự không thuộc chi nhánh này';
  end if;

  if v_code = 'CUSTOM' then
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'Ca tùy chỉnh cần giờ bắt đầu/kết thúc hợp lệ';
    end if;
  elsif v_code not in ('M1', 'M2', 'A1', 'A2', 'E1', 'FULL') then
    raise exception 'Ca làm không hợp lệ';
  end if;

  if v_existing.id is not null then
    delete from public.shift_registrations
    where user_id = v_target.id
      and shift_date = v_target_date
      and shift_code = v_code
      and id <> v_existing.id;

    update public.shift_registrations
    set
      user_id = v_target.id,
      employee_name = coalesce(nullif(trim(v_target.full_name), ''), 'Nhân sự'),
      role = v_target.role,
      branch_id = v_branch,
      shift_date = v_target_date,
      shift_code = v_code,
      custom_start_time = case when v_code = 'CUSTOM' then p_start_time else null end,
      custom_end_time = case when v_code = 'CUSTOM' then p_end_time else null end,
      status = 'approved',
      note = coalesce(p_note, ''),
      approved_by = v_actor.full_name
    where id = v_existing.id
    returning * into v_result;

    return v_result;
  end if;

  insert into public.shift_registrations (
    id, user_id, employee_name, role, branch_id, shift_date, shift_code, custom_start_time, custom_end_time, status, note, created_by, approved_by
  )
  values (
    'sr-' || extract(epoch from clock_timestamp())::bigint::text || '-' || substr(md5(random()::text), 1, 6),
    v_target.id,
    coalesce(nullif(trim(v_target.full_name), ''), 'Nhân sự'),
    v_target.role,
    v_branch,
    v_target_date,
    v_code,
    case when v_code = 'CUSTOM' then p_start_time else null end,
    case when v_code = 'CUSTOM' then p_end_time else null end,
    'approved',
    coalesce(p_note, ''),
    v_actor.full_name,
    v_actor.full_name
  )
  on conflict (user_id, shift_date, shift_code)
  do update set
    branch_id = excluded.branch_id,
    custom_start_time = excluded.custom_start_time,
    custom_end_time = excluded.custom_end_time,
    status = 'approved',
    note = excluded.note,
    approved_by = v_actor.full_name
  returning * into v_result;

  return v_result;
end;
$$;
