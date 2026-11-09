import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ROOT = 'https://graphapi.cukcuk.vn'
const LIMIT = 100
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

for (const path of ['.env.local', '.env']) {
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const at = line.indexOf('=')
    const key = line.slice(0, at).trim()
    let value = line.slice(at + 1).trim()
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Thiếu biến môi trường: ${name}`)
  return value
}

const config = {
  domain: required('CUKCUK_DOMAIN'),
  appId: required('CUKCUK_APP_ID'),
  secret: required('CUKCUK_SECRET_KEY'),
}

function apiError(label, response, body) {
  const message = typeof body?.ErrorMessage === 'string' ? body.ErrorMessage.slice(0, 300) : response.statusText
  return new Error(`${label}: HTTP/Code=${body?.Code ?? response.status}, ErrorType=${body?.ErrorType ?? 'unknown'}, message=${message || 'không có'}`)
}

async function jsonRequest(label, url, options, attempt = 1) {
  const response = await fetch(url, options)
  let body
  try { body = await response.json() } catch { throw new Error(`${label}: phản hồi không phải JSON (HTTP ${response.status})`) }
  if ((!response.ok || body?.Success === false) && body?.ErrorType === 102 && attempt < 4) {
    await delay(attempt * 1000)
    return jsonRequest(label, url, options, attempt + 1)
  }
  if (!response.ok || body?.Success === false) throw apiError(label, response, body)
  return body
}

async function login() {
  const loginData = { AppID: config.appId, Domain: config.domain, LoginTime: new Date().toISOString() }
  const SignatureInfo = createHmac('sha256', config.secret).update(JSON.stringify(loginData), 'utf8').digest('hex')
  const result = await jsonRequest('Đăng nhập thất bại', `${ROOT}/api/Account/Login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...loginData, SignatureInfo }),
  })
  if (!result?.Data?.AccessToken || !result?.Data?.CompanyCode) throw new Error('Phản hồi đăng nhập thiếu token hoặc CompanyCode')
  return { token: result.Data.AccessToken, company: result.Data.CompanyCode }
}

const headers = ({ token, company }) => ({ Authorization: `Bearer ${token}`, CompanyCode: company, 'Content-Type': 'application/json' })

async function branches(session) {
  const result = await jsonRequest('Lấy chi nhánh thất bại', `${ROOT}/api/v1/branchs/all?includeInactive=false`, { method: 'GET', headers: headers(session) })
  if (!Array.isArray(result.Data)) throw new Error('Phản hồi chi nhánh không có mảng Data')
  return result.Data.filter((row) => !row.Inactive && !row.IsBaseDepot)
}

async function invoices(session, branchId, from, to) {
  const rows = []
  for (let page = 1; ; page += 1) {
    await delay(400)
    const result = await jsonRequest(`Lấy hóa đơn trang ${page} thất bại`, `${ROOT}/api/v1/sainvoices/paging-with-detail`, {
      method: 'POST', headers: headers(session), body: JSON.stringify({ BranchId: branchId, FromDate: from, ToDate: to, Page: page, Limit: LIMIT }),
    })
    if (!Array.isArray(result.Data)) throw new Error(`Trang ${page} không có mảng Data`)
    rows.push(...result.Data)
    if (result.Data.length < LIMIT || rows.length >= Number(result.Total || 0)) break
  }
  return rows
}

const n = (value) => Number(value || 0)
const rounded = (value, digits = 2) => Number(value.toFixed(digits))
const bump = (map, key, revenue) => {
  const row = map.get(key) || { invoices: 0, revenue: 0 }
  row.invoices += 1; row.revenue += revenue; map.set(key, row)
}
const rowsOf = (map) => Object.fromEntries([...map].map(([key, value]) => [key, { invoices: value.invoices, revenue: rounded(value.revenue) }]))

