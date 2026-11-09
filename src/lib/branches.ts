import { useEffect, useState } from 'react'
import type { AppUser, Branch } from '../types'
import { BRANCHES } from './constants'
import { isMissingRpc, userBranchIds, userHeaders } from './core'
import { shouldUseLanApi, supabase, uniqueChannelName } from './supabase'
import { functionsErrorMessage } from './functionsError'

export type ConfigBranchSource = 'system' | 'custom'

export interface ConfigBranch extends Branch {
  address: string
  manager: string
  active: boolean
  source: ConfigBranchSource
}

export const MASTER_BRANCHES_KEY = 'gustino_master_branches_v1'
export const BRANCHES_CHANGED_EVENT = 'gustino:branches-changed'

let configuredBranchRowsCache: ConfigBranch[] | null = null

function systemBranches(): ConfigBranch[] {
  return BRANCHES.map((branch) => ({
    id: branch.id,
    name: branch.name,
    address: '',
    manager: '',
    active: true,
    source: 'system',
  }))
}

function normalizeBranch(row: Partial<ConfigBranch> & Branch): ConfigBranch {
  return {
    id: row.id,
    name: row.name,
    address: row.address || '',
    manager: row.manager || '',
    active: row.active !== false,
    source: row.source || (BRANCHES.some((branch) => branch.id === row.id) ? 'system' : 'custom'),
  }
}

function canonicalizeBranchRows(rows: Array<Partial<ConfigBranch> & Branch>): ConfigBranch[] {
  const byId = new Map<string, ConfigBranch>()
  for (const row of rows) {
    const normalized = normalizeBranch(row)
    if (!normalized.id) continue
    const existing = byId.get(normalized.id)
    if (!existing) {
      byId.set(normalized.id, normalized)
      continue
    }
    byId.set(normalized.id, {
      ...existing,
      ...normalized,
      address: normalized.address || existing.address,
      manager: normalized.manager || existing.manager,
      // Nếu cùng payload vừa có bản active vừa có bản inactive, ưu tiên active.
      // Đây là đường "thêm lại/mở lại chi nhánh" sau khi đã xóa/tạm ngưng.
      active: existing.active || normalized.active,
      source: existing.source === 'system' ? 'system' : normalized.source,
    })
  }
  return Array.from(byId.values()).sort((a, b) =>
    Number(b.active) - Number(a.active)
    || a.name.localeCompare(b.name, 'vi')
    || a.id.localeCompare(b.id),
  )
}

function mergeConfiguredRows(rows: ConfigBranch[]) {
  const localRows = configuredBranchRowsCache || systemBranches()
  const localById = new Map(localRows.map((branch) => [branch.id, branch]))
  // Cloud là nguồn sự thật cho tên + trạng thái active; local chỉ bổ sung
  // metadata (địa chỉ, quản lý) chưa có trên cloud. Trước đây local có thể
  // ghi đè active=false vĩnh viễn khiến danh sách chi nhánh lệch giữa các máy.
  return canonicalizeBranchRows(rows.map((row) => ({
    ...localById.get(row.id),
    ...row,
  })))
}

export function readConfiguredBranchRows(): ConfigBranch[] {
  return canonicalizeBranchRows(configuredBranchRowsCache?.length ? configuredBranchRowsCache : systemBranches())
}

export function writeConfiguredBranchRows(branches: ConfigBranch[]) {
  configuredBranchRowsCache = canonicalizeBranchRows(branches)
  notifyConfiguredBranchesChanged()
}

export async function fetchConfiguredBranchRows(user?: AppUser): Promise<ConfigBranch[]> {
  const scopedBranchIds = userBranchScope(user)
  if (user && shouldUseLanApi(user)) {
    const response = await fetch('/api/branches?includeInactive=1', { headers: userHeaders(user) })
    if (!response.ok) throw new Error('Không thể tải danh sách chi nhánh từ máy chủ.')
    const rows = await response.json() as ConfigBranch[]
    const merged = mergeConfiguredRows(scopedBranchIds ? rows.filter((row) => scopedBranchIds.includes(row.id)) : rows)
    writeConfiguredBranchRows(merged)
    return merged
  }
  if (!supabase) return readConfiguredBranchRows()
  let query = supabase
    .from('branches')
    .select('id,name,active,address,manager_name')
    .order('name')
  if (scopedBranchIds?.length) query = query.in('id', scopedBranchIds)
  const { data, error } = await query
  if (error) throw error
  const rows = (data || []).map((row) => normalizeBranch({
    id: row.id,
    name: row.name,
    address: row.address || '',
    manager: row.manager_name || '',
    active: row.active !== false,
    source: BRANCHES.some((branch) => branch.id === row.id) ? 'system' : 'custom',
  }))
  const merged = mergeConfiguredRows(rows)
  writeConfiguredBranchRows(merged)
  return merged
}

function userBranchScope(user?: AppUser) {
  if (!user) return null
  if (user.role === 'admin' || user.role === 'supmt' || user.canRoamBranches) return null
  const ids = userBranchIds(user)
  return ids.length ? ids : null
}

