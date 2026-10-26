import { createHmac } from 'node:crypto'

declare const process: { env: Record<string, string | undefined> }

const API_ROOT = 'https://graphapi.cukcuk.vn'
const PAGE_SIZE = 100
const REQUEST_DELAY_MS = 300
const MAX_RANGE_DAYS = 62

type Session = { token: string; companyCode: string }
type CukcukBranch = { Id: string; Code?: string; Name?: string; Inactive?: boolean; IsBaseDepot?: boolean }

export default async function handler(request: any, response: any) {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0')
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' })
  const operator = await authenticatedAdmin(request.headers?.authorization)
  if (!operator) return response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' })
  if (operator.active === false || operator.role !== 'admin') {
    return response.status(403).json({ error: 'Chỉ Admin được xem Gustino Analyst.' })
  }
  try {
    const query = request.query || Object.fromEntries(new URL(request.url || '/', 'http://localhost').searchParams)
    return response.status(200).json(await buildCukcukAnalytics({
      from: String(query.from || ''),
      to: String(query.to || ''),
      branchId: String(query.branchId || ''),
    }))
  } catch (error) {
    return response.status(error instanceof InputError ? 400 : 502).json({
      error: error instanceof Error ? error.message : 'Không thể tải dữ liệu CUKCUK.',
    })
  }
}

export async function buildCukcukAnalytics(input: { from: string; to: string; branchId?: string }) {
  validateDateRange(input.from, input.to)
  const credentials = {
    domain: requiredEnv('CUKCUK_DOMAIN'),
    appId: requiredEnv('CUKCUK_APP_ID'),
    secret: requiredEnv('CUKCUK_SECRET_KEY'),
  }
  const session = await login(credentials)
  const branches = await getBranches(session)
  const selected = input.branchId ? branches.filter((branch) => branch.Id === input.branchId) : branches
  if (input.branchId && !selected.length) throw new InputError('Chi nhánh không tồn tại hoặc đã ngừng hoạt động.')

  const allInvoices: any[] = []
  const branchRows = []
  for (const branch of selected) {
    const invoices = await getInvoices(session, branch.Id, input.from, input.to)
    const summary = summarize(invoices)
    allInvoices.push(...invoices)
    branchRows.push({ id: branch.Id, code: branch.Code || '', name: branch.Name || branch.Code || branch.Id, ...summary.overview })
  }
  const total = summarize(allInvoices)
  return {
    generatedAt: new Date().toISOString(),
    period: { from: input.from, to: input.to },
    scope: input.branchId || 'all',
    branches: branches.map((branch) => ({ id: branch.Id, code: branch.Code || '', name: branch.Name || branch.Code || branch.Id })),
    branchRows,
    ...total,
  }
}

async function authenticatedAdmin(authorization: string | undefined) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '')
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !url || !anonKey) return null
  const authResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } })
  if (!authResponse.ok) return null
  const authUser = await authResponse.json()
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,role,active`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!profileResponse.ok) return null
  return (await profileResponse.json())?.[0] || null
}

async function login(credentials: { domain: string; appId: string; secret: string }): Promise<Session> {
  const loginData = { AppID: credentials.appId, Domain: credentials.domain, LoginTime: new Date().toISOString() }
  const SignatureInfo = createHmac('sha256', credentials.secret).update(JSON.stringify(loginData), 'utf8').digest('hex')
  const result = await apiJson('Đăng nhập CUKCUK', `${API_ROOT}/api/Account/Login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...loginData, SignatureInfo }),
  })
  if (!result?.Data?.AccessToken || !result?.Data?.CompanyCode) throw new Error('CUKCUK không trả token hoặc CompanyCode.')
  return { token: result.Data.AccessToken, companyCode: result.Data.CompanyCode }
}

const authHeaders = (session: Session) => ({ Authorization: `Bearer ${session.token}`, CompanyCode: session.companyCode, 'Content-Type': 'application/json' })

async function getBranches(session: Session): Promise<CukcukBranch[]> {
  const result = await apiJson('Lấy danh sách chi nhánh', `${API_ROOT}/api/v1/branchs/all?includeInactive=false`, { method: 'GET', headers: authHeaders(session) })
  if (!Array.isArray(result.Data)) throw new Error('Phản hồi chi nhánh CUKCUK không hợp lệ.')
  return result.Data.filter((branch: CukcukBranch) => !branch.Inactive && !branch.IsBaseDepot)
}

async function getInvoices(session: Session, branchId: string, from: string, to: string) {
  const rows: any[] = []
  for (let page = 1; ; page += 1) {
    await sleep(REQUEST_DELAY_MS)
    const result = await apiJson(`Lấy hóa đơn trang ${page}`, `${API_ROOT}/api/v1/sainvoices/paging-with-detail`, {
      method: 'POST', headers: authHeaders(session), body: JSON.stringify({ BranchId: branchId, FromDate: from, ToDate: to, Page: page, Limit: PAGE_SIZE }),
    })
    if (!Array.isArray(result.Data)) throw new Error(`Trang hóa đơn ${page} không hợp lệ.`)
    rows.push(...result.Data)
    if (result.Data.length < PAGE_SIZE || rows.length >= Number(result.Total || 0)) return rows
  }
}