function summarize(all) {
  const paid = all.filter((row) => n(row.PaymentStatus) === 3 && !row.CancelDate)
  const cancelled = all.filter((row) => n(row.PaymentStatus) === 4 || Boolean(row.CancelDate))
  const daily = new Map(), hourly = new Map(), types = new Map(), partners = new Map(), items = new Map(), channelSignals = new Map(), paymentMethods = new Map()
  let quantity = 0, childQuantity = 0
  for (const invoice of paid) {
    const revenue = n(invoice.TotalAmount)
    bump(daily, String(invoice.RefDate || '').slice(0, 10), revenue)
    bump(hourly, String(invoice.RefDate || '').match(/T(\d{2}):/)?.[1] ?? 'unknown', revenue)
    bump(types, String(invoice.OrderType ?? 'null'), revenue)
    bump(partners, invoice.DeliveryPartnerName || '(trống)', revenue)
    const topDetails = (invoice.SAInvoiceDetails || []).filter((detail) => !detail.ParentID)
    const daCount = topDetails.filter((detail) => /^\s*DA\s*-/i.test(detail.ItemName || '')).length
    const signal = `type=${invoice.OrderType ?? 'null'}|table=${invoice.TableName ? 'yes' : 'no'}|partner=${invoice.DeliveryPartnerName || '(trống)'}|anyDA=${daCount > 0 ? 'yes' : 'no'}|allDA=${topDetails.length > 0 && daCount === topDetails.length ? 'yes' : 'no'}`
    bump(channelSignals, signal, revenue)
    for (const payment of invoice.SAInvoicePayments || []) {
      const method = payment.PaymentMethodName || payment.PaymentName || payment.PaymentMethod || `(type:${payment.PaymentType ?? 'unknown'})`
      bump(paymentMethods, String(method), n(payment.Amount || payment.PaymentAmount))
    }
    for (const detail of invoice.SAInvoiceDetails || []) {
      if (detail.ParentID) { childQuantity += n(detail.Quantity); continue }
      quantity += n(detail.Quantity)
      const name = detail.ItemName || '(không tên)'
      const row = items.get(name) || { quantity: 0, revenue: 0, revenueAmount: 0, rawAmount: 0 }
      row.quantity += n(detail.Quantity)
      row.revenue += n(detail.Amount) - n(detail.PromotionAmount) - n(detail.AllocationAmount)
      row.revenueAmount += n(detail.RevenueAmount)
      row.rawAmount += n(detail.Amount)
      items.set(name, row)
    }
  }
  const sum = (field) => paid.reduce((total, row) => total + n(row[field]), 0)
  return {
    allInvoices: all.length, paidInvoices: paid.length, cancelledInvoices: cancelled.length,
    amountCandidates: {
      TotalAmount: rounded(sum('TotalAmount')), ReceiveAmount: rounded(sum('ReceiveAmount')),
      ReturnAmount: rounded(sum('ReturnAmount')), NetReceived: rounded(sum('ReceiveAmount') - sum('ReturnAmount')),
      SaleAmount: rounded(sum('SaleAmount')), TotalItemAmountAfterTax: rounded(sum('TotalItemAmountAfterTax')),
    },
    averageTotalAmount: paid.length ? rounded(sum('TotalAmount') / paid.length) : 0,
    topLevelQuantity: rounded(quantity, 4), childQuantityExcluded: rounded(childQuantity, 4),
    basketSize: paid.length ? rounded(quantity / paid.length, 4) : 0, distinctTopLevelItems: items.size,
    daily: rowsOf(daily), hourly: rowsOf(hourly), orderTypes: rowsOf(types), deliveryPartners: rowsOf(partners), channelSignals: rowsOf(channelSignals), paymentMethods: rowsOf(paymentMethods),
    topItems: [...items].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 20)
      .map(([name, row]) => ({ name, quantity: rounded(row.quantity, 4), revenue: rounded(row.revenue), revenueAmount: rounded(row.revenueAmount), rawAmount: rounded(row.rawAmount) })),
    observedFields: [...new Set(paid.flatMap((row) => Object.keys(row)))].sort(),
    observedDetailFields: [...new Set(paid.flatMap((row) => (row.SAInvoiceDetails || []).flatMap((detail) => Object.keys(detail))))].sort(),
  }
}