export async function syncConfiguredBranchRows(user: AppUser, branches: ConfigBranch[]) {
  const rows = canonicalizeBranchRows(branches)
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/branches', {
      method: 'PUT',
      headers: userHeaders(user),
      body: JSON.stringify(rows),
    })
    if (!response.ok) throw new Error('Không thể đồng bộ danh sách chi nhánh lên máy chủ.')
    return
  }
  if (!supabase || user.role !== 'admin') return
  for (const branch of rows) {
    if (branch.active !== false) {
      const { error: crmError } = await supabase.rpc('admin_upsert_crm_branch', {
        p_branch_id: branch.id,
        p_name: branch.name,
        p_address: branch.address || '',
        p_manager_name: branch.manager || '',
      })
      if (crmError) {
        if (!isMissingRpc(crmError, 'admin_upsert_crm_branch')) throw crmError
        const { error } = await supabase.rpc('upsert_config_branch', {
          p_branch_id: branch.id,
          p_branch_name: branch.name,
        })
        if (error) {
          if (!isMissingRpc(error, 'upsert_config_branch')) throw error
          await upsertBranchDirect(branch)
        }
      }
    } else {
      const { error } = await supabase.rpc('set_config_branch_active', {
        p_branch_id: branch.id,
        p_active: false,
      })
      if (error) {
        const message = String(error.message || '')
        const missingRpc = String((error as any).code || '') === 'PGRST202'
          || message.includes('set_config_branch_active')
          || message.includes('Could not find the function')
        if (!missingRpc) throw error
        const { error: updateError } = await supabase
          .from('branches')
          .update({ active: false })
          .eq('id', branch.id)
        if (updateError) throw updateError
        await deactivateBranchDependents(branch.id)
      }
    }
  }
}

export async function hardDeleteConfiguredBranch(user: AppUser, branchId: string) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xóa chi nhánh.')
  if (!branchId) throw new Error('Chi nhánh không hợp lệ.')
  if (shouldUseLanApi(user)) {
    const rows = readConfiguredBranchRows().filter((branch) => branch.id !== branchId)
    writeConfiguredBranchRows(rows)
    return
  }
  if (!supabase) throw new Error('Supabase chưa được cấu hình.')
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Không tìm thấy phiên Supabase. Hãy tải lại trang và thử lại.')
  }
  const result = await supabase.functions.invoke('manage-employee', {
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    body: { action: 'delete_branch', branchId },
  })
  if (result.error) {
    throw new Error(await functionsErrorMessage(result.error, 'Không thể xóa chi nhánh.'))
  }
  if (result.data?.error) throw new Error(result.data.error)
  const rows = readConfiguredBranchRows().filter((branch) => branch.id !== branchId)
  writeConfiguredBranchRows(rows)
}

async function upsertBranchDirect(branch: ConfigBranch) {
  const { error } = await supabase!
    .from('branches')
    .upsert({
      id: branch.id,
      name: branch.name,
      address: branch.address || '',
      manager_name: branch.manager || '',
      active: branch.active !== false,
    }, { onConflict: 'id' })
  if (error) throw error
}

async function deactivateBranchDependents(branchId: string) {
  await supabase!
    .from('profiles')
    .update({ active: false })
    .eq('branch_id', branchId)
    .in('role', ['shift_leader', 'staff'])
    .then(({ error }) => {
      if (error) console.warn('Không thể khóa tài khoản thuộc chi nhánh đã xóa:', error.message)
    })
  await supabase!
    .from('schedule_people')
    .update({ active: false })
    .eq('branch_id', branchId)
    .then(({ error }) => {
      if (error) console.warn('Không thể ẩn nhân sự lịch thuộc chi nhánh đã xóa:', error.message)
    })
  await supabase!
    .from('shifts')
    .update({ active: false })
    .eq('branch_id', branchId)
    .then(({ error }) => {
      if (error) console.warn('Không thể tạm ngưng khung ca thuộc chi nhánh đã xóa:', error.message)
    })
}

export function notifyConfiguredBranchesChanged() {
  window.dispatchEvent(new Event(BRANCHES_CHANGED_EVENT))
}

export function getConfiguredBranches(options: { includeInactive?: boolean } = {}): Branch[] {
  return readConfiguredBranchRows()
    .filter((branch) => options.includeInactive || branch.active)
    .map(({ id, name }) => ({ id, name }))
}

export function branchIds(branches = getConfiguredBranches()) {
  return branches.map((branch) => branch.id)
}

export function branchName(id?: string, branches = getConfiguredBranches({ includeInactive: true })) {
  return branches.find((branch) => branch.id === id)?.name || id || ''
}

// Hook này mount đồng thời ở App + nhiều page nên topic channel phải duy nhất
// (xem uniqueChannelName trong supabase.ts) — tên tĩnh làm crash cả app.
export function useConfiguredBranches(options: { includeInactive?: boolean; user?: AppUser } = {}) {
  const [branches, setBranches] = useState(() => getConfiguredBranches(options))

  useEffect(() => {
    const refresh = () => setBranches(getConfiguredBranches(options))
    const refreshCloud = () => {
      void fetchConfiguredBranchRows(options.user)
        .then((rows) => setBranches(rows
          .filter((branch) => options.includeInactive || branch.active)
          .map(({ id, name }) => ({ id, name })),
        ))
        .catch(() => refresh())
    }
    window.addEventListener(BRANCHES_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    refreshCloud()
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
    try {
      channel = supabase?.channel(uniqueChannelName('configured-branches'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, refreshCloud)
        .subscribe() ?? null
    } catch {
      channel = null
    }
    return () => {
      window.removeEventListener(BRANCHES_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [options.includeInactive, options.user?.id, options.user?.role, options.user?.canRoamBranches, (options.user?.branchIds || []).join(','), options.user?.authToken])

  return branches
}
