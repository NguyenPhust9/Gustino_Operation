import type { AppUser, StockMovement } from '../types'
import { fetchMovements, fetchMovementsDelta, fetchReportSnapshots } from './store'
import { shouldUseLanApi } from './supabase'
import { invalidateReadCache, readRevision, readScope, sharedRead } from './readCache'

const FULL_RECONCILIATION_MS = 150_000
const movementStates = new Map<string, { rows: StockMovement[]; fullAt: number; revision: string }>()

type DashboardEvent = { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }

export function dashboardEventInScope(payload: DashboardEvent, branchIds: string[]) {
  const known = [payload.new?.branch_id, payload.old?.branch_id].filter((id): id is string => typeof id === 'string')
  return !known.length || known.some((id) => branchIds.includes(id))
}

/** Complete stock baseline plus new rows; historical changes force a complete read. */
export function fetchDashboardMovements(branchId: string, user?: AppUser): Promise<StockMovement[]> {
  if (shouldUseLanApi(user)) return fetchMovements(branchId, user)
  const key = `movements:${readScope(user)}:${branchId}`
  return sharedRead(key, 'stock_movements', branchId, 5_000, async () => {
    const revision = readRevision('stock_movements', branchId)
    const state = movementStates.get(key)
    const full = async () => {
      const rows = await fetchMovements(branchId, user)
      movementStates.delete(key)
      movementStates.set(key, { rows, fullAt: Date.now(), revision })
      while (movementStates.size > 32) movementStates.delete(movementStates.keys().next().value!)
      return rows
    }
    if (!state || state.revision !== revision || Date.now() - state.fullAt >= FULL_RECONCILIATION_MS) return full()
    const latest = state.rows.reduce((max, row) => row.createdAt > max ? row.createdAt : max, '')
    // One millisecond overlap catches another inserted row with the same timestamp.
    const since = latest ? new Date(new Date(latest).getTime() - 1).toISOString() : '1970-01-01T00:00:00.000Z'
    const delta = await fetchMovementsDelta(branchId, since, user).catch(() => null)
    if (!delta) return full()
    const byId = new Map(state.rows.map((row) => [row.id, row]))
    delta.rows.forEach((row) => byId.set(row.id, row))
    const rows = [...byId.values()]
    if (rows.filter((row) => row.shiftDate >= delta.recentSince).length !== delta.recentTotal) return full()
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    state.rows = rows
    return rows
  })
}

export function fetchDashboardSnapshots(branchId: string, user: AppUser, filters: { from: string; to: string }) {
  if (shouldUseLanApi(user)) return fetchReportSnapshots(branchId, user, filters)
  const key = `snapshots:${readScope(user)}:${branchId}:${filters.from}:${filters.to}`
  return sharedRead(key, 'report_snapshots', branchId, FULL_RECONCILIATION_MS,
    () => fetchReportSnapshots(branchId, user, filters))
}

export function invalidateDashboardEvent(table: string, payload: DashboardEvent) {
  const value = payload.new?.branch_id || payload.old?.branch_id
  const branch = typeof value === 'string' ? value : undefined
  // Inserts use the delta path. Updates/deletes may affect arbitrarily old stock.
  invalidateReadCache(table, branch, table !== 'stock_movements' || payload.eventType !== 'INSERT')
  const previous = payload.old?.branch_id
  if (typeof previous === 'string' && previous !== branch) invalidateReadCache(table, previous)
}