function compactSummary(all) {
  const summary = summarize(all)
  return {
    allInvoices: summary.allInvoices,
    paidInvoices: summary.paidInvoices,
    cancelledInvoices: summary.cancelledInvoices,
    amountCandidates: summary.amountCandidates,
    averageTotalAmount: summary.averageTotalAmount,
    topLevelQuantity: summary.topLevelQuantity,
    childQuantityExcluded: summary.childQuantityExcluded,
    basketSize: summary.basketSize,
    distinctTopLevelItems: summary.distinctTopLevelItems,
    daily: summary.daily,
    hourly: summary.hourly,
    orderTypes: summary.orderTypes,
    deliveryPartners: summary.deliveryPartners,
    channelSignals: summary.channelSignals,
    paymentMethods: summary.paymentMethods,
    topItems: summary.topItems,
  }
}

function dateRange(from, to) {
  const dates = []
  for (let date = new Date(`${from}T00:00:00Z`); date <= new Date(`${to}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

async function main() {
  const full = process.argv.includes('--full')
  const compact = process.argv.includes('--compact')
  const dashboardSnapshot = process.argv.includes('--dashboard-snapshot')
  const snapshotCutoff = new Date('2026-10-26T10:57:18+07:00').getTime()
  const session = await login()
  if (!compact) console.log(JSON.stringify({ stage: 'login', success: true }))
  const allBranches = await branches(session)
  if (!compact) console.log(JSON.stringify({ stage: 'branches', count: allBranches.length, branches: allBranches.map(({ Id, Code, Name }) => ({ id: Id, code: Code, name: Name })) }, null, 2))
  if (!allBranches.length) throw new Error('Không tìm thấy chi nhánh hoạt động')
  const selected = full ? allBranches : allBranches.slice(0, 1)
  const from = full ? '2026-10-01' : '2026-10-24', to = '2026-10-26', results = [], combined = []
  for (const branch of selected) {
    let data = await invoices(session, branch.Id, from, to)
    if (dashboardSnapshot) data = data.filter((row) => new Date(row.RefDate).getTime() <= snapshotCutoff)
    combined.push(...data)
    results.push({ branch: { id: branch.Id, code: branch.Code, name: branch.Name }, summary: compact ? compactSummary(data) : summarize(data) })
    if (!compact) console.log(JSON.stringify({ stage: 'branch-complete', branch: branch.Name, invoiceCount: data.length }))
  }
  if (compact) {
    const dates = dateRange(from, to)
    const branchRows = results.map(({ branch, summary }) => ({
      code: branch.code, name: branch.name, allInvoices: summary.allInvoices, paidInvoices: summary.paidInvoices,
      cancelledInvoices: summary.cancelledInvoices, revenue: summary.amountCandidates.TotalAmount,
      emptyDates: dates.filter((date) => !summary.daily[date]),
    }))
    const timeline26 = combined
      .filter((row) => n(row.PaymentStatus) === 3 && !row.CancelDate && String(row.RefDate || '').startsWith('2026-10-26'))
      .sort((a, b) => String(a.RefDate).localeCompare(String(b.RefDate)))
      .map((row) => ({
        time: String(row.RefDate || ''), branchId: row.BranchId, amount: n(row.TotalAmount), orderType: row.OrderType,
        deliveryPartner: row.DeliveryPartnerName || '(trống)',
        quantity: (row.SAInvoiceDetails || []).filter((detail) => !detail.ParentID).reduce((sum, detail) => sum + n(detail.Quantity), 0),
      }))
    let cumulativeInvoices = 0, cumulativeRevenue = 0, cumulativeQuantity = 0
    for (const row of timeline26) {
      cumulativeInvoices += 1; cumulativeRevenue += row.amount; cumulativeQuantity += row.quantity
      row.cumulativeInvoices = cumulativeInvoices; row.cumulativeRevenue = cumulativeRevenue; row.cumulativeQuantity = cumulativeQuantity
    }
    console.log(JSON.stringify({ stage: 'compact-result', period: { from, to }, dashboardSnapshot, snapshotCutoff: dashboardSnapshot ? '2026-10-26T10:57:18+07:00' : null, branchCount: selected.length, branches: branchRows, timeline26, total: compactSummary(combined) }, null, 2))
    return
  }
  console.log(JSON.stringify({ stage: full ? 'full-result' : 'sample-result', period: { from, to }, results }, null, 2))
}

main().catch((error) => { console.error(JSON.stringify({ success: false, error: error?.message || String(error) })); process.exitCode = 1 })
