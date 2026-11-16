import type { AppUser } from '../types'

type Entry = { table: string; branch?: string; expires: number; value?: unknown; pending?: Promise<unknown> }
const entries = new Map<string, Entry>()
const revisions = new Map<string, number>()
let generation = 0

export function readScope(user?: AppUser) {
  return JSON.stringify([generation, user?.id, user?.role, user?.branchId,
    [...(user?.branchIds || [])].sort(), Boolean(user?.canRoamBranches)])
}

export function readRevision(table: string, branch?: string) {
  return `${generation}:${revisions.get(table) || 0}:${revisions.get(`${table}:${branch}`) || 0}`
}

export function invalidateReadCache(table: string, branch?: string, changedHistory = true) {
  if (changedHistory) {
    const key = branch ? `${table}:${branch}` : table
    revisions.set(key, (revisions.get(key) || 0) + 1)
  }
  for (const [key, entry] of entries) {
    if (entry.table === table && (!branch || !entry.branch || entry.branch === branch)) entries.delete(key)
  }
}

export function clearReadCache() {
  generation += 1
  entries.clear()
  revisions.clear()
}

/** One request per scope; failed or invalidated in-flight results never become cached. */
export function sharedRead<T>(key: string, table: string, branch: string | undefined, ttl: number, load: () => Promise<T>): Promise<T> {
  const existing = entries.get(key)
  if (existing?.pending) return existing.pending as Promise<T>
  if (existing && Date.now() < existing.expires) return Promise.resolve(existing.value as T)
  const entry: Entry = { table, branch, expires: 0 }
  const pending = Promise.resolve().then(load).then((value) => {
    if (entries.get(key) === entry) {
      entry.value = value
      entry.expires = Date.now() + ttl
      entry.pending = undefined
    }
    return value
  }, (error) => {
    if (entries.get(key) === entry) entries.delete(key)
    throw error
  })
  entry.pending = pending
  entries.delete(key)
  entries.set(key, entry)
  while (entries.size > 64) entries.delete(entries.keys().next().value!)
  return pending
}