function summarize(invoices: any[]) {
  const paid = invoices.filter((invoice) => Number(invoice.PaymentStatus) === 3 && !invoice.CancelDate)
  const cancelled = invoices.filter((invoice) => Number(invoice.PaymentStatus) === 4 || Boolean(invoice.CancelDate))
  const daily = new Map<string, { revenue: number; invoices: number }>()
  const hourly = new Map<string, { revenue: number; invoices: number }>()
  const channels = new Map<string, { revenue: number; invoices: number }>()
  const items = new Map<string, { quantity: number; revenue: number; invoiceIds: Set<string> }>()
  let revenue = 0
  let quantity = 0
  for (const invoice of paid) {
    const amount = number(invoice.TotalAmount)
    revenue += amount
    bump(daily, String(invoice.RefDate || '').slice(0, 10), amount)
    bump(hourly, String(invoice.RefDate || '').match(/T(\d{2}):/)?.[1] || '00', amount)
    const channel = invoice.DeliveryPartnerName || orderTypeLabel(invoice.OrderType)
    bump(channels, channel, amount)
    for (const detail of invoice.SAInvoiceDetails || []) {
      if (detail.ParentID) continue
      const itemQuantity = number(detail.Quantity)
      quantity += itemQuantity
      const name = String(detail.ItemName || 'Không tên').trim()
      const row = items.get(name) || { quantity: 0, revenue: 0, invoiceIds: new Set<string>() }
      row.quantity += itemQuantity
      row.revenue += number(detail.Amount) - number(detail.PromotionAmount) - number(detail.AllocationAmount)
      if (invoice.RefId) row.invoiceIds.add(invoice.RefId)
      items.set(name, row)
    }
  }
  const overview = {
    invoiceCount: paid.length,
    cancelledCount: cancelled.length,
    revenue: round(revenue),
    averageOrderValue: paid.length ? round(revenue / paid.length) : 0,
    quantity: round(quantity, 4),
    basketSize: paid.length ? round(quantity / paid.length, 4) : 0,
    distinctItems: items.size,
  }
  return {
    overview,
    daily: [...daily].sort(([left], [right]) => left.localeCompare(right)).map(([date, row]) => ({ date, ...roundedRow(row) })),
    hourly: [...hourly].sort(([left], [right]) => left.localeCompare(right)).map(([hour, row]) => ({ hour, ...roundedRow(row) })),
    channels: [...channels].sort((a, b) => b[1].revenue - a[1].revenue).map(([name, row]) => ({ name, ...roundedRow(row) })),
    topItems: [...items].sort((a, b) => b[1].revenue - a[1].revenue).map(([name, row]) => ({
      name, quantity: round(row.quantity, 4), revenue: round(row.revenue), invoiceCount: row.invoiceIds.size,
    })),
  }
}

function bump(map: Map<string, { revenue: number; invoices: number }>, key: string, revenue: number) {
  const row = map.get(key) || { revenue: 0, invoices: 0 }
  row.invoices += 1
  row.revenue += revenue
  map.set(key, row)
}

function orderTypeLabel(value: unknown) {
  if (Number(value) === 1) return 'Tại nhà hàng'
  if (Number(value) === 2) return 'Mang về'
  if (Number(value) === 3) return 'Giao hàng (khác)'
  return 'Khác'
}

async function apiJson(label: string, url: string, options: RequestInit, attempt = 1): Promise<any> {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if ((!response.ok || body?.Success === false) && body?.ErrorType === 102 && attempt < 4) {
    await sleep(attempt * 1000)
    return apiJson(label, url, options, attempt + 1)
  }
  if (!response.ok || body?.Success === false) {
    const detail = typeof body?.ErrorMessage === 'string' ? body.ErrorMessage.slice(0, 240) : `HTTP ${response.status}`
    throw new Error(`${label} thất bại: ${detail}`)
  }
  return body
}

function validateDateRange(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new InputError('Ngày bắt đầu/kết thúc không hợp lệ.')
  const fromTime = new Date(`${from}T00:00:00+07:00`).getTime()
  const toTime = new Date(`${to}T23:59:59+07:00`).getTime()
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) throw new InputError('Khoảng ngày không hợp lệ.')
  if ((toTime - fromTime) / 86_400_000 > MAX_RANGE_DAYS) throw new InputError(`Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày.`)
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Máy chủ chưa cấu hình ${name}.`)
  return value
}

function roundedRow(row: { revenue: number; invoices: number }) { return { invoices: row.invoices, revenue: round(row.revenue) } }
function number(value: unknown) { const result = Number(value || 0); return Number.isFinite(result) ? result : 0 }
function round(value: number, digits = 2) { return Number(value.toFixed(digits)) }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)) }
class InputError extends Error {}
