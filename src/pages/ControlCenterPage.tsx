import { useEffect, useMemo, useRef, useState } from 'react'
import { baseConfiguredProducts, hasMenuRecipe, productById, PROCESS_OUTPUT_OPTIONS_BY_INPUT } from '../lib/constants'
import { createId, downloadBlob } from '../lib/browser'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import { fetchConfiguredBranchRows, hardDeleteConfiguredBranch, readConfiguredBranchRows, syncConfiguredBranchRows, writeConfiguredBranchRows, type ConfigBranch } from '../lib/branches'
import { deleteConfiguredProduct, fetchConfiguredProducts, syncConfiguredProducts } from '../lib/products'
import { formatQuantity } from '../lib/inventoryEntry'
import { ensureDefaultWorkShifts } from '../lib/attendance'
import { shouldUseLanApi, supabase } from '../lib/supabase'
import type { AppUser, Product, ProductRecipeLine, Role } from '../types'

type ControlTab = 'masterdata' | 'permissions' | 'reconciliation' | 'audit' | 'cleanup'

const CLEANUP_TARGETS = [
  { id: 'sales', label: 'Hóa đơn bán hàng (POS)', hint: 'sales_receipts + chi tiết' },
  { id: 'ledger', label: 'Bàn giao ca', hint: 'nhận ca + chốt tồn' },
  { id: 'stock', label: 'Kho / phiếu nhập xuất', hint: 'stock_movements' },
  { id: 'reports', label: 'Báo cáo & ngày vận hành', hint: 'report_snapshots + operation_days' },
  { id: 'requests', label: 'Đặt hàng / yêu cầu bếp', hint: 'supply_requests' },
  { id: 'attendance', label: 'Chấm công & đăng ký ca', hint: 'attendance + shift_registrations' },
  { id: 'kpi', label: 'KPI nhân viên', hint: 'employee_kpi_targets + payroll_kpi_metrics' },
  { id: 'history', label: 'Lịch sử thao tác', hint: 'audit log + nhật ký đối soát cục bộ' },
] as const
type PermissionAction = 'view' | 'add' | 'edit' | 'delete' | 'export' | 'approve' | 'config'
type PermissionRole = Exclude<Role, 'admin'>

interface ConfigProduct extends Product {
  price: number
  active: boolean
  source: 'system' | 'custom'
}

interface MenuRecipeDraftLine {
  id: string
  productId: string
  quantity: string
}

interface LotteLine {
  id: string
  branchId: string
  businessDate: string
  orderCode: string
  lotteBillCode: string
  quantity: number
  amount: number
  note: string
  resolved: boolean
  createdAt: string
}

interface AuditEntry {
  id: string
  actorId: string
  actorName: string
  module: string
  action: string
  detail: string
  before?: string
  after?: string
  reason?: string
  createdAt: string
}

const ACTIONS: Array<{ id: PermissionAction; label: string }> = [
  { id: 'view', label: 'Xem' },
  { id: 'add', label: 'Thêm' },
  { id: 'edit', label: 'Sửa' },
  { id: 'delete', label: 'Xóa' },
  { id: 'export', label: 'Xuất' },
  { id: 'approve', label: 'Duyệt' },
  { id: 'config', label: 'Cấu hình' },
]

const MODULES = [
  { id: 'dashboard', label: 'Tổng quan' },
  { id: 'pos', label: 'POS bán hàng' },
  { id: 'inventory', label: 'Kho' },
  { id: 'handover', label: 'Bàn giao ca' },
  { id: 'report', label: 'Báo cáo cuối ca' },
  { id: 'kitchen', label: 'Bếp' },
  { id: 'orders', label: 'Đặt hàng' },
  { id: 'attendance', label: 'Chấm công' },
  { id: 'schedule', label: 'Lịch làm' },
  { id: 'payroll', label: 'Lương' },
  { id: 'commission', label: 'Hoa hồng' },
  { id: 'accounts', label: 'Nhân sự' },
  { id: 'masterdata', label: 'Dữ liệu nền' },
  { id: 'reconciliation', label: 'Đối soát Lotte' },
  { id: 'audit', label: 'Nhật ký thao tác' },
] as const

const ROLE_LABELS: Record<PermissionRole, string> = {
  manager: 'Quản lý',
  supmt: 'Giám sát (SUP MT)',
  shift_leader: 'Ca trưởng',
  staff: 'Nhân viên bán hàng',
  cashier: 'Thu ngân POS',
  kitchen: 'Bếp',
}

export function ControlCenterPage({ user }: { user: AppUser }) {
  const [tab, setTab] = useState<ControlTab>('masterdata')
  const [products, setProducts] = useState<ConfigProduct[]>(loadProducts)
  const [branches, setBranches] = useState<ConfigBranch[]>(loadBranches)
  const [permissions, setPermissions] = useState(loadPermissions)
  const [lotteLines, setLotteLines] = useState<LotteLine[]>(loadLotteLines)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>(loadAuditEntries)
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [branchId, setBranchId] = useState(user.branchId)
  const [from, setFrom] = useState(monthRange().from)
  const [to, setTo] = useState(monthRange().to)
  const todayKey = localDateKey()
  const cleanupMaxDate = previousDateKey(todayKey)
  const [productDraft, setProductDraft] = useState({
    sku: '',
    name: '',
    category: 'raw' as Product['category'],
    unit: 'kg',
    lowStock: '5',
    inboundUnit: '',
    inboundPackSize: '',
    orderSpecificationHint: '',
  })
  const [editingProductId, setEditingProductId] = useState('')
  const [menuDraft, setMenuDraft] = useState({
    sku: '',
    name: '',
    unit: 'túi',
    price: '0',
    sourceProductId: 'chestnut-cooked-kg',
    sourceQuantity: '',
    packagingProductId: '',
    packagingQuantity: '1',
  })
  const [editingMenuId, setEditingMenuId] = useState('')
  const [menuRecipeDrafts, setMenuRecipeDrafts] = useState<MenuRecipeDraftLine[]>([
    { id: createId(), productId: '', quantity: '' },
  ])
  const [branchDraft, setBranchDraft] = useState({ id: '', name: '', address: '', manager: '' })
  const [lotteDraft, setLotteDraft] = useState({
    orderCode: '',
    lotteBillCode: '',
    quantity: '1',
    amount: '0',
    note: '',
  })
  const [cleanupTargets, setCleanupTargets] = useState<string[]>(['sales', 'ledger', 'stock', 'reports', 'attendance', 'kpi'])
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupResult, setCleanupResult] = useState('')
  const [masterFeedback, setMasterFeedback] = useState('')
  const lowStockSyncTimer = useRef<number | undefined>(undefined)

  const branchOptions = branches.filter((branch) => branch.active)
  const filteredLotteLines = lotteLines.filter((line) =>
    line.branchId === branchId
    && line.businessDate >= from
    && line.businessDate <= to,
  )
  const reconciliationRows = buildReconciliationRows(receipts, filteredLotteLines)
  const mismatchCount = reconciliationRows.filter((row) => row.status !== 'matched' && row.status !== 'resolved').length
  const lowStockConfigured = products.filter((product) => product.active && product.lowStock > 0).length
  const customProductCount = products.filter((product) => product.source === 'custom').length
  const activeBranches = branches.filter((branch) => branch.active)
  const customBranchCount = activeBranches.filter((branch) => branch.source === 'custom').length
  const stockProducts = products.filter((product) => !isMenuProduct(product))
  const menuProducts = products.filter(isMenuProduct)
  // Món đang bán nhưng chưa gán công thức: POS vẫn cho bán (không được chặn doanh
  // thu của quầy), nhưng hóa đơn đó KHÔNG trừ được kho nên tồn sẽ cao hơn thực tế.
  // Admin phải thấy ngay danh sách này để bổ sung công thức.
  const menuWithoutRecipe = menuProducts.filter((product) =>
    product.active !== false && !hasMenuRecipe(product),
  )
  // Thành phẩm nguồn để "gán món trừ thành phẩm": thành phẩm rời (kg) + thành phẩm
  // là ĐẦU RA của chế biến (vd Bánh hạt dẻ thành phẩm `cake-ready`, đơn vị "cái").
  // Trước đây lọc cứng `!isMenuProduct` nên thành phẩm theo cái (như bánh hạt dẻ)
  // bị loại khỏi picker → user không gán được món trừ thành phẩm, phải trừ NVL.
  const processOutputIds = useMemo(() => {
    const ids = new Set<string>()
    Object.values(PROCESS_OUTPUT_OPTIONS_BY_INPUT).forEach((outputs) => outputs.forEach((id) => ids.add(id)))
    return ids
  }, [])
  const recipeSourceProducts = products.filter((product) =>
    product.active !== false
    && product.category === 'finished'
    && (!isMenuProduct(product) || processOutputIds.has(product.id)),
  )
  const recipePackagingProducts = products.filter((product) =>
    product.active !== false && product.category === 'packaging',
  )
  const recipeIngredientProducts = products.filter((product) =>
    product.active !== false
    && !isMenuProduct(product)
    && (product.category === 'raw' || product.category === 'finished'),
  )

  useEffect(() => {
    void fetchConfiguredBranchRows(user)
      .then(setBranches)
      .catch(() => {})
  }, [user.id, user.authToken])

  useEffect(() => {
    void refreshControlCloudData()
  }, [user.id, user.authToken, branchId, from, to])

  useEffect(() => {
    if (tab !== 'cleanup') return
    if (from > cleanupMaxDate) setFrom(cleanupMaxDate)
    if (to > cleanupMaxDate) setTo(cleanupMaxDate)
  }, [cleanupMaxDate, from, tab, to])

  async function refreshControlCloudData() {
    if (!supabase || shouldUseLanApi(user)) return
    await Promise.all([
      fetchCloudPermissions(),
      fetchCloudLotteLines(),
      fetchCloudAuditEntries(),
      fetchSalesReceiptsRange(user, { branchIds: [branchId], from, to }).then(setReceipts),
    ]).catch((error) => {
      setMasterFeedback(error instanceof Error ? error.message : 'Không thể tải dữ liệu thiết lập từ Supabase.')
    })
  }

  async function fetchCloudPermissions() {
    const { data, error } = await supabase!
      .from('control_permission_matrix')
      .select('role,module_id,actions')
    if (error) throw error
    const next = loadPermissions()
    ;(data || []).forEach((row: any) => {
      const role = row.role as PermissionRole
      if (!next[role]) return
      next[role] = {
        ...next[role],
        [row.module_id]: Array.isArray(row.actions) ? row.actions : [],
      }
    })
    setPermissions(next)
  }

  async function fetchCloudLotteLines() {
    const { data, error } = await supabase!
      .from('lotte_reconciliation_lines')
      .select('*')
      .eq('branch_id', branchId)
      .gte('business_date', from)
      .lte('business_date', to)
      .order('created_at', { ascending: false })
    if (error) throw error
    setLotteLines((data || []).map(mapLotteLine))
  }

  async function fetchCloudAuditEntries() {
    const { data, error } = await supabase!
      .from('control_audit_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) throw error
    setAuditEntries((data || []).map(mapAuditEntry))
  }

  useEffect(() => {
    // Kéo menu/SKU từ cloud, đồng thời đẩy các món custom mới có trên máy này lên
    // để các thiết bị khác thấy ngay (menu không còn phụ thuộc localStorage từng máy).
    let cancelled = false
    void fetchConfiguredProducts(user)
      .then(async (merged) => {
        if (cancelled) return
        setProducts(merged as ConfigProduct[])
        await syncConfiguredProducts(user, merged).catch(() => {})
      })
      .catch(() => {
        setMasterFeedback('Không tải được danh mục từ Supabase — đang dùng bản trên máy này.')
      })
    return () => { cancelled = true }
  }, [user.id, user.authToken])

  function writeAudit(entry: Omit<AuditEntry, 'id' | 'actorId' | 'actorName' | 'createdAt'>) {
    const nextEntry: AuditEntry = {
      ...entry,
      id: createId(),
      actorId: user.id,
      actorName: user.name,
      createdAt: new Date().toISOString(),
    }
    setAuditEntries((current) => [nextEntry, ...current].slice(0, 300))
    if (supabase && !shouldUseLanApi(user)) {
      void supabase.from('control_audit_entries').insert({
        id: nextEntry.id,
        actor_id: nextEntry.actorId,
        actor_name: nextEntry.actorName,
        module: nextEntry.module,
        action: nextEntry.action,
        detail: nextEntry.detail,
        before_value: nextEntry.before || null,
        after_value: nextEntry.after || null,
        reason: nextEntry.reason || null,
        created_at: nextEntry.createdAt,
      }).then(({ error }) => {
        if (error) setMasterFeedback(error.message)
      })
    }
  }

  function saveProducts(next: ConfigProduct[], detail: string) {
    setProducts(next)
    void syncConfiguredProducts(user, next)
      .then(() => setMasterFeedback(`${detail} — đã đồng bộ tới mọi thiết bị.`))
      .catch((error) => {
        setMasterFeedback(error instanceof Error
          ? `Đã lưu trên máy này nhưng chưa đồng bộ được lên cloud: ${error.message}`
          : 'Đã lưu trên máy này nhưng chưa đồng bộ được lên cloud.')
      })
    writeAudit({ module: 'Dữ liệu nền', action: 'Cập nhật SKU', detail })
  }

  function saveBranches(next: ConfigBranch[], detail: string) {
    const canonicalNext = canonicalizeControlBranches(next)
    const removed = branches
      .filter((branch) => !canonicalNext.some((item) => item.id === branch.id))
      .map((branch) => ({ ...branch, active: false }))
    setBranches(canonicalNext)
    writeConfiguredBranchRows(canonicalNext)
    void syncConfiguredBranchRows(user, [...canonicalNext, ...removed]).catch((error) => {
      window.alert(error instanceof Error ? error.message : 'Không thể đồng bộ danh sách chi nhánh.')
    })
    writeAudit({ module: 'Dữ liệu nền', action: 'Cập nhật chi nhánh', detail })
  }

  function saveProduct(event: React.FormEvent) {
    event.preventDefault()
    const sku = productDraft.sku.trim().toUpperCase()
    const name = productDraft.name.trim()
    if (!sku || !name) return
    const clash = products.find((item) => item.id !== editingProductId && item.sku.trim().toUpperCase() === sku)
    if (clash) {
      setMasterFeedback(`Mã SKU ${sku} đã tồn tại trong kho hệ thống (${clash.name}). Dùng mã khác hoặc sửa SKU sẵn có để tránh lệch danh mục kho.`)
      return
    }
    const editingProduct = editingProductId ? products.find((item) => item.id === editingProductId) : undefined
    const unit = productDraft.unit.trim() || 'cái'
    const inboundPackSize = Number(productDraft.inboundPackSize) || 0
    const product: ConfigProduct = {
      ...(editingProduct || {}),
      id: editingProduct?.id || `custom-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-') || createId()}`,
      sku,
      name,
      category: productDraft.category,
      unit,
      lowStock: Number(productDraft.lowStock) || 0,
      price: editingProduct?.price || 0,
      active: editingProduct?.active ?? true,
      source: editingProduct?.source || 'custom',
      inboundUnit: productDraft.inboundUnit.trim() || undefined,
      inboundPackKg: unit === 'kg' && inboundPackSize > 0 ? inboundPackSize : undefined,
      inboundPackQuantity: unit !== 'kg' && inboundPackSize > 0 ? inboundPackSize : undefined,
      orderSpecificationHint: productDraft.orderSpecificationHint.trim() || undefined,
    }
    const next = editingProduct
      ? products.map((item) => item.id === editingProduct.id ? product : item)
      : [product, ...products]
    saveProducts(next, `${editingProduct ? 'Sửa' : 'Thêm'} SKU ${sku} - ${name}`)
    resetProductDraft()
  }

  function resetProductDraft() {
    setEditingProductId('')
    setProductDraft({ sku: '', name: '', category: 'raw', unit: 'kg', lowStock: '5', inboundUnit: '', inboundPackSize: '', orderSpecificationHint: '' })
  }

  function editProduct(product: ConfigProduct) {
    setEditingProductId(product.id)
    setProductDraft({
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      lowStock: String(product.lowStock || 0),
      inboundUnit: product.inboundUnit || '',
      inboundPackSize: product.inboundPackKg ? String(product.inboundPackKg) : product.inboundPackQuantity ? String(product.inboundPackQuantity) : '',
      orderSpecificationHint: product.orderSpecificationHint || '',
    })
    setMasterFeedback(`Đang sửa SKU ${product.sku}. Giữ nguyên mã nếu SKU đã có giao dịch kho.`)
  }

  function saveMenuItem(event: React.FormEvent) {
    event.preventDefault()
    const sku = menuDraft.sku.trim().toUpperCase()
    const name = menuDraft.name.trim()
    const price = Number(cleanMoneyInput(menuDraft.price)) || 0
    const sourceQuantity = Number(menuDraft.sourceQuantity) || 0
    const packagingQuantity = Number(menuDraft.packagingQuantity) || 0
    if (!sku || !name) {
      setMasterFeedback('Món mới cần đủ mã món và tên món.')
      return
    }
    if (price <= 0) {
      setMasterFeedback('Món mới phải có giá bán lớn hơn 0 để POS tính doanh thu.')
      return
    }
    const skuClash = products.find((item) => item.id !== editingMenuId && item.sku.trim().toUpperCase() === sku)
    if (skuClash) {
      setMasterFeedback(`Mã món ${sku} trùng với ${skuClash.name} trong kho hệ thống. Sửa món đó thay vì tạo mã trùng để không lệch danh mục kho.`)
      return
    }
    const hasSource = Boolean(menuDraft.sourceProductId) && sourceQuantity > 0
    const hasIngredient = menuRecipeDrafts.some((line) => line.productId && Number(line.quantity) > 0)
    if (!hasSource && !hasIngredient) {
      setMasterFeedback('Món mới bắt buộc chọn nguyên vật liệu: chọn thành phẩm nguồn kèm lượng/món, hoặc thêm ít nhất một dòng NVL, để hệ thống trừ được tồn kho khi bán.')
      return
    }
    const recipe = mergeRecipeLines([
      ...(menuDraft.sourceProductId && sourceQuantity > 0
        ? [{ productId: menuDraft.sourceProductId, quantity: sourceQuantity, role: 'source' as const }]
        : []),
      ...(menuDraft.packagingProductId && packagingQuantity > 0
        ? [{ productId: menuDraft.packagingProductId, quantity: packagingQuantity, role: 'packaging' as const }]
        : []),
      ...menuRecipeDrafts
        .map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity) || 0,
          role: 'ingredient' as const,
        }))
        .filter((line) => line.productId && line.quantity > 0),
    ])
    const editingProduct = editingMenuId ? products.find((item) => item.id === editingMenuId) : undefined
    const product: ConfigProduct = {
      ...(editingProduct || {}),
      id: editingProduct?.id || `custom-menu-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-') || createId()}`,
      sku,
      name,
      category: 'finished',
      unit: menuDraft.unit.trim() || 'túi',
      lowStock: 0,
      price,
      active: editingProduct?.active ?? true,
      source: editingProduct?.source || 'custom',
      weightKg: sourceQuantity || undefined,
      countsForYield: true,
      recipe,
    }
    const next = editingProduct
      ? products.map((item) => item.id === editingProduct.id ? product : item)
      : [product, ...products]
    saveProducts(next, `${editingProduct ? 'Sửa' : 'Thêm'} món menu ${sku} - ${name}`)
    resetMenuDraft()
  }

  function resetMenuDraft() {
    setEditingMenuId('')
    setMenuDraft({
      sku: '',
      name: '',
      unit: 'túi',
      price: '0',
      sourceProductId: recipeSourceProducts[0]?.id || 'chestnut-cooked-kg',
      sourceQuantity: '',
      packagingProductId: '',
      packagingQuantity: '1',
    })
    setMenuRecipeDrafts([{ id: createId(), productId: '', quantity: '' }])
  }

  function editMenuItem(product: ConfigProduct) {
    const sourceLine = product.recipe?.find((line) => line.role === 'source')
    const packagingLine = product.recipe?.find((line) => line.role === 'packaging')
    const ingredientLines = product.recipe?.filter((line) => line.role === 'ingredient') || []
    setEditingMenuId(product.id)
    setMenuDraft({
      sku: product.sku,
      name: product.name,
      unit: product.unit || 'túi',
      price: String(product.price || 0),
      sourceProductId: sourceLine?.productId || '',
      sourceQuantity: sourceLine?.quantity ? String(sourceLine.quantity) : '',
      packagingProductId: packagingLine?.productId || '',
      packagingQuantity: packagingLine?.quantity ? String(packagingLine.quantity) : '1',
    })
    setMenuRecipeDrafts(ingredientLines.length
      ? ingredientLines.map((line) => ({ id: createId(), productId: line.productId, quantity: String(line.quantity) }))
      : [{ id: createId(), productId: '', quantity: '' }],
    )
    setMasterFeedback(`Đang sửa món ${product.name}. Bấm Lưu món để đồng bộ sang nhân viên.`)
  }

  function updateMenuRecipeDraft(lineId: string, patch: Partial<MenuRecipeDraftLine>) {
    setMenuRecipeDrafts((lines) => lines.map((line) => line.id === lineId ? { ...line, ...patch } : line))
  }

  function addMenuRecipeDraft() {
    setMenuRecipeDrafts((lines) => [...lines, { id: createId(), productId: recipeIngredientProducts[0]?.id || '', quantity: '' }])
  }

  function removeMenuRecipeDraft(lineId: string) {
    setMenuRecipeDrafts((lines) => lines.length === 1
      ? [{ id: lines[0].id, productId: '', quantity: '' }]
      : lines.filter((line) => line.id !== lineId))
  }

  async function addBranch(event: React.FormEvent) {
    event.preventDefault()
    const id = branchSlug(branchDraft.id || branchDraft.name)
    const name = branchDraft.name.trim()
    if (!id || !name) return
    const branch: ConfigBranch = {
      id,
      name,
      address: branchDraft.address.trim(),
      manager: branchDraft.manager.trim(),
      active: true,
      source: 'custom',
    }
    const existing = branches.find((item) => item.id === id)
    const next = existing
      ? branches.map((item) => item.id === id ? { ...item, ...branch, source: item.source, active: true } : item)
      : [branch, ...branches]
    saveBranches(next, `${existing ? 'Mở lại/cập nhật' : 'Thêm'} chi nhánh ${name}`)
    setBranchDraft({ id: '', name: '', address: '', manager: '' })
    try {
      await ensureDefaultWorkShifts(user, branch)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không thể đồng bộ chi nhánh và khung ca mặc định.')
    }
  }

  function toggleProduct(productId: string) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    saveProducts(
      products.map((item) => item.id === productId ? { ...item, active: !item.active } : item),
      `${product.active ? 'Tạm ngưng' : 'Mở bán'} SKU ${product.sku}`,
    )
  }

  function deleteProduct(productId: string) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    const label = isMenuProduct(product) ? `món ${product.name}` : `SKU ${product.sku}`
    const usedByMenus = products.filter((item) => item.id !== productId && item.recipe?.some((line) => line.productId === productId))
    const isSystem = product.source === 'system'
    if (isSystem || usedByMenus.length) {
      const reasons: string[] = []
      if (isSystem) reasons.push('đây là SKU gốc trong danh mục kho hệ thống — tồn kho, nhập hàng, chế biến và POS tham chiếu trực tiếp')
      if (usedByMenus.length) reasons.push(`đang là nguyên vật liệu của ${usedByMenus.length} món: ${usedByMenus.map((item) => item.name).join(', ')}`)
      if (!window.confirm(`⚠ KHÔNG NÊN XÓA ${label} vì ${reasons.join('; ')}.\n\nXóa có thể làm lệch tồn kho và đứt liên kết bán hàng. Nếu chỉ muốn ngừng dùng, hãy bấm "Tạm ngưng".\n\nVẫn muốn xóa vĩnh viễn?`)) return
      if (!window.confirm(`Xác nhận lần cuối: xóa ${label} khỏi hệ thống?`)) return
    } else if (!window.confirm(`Xóa ${label}?`)) {
      return
    }
    saveProducts(products.filter((item) => item.id !== productId), `Xóa ${label}`)
    void deleteConfiguredProduct(user, productId, product).catch((error) => {
      setMasterFeedback(error instanceof Error ? error.message : 'Không thể xóa món trên Supabase.')
    })
  }

  function updateLowStock(productId: string, value: string) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    const lowStock = Number(value) || 0
    const next = products.map((item) => item.id === productId ? { ...item, lowStock } : item)
    setProducts(next)
    window.dispatchEvent(new CustomEvent('gustino-products-updated'))
    window.clearTimeout(lowStockSyncTimer.current)
    lowStockSyncTimer.current = window.setTimeout(() => {
      void syncConfiguredProducts(user, next).catch((error) => {
        setMasterFeedback(error instanceof Error
          ? `Chưa đồng bộ được ngưỡng tồn thấp lên cloud: ${error.message}`
          : 'Chưa đồng bộ được ngưỡng tồn thấp lên cloud.')
      })
    }, 800)
  }

  function toggleBranch(branchIdToToggle: string) {
    const branch = branches.find((item) => item.id === branchIdToToggle)
    if (!branch) return
    saveBranches(
      branches.map((item) => item.id === branchIdToToggle ? { ...item, active: !item.active } : item),
      `${branch.active ? 'Tạm ngưng' : 'Mở lại'} chi nhánh ${branch.name}`,
    )
  }

  async function deleteBranch(branchIdToDelete: string) {
    const branch = branches.find((item) => item.id === branchIdToDelete)
    if (!branch) return
    if (!window.confirm(`XÓA VĨNH VIỄN chi nhánh ${branch.name}? Tài khoản nhân viên, lịch làm, ca, kho, bán hàng và báo cáo thuộc chi nhánh này sẽ bị xóa khỏi hệ thống.`)) return
    if (!window.confirm('Dữ liệu chi nhánh đã xóa sẽ không thể khôi phục. Bạn chắc chắn tiếp tục?')) return
    try {
      await hardDeleteConfiguredBranch(user, branchIdToDelete)
      const next = branches.filter((item) => item.id !== branchIdToDelete)
      setBranches(next)
      writeConfiguredBranchRows(next)
      if (branchId === branchIdToDelete) setBranchId(next.find((item) => item.active)?.id || user.branchId)
      setMasterFeedback(`Đã xóa vĩnh viễn chi nhánh ${branch.name}.`)
      writeAudit({ module: 'Dữ liệu nền', action: 'Xóa chi nhánh', detail: `Xóa vĩnh viễn ${branch.name}` })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không thể xóa chi nhánh.')
    }
  }

  function togglePermission(role: PermissionRole, moduleId: string, action: PermissionAction) {
    setPermissions((current) => {
      const roleMatrix = current[role] || {}
      const selected = new Set(roleMatrix[moduleId] || [])
      if (selected.has(action)) selected.delete(action)
      else selected.add(action)
      const next = {
        ...current,
        [role]: {
          ...roleMatrix,
          [moduleId]: Array.from(selected),
        },
      }
      if (supabase && !shouldUseLanApi(user)) {
        void supabase.from('control_permission_matrix').upsert({
          role,
          module_id: moduleId,
          actions: next[role][moduleId],
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'role,module_id' }).then(({ error }) => {
          if (error) setMasterFeedback(error.message)
        })
      }
      return next
    })
  }

  function savePermissionAudit() {
    writeAudit({ module: 'Phân quyền', action: 'Lưu ma trận quyền', detail: 'Cập nhật quyền Xem/Thêm/Sửa/Xóa/Xuất/Duyệt/Cấu hình theo vai trò.' })
  }

  async function addLotteLine(event: React.FormEvent) {
    event.preventDefault()
    const line: LotteLine = {
      id: createId(),
      branchId,
      businessDate: from,
      orderCode: lotteDraft.orderCode.trim(),
      lotteBillCode: lotteDraft.lotteBillCode.trim(),
      quantity: Number(lotteDraft.quantity) || 0,
      amount: Number(cleanMoneyInput(lotteDraft.amount)) || 0,
      note: lotteDraft.note.trim(),
      resolved: false,
      createdAt: new Date().toISOString(),
    }
    if (!line.orderCode || !line.lotteBillCode) return
    if (supabase && !shouldUseLanApi(user)) {
      const { error } = await supabase.from('lotte_reconciliation_lines').insert({
        id: line.id,
        branch_id: line.branchId,
        business_date: line.businessDate,
        order_code: line.orderCode,
        lotte_bill_code: line.lotteBillCode,
        quantity: line.quantity,
        amount: line.amount,
        note: line.note,
        resolved: false,
        created_by: user.id,
        created_at: line.createdAt,
        updated_by: user.id,
        updated_at: line.createdAt,
      })
      if (error) {
        setMasterFeedback(error.message)
        return
      }
    }
    setLotteLines((current) => [line, ...current])
    writeAudit({ module: 'Đối soát Lotte', action: 'Thêm bill Lotte', detail: `${line.orderCode} / ${line.lotteBillCode}` })
    setLotteDraft({ orderCode: '', lotteBillCode: '', quantity: '1', amount: '0', note: '' })
  }

  async function resolveLotteLine(lineId: string) {
    const line = lotteLines.find((item) => item.id === lineId)
    const next = lotteLines.map((item) => item.id === lineId ? { ...item, resolved: !item.resolved } : item)
    const updated = next.find((item) => item.id === lineId)
    if (supabase && !shouldUseLanApi(user) && updated) {
      const { error } = await supabase
        .from('lotte_reconciliation_lines')
        .update({ resolved: updated.resolved, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', lineId)
      if (error) {
        setMasterFeedback(error.message)
        return
      }
    }
    setLotteLines(next)
    if (line) writeAudit({ module: 'Đối soát Lotte', action: 'Cập nhật trạng thái lệch', detail: `${line.orderCode} - ${line.lotteBillCode}` })
  }

  async function handlePurgeTestData() {
    if (!supabase) {
      setCleanupResult('Chức năng dọn dữ liệu cần kết nối Supabase.')
      return
    }
    if (!cleanupTargets.length) {
      setCleanupResult('Hãy chọn ít nhất một nhóm dữ liệu cần xóa.')
      return
    }
    if (from >= todayKey || to >= todayKey || (from <= todayKey && to >= todayKey)) {
      setCleanupResult(`An toan go-live: khong duoc xoa du lieu ngay hom nay (${formatDate(todayKey)}). Hay chon den ngay toi da ${formatDate(cleanupMaxDate)}.`)
      return
    }
    const branch = branches.find((item) => item.id === branchId)
    const targetLabels = CLEANUP_TARGETS.filter((item) => cleanupTargets.includes(item.id)).map((item) => item.label).join(', ')
    if (!window.confirm(`XÓA VĨNH VIỄN dữ liệu của ${branch?.name || branchId} từ ${formatDate(from)} đến ${formatDate(to)}?\n\nNhóm: ${targetLabels}`)) return
    if (!window.confirm('Dữ liệu đã xóa KHÔNG thể khôi phục. Bạn chắc chắn tiếp tục?')) return
    setCleanupBusy(true)
    setCleanupResult('')
    try {
      const { data, error } = await supabase.rpc('admin_purge_business_data', {
        p_branch_id: branchId,
        p_from: from,
        p_to: to,
        p_targets: cleanupTargets,
      })
      if (error) throw error
      const fallbackCounts = await purgeClientSideTargets(cleanupTargets)
      const counts = mergeDeleteCounts((data || {}) as Record<string, number>, fallbackCounts)
      const summary = Object.entries(counts).map(([table, count]) => `${table}: ${count}`).join(' · ') || 'Không có bản ghi nào khớp bộ lọc.'
      if (cleanupTargets.includes('history')) {
        const nextLotteLines = lotteLines.filter((line) =>
          line.branchId !== branchId || line.businessDate < from || line.businessDate > to,
        )
        setLotteLines(nextLotteLines)
        setAuditEntries([])
        await supabase
          .from('lotte_reconciliation_lines')
          .delete()
          .eq('branch_id', branchId)
          .gte('business_date', from)
          .lte('business_date', to)
        await supabase
          .from('control_audit_entries')
          .delete()
          .gte('created_at', `${from}T00:00:00`)
          .lte('created_at', `${to}T23:59:59`)
      }
      setCleanupResult(`Đã xóa xong. ${summary}`)
      writeAudit({ module: 'Dọn dữ liệu', action: 'Xóa dữ liệu test', detail: `${branch?.name || branchId} ${from}→${to}: ${summary}` })
    } catch (error) {
      setCleanupResult(error instanceof Error ? error.message : 'Không thể xóa dữ liệu. Kiểm tra migration 20260702_admin_purge_test_data.sql.')
    } finally {
      setCleanupBusy(false)
    }
  }

  async function purgeClientSideTargets(targets: string[]) {
    const client = supabase
    if (!client) return {}
    const counts: Record<string, number> = {}
    const deleteMaybe = async (
      key: string,
      task: () => PromiseLike<{ count: number | null; error: unknown }>,
    ) => {
      const { count, error } = await task()
      if (error) {
        const message = String((error as { message?: string } | null)?.message || '')
        if (/does not exist|schema cache|Could not find|relation/i.test(message)) return
        throw error
      }
      counts[key] = count || 0
    }

    if (targets.includes('attendance')) {
      const { data: registrations, error: readError } = await client
        .from('shift_registrations')
        .select('id')
        .eq('branch_id', branchId)
        .gte('work_date', from)
        .lte('work_date', to)
      if (readError) throw readError
      const ids = (registrations || []).map((item: { id: string }) => item.id)
      if (ids.length) {
        await deleteMaybe('attendance_records_fallback', () => client
          .from('attendance_records')
          .delete({ count: 'exact' })
          .in('shift_registration_id', ids))
      }
      await deleteMaybe('shift_registrations_fallback', () => client
        .from('shift_registrations')
        .delete({ count: 'exact' })
        .eq('branch_id', branchId)
        .gte('work_date', from)
        .lte('work_date', to))
    }

    if (targets.includes('kpi')) {
      await deleteMaybe('payroll_bonus_ledger_fallback', () => client
        .from('payroll_bonus_ledger')
        .delete({ count: 'exact' })
        .eq('branch_id', branchId)
        .gte('bonus_date', from)
        .lte('bonus_date', to))
      await deleteMaybe('payroll_kpi_metrics_fallback', () => client
        .from('payroll_kpi_metrics')
        .delete({ count: 'exact' })
        .eq('branch_id', branchId)
        .gte('metric_date', from)
        .lte('metric_date', to))
      await deleteMaybe('payroll_entries_fallback', () => client
        .from('payroll_entries')
        .delete({ count: 'exact' })
        .eq('branch_id', branchId)
        .gte('period', from.slice(0, 7))
        .lte('period', to.slice(0, 7)))
      await deleteMaybe('employee_kpi_targets_fallback', () => client
        .from('employee_kpi_targets')
        .delete({ count: 'exact' })
        .eq('branch_id', branchId)
        .gte('updated_at', `${from}T00:00:00`)
        .lte('updated_at', `${to}T23:59:59`))
    }

    if (targets.includes('history')) {
      await deleteMaybe('history_stock_movements_fallback', () => client
        .from('stock_movements')
        .delete({ count: 'exact' })
        .eq('branch_id', branchId)
        .gte('shift_date', from)
        .lte('shift_date', to))
      await deleteMaybe('history_report_snapshots_fallback', () => client
        .from('report_snapshots')
        .delete({ count: 'exact' })
        .eq('branch_id', branchId)
        .gte('report_date', from)
        .lte('report_date', to))
    }

    return counts
  }

  function exportReconciliation() {
    const csv = [
      ['Ngày', 'Chi nhánh', 'Order ID', 'Bill Lotte', 'SL POS', 'SL Lotte', 'Tiền POS', 'Tiền Lotte', 'Trạng thái', 'Ghi chú'],
      ...reconciliationRows.map((row) => [
        row.date,
        branchName(row.branchId, branches),
        row.orderCode,
        row.lotteBillCode || '',
        row.receiptQuantity,
        row.lotteQuantity,
        row.receiptAmount,
        row.lotteAmount,
        reconciliationLabel(row.status),
        row.note || '',
      ]),
    ].map((line) => line.map(csvCell).join(',')).join('\n')
    download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `doi-soat-lotte-${from}-${to}.csv`)
    writeAudit({ module: 'Đối soát Lotte', action: 'Xuất CSV', detail: `Xuất ${reconciliationRows.length} dòng đối soát.` })
  }

  return (
    <div className="page control-page">
      <header className="control-header">
        <div>
          <span className="eyebrow dark">THIẾT LẬP THEO BA</span>
          <h1>Trung tâm quản trị vận hành</h1>
          <p>Dữ liệu nền, phân quyền động và nhật ký thao tác cho hệ thống nội bộ.</p>
        </div>
        <div className="control-alert-grid">
          <article><span>SKU cấu hình</span><strong>{products.length}</strong><small>{customProductCount} thêm thủ công</small></article>
          <article><span>Chi nhánh</span><strong>{activeBranches.length}</strong><small>{customBranchCount} thêm thủ công</small></article>
          <article><span>Nhật ký thao tác</span><strong>{auditEntries.length}</strong><small>hành động gần nhất</small></article>
        </div>
      </header>

      <nav className="control-tabs" aria-label="Thiết lập">
        {[
          ['masterdata', 'Dữ liệu nền'],
          ['permissions', 'Phân quyền'],
          ['audit', 'Nhật ký thao tác'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id as ControlTab)}>
            {label}
          </button>
        ))}
      </nav>

      {(tab === 'reconciliation' || tab === 'audit' || tab === 'cleanup') && (
        <div className="admin-filter-bar admin-date-filters control-filter-bar">
          <label>Chi nhánh
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {(tab === 'cleanup' ? branches : branchOptions).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}{branch.active ? '' : ' (đã ẩn)'}</option>
              ))}
            </select>
          </label>
          <label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Đến ngày<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
      )}

      {tab === 'masterdata' && masterFeedback && (
        <div className="feedback-bar">{masterFeedback}<button onClick={() => setMasterFeedback('')}>×</button></div>
      )}

      {tab === 'masterdata' && (
        <div className="control-grid">
          <section className="section-card control-sku-card">
            <div className="section-title">
              <div><span className="eyebrow dark">SKU KHO</span><h2>Cấu hình hàng kho và ngưỡng tồn</h2></div>
              <span className="date-chip">{lowStockConfigured} SKU có cảnh báo tồn</span>
            </div>
            <form className="control-form-grid" onSubmit={saveProduct}>
              {editingProductId && <p className="menu-recipe-required">Đang sửa SKU kho. Các phiếu cũ vẫn giữ theo mã nội bộ; danh mục hiển thị, đơn vị và quy đổi sẽ được cập nhật cho lần nhập/trừ tiếp theo.</p>}
              <input value={productDraft.sku} onChange={(event) => setProductDraft({ ...productDraft, sku: event.target.value })} placeholder="Mã SKU" />
              <input value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} placeholder="Tên sản phẩm" />
              <select value={productDraft.category} onChange={(event) => setProductDraft({ ...productDraft, category: event.target.value as Product['category'] })}>
                <option value="raw">Nguyên liệu</option>
                <option value="packaging">Bao bì</option>
                <option value="finished">Thành phẩm</option>
              </select>
              <input value={productDraft.unit} onChange={(event) => setProductDraft({ ...productDraft, unit: event.target.value })} placeholder="Đơn vị" />
              <input inputMode="numeric" value={productDraft.lowStock} onChange={(event) => setProductDraft({ ...productDraft, lowStock: cleanMoneyInput(event.target.value) })} placeholder="Tồn tối thiểu" />
              <input value={productDraft.inboundUnit} onChange={(event) => setProductDraft({ ...productDraft, inboundUnit: event.target.value })} placeholder="Đơn vị nhập: túi/thùng" />
              <input inputMode="decimal" value={productDraft.inboundPackSize} onChange={(event) => setProductDraft({ ...productDraft, inboundPackSize: event.target.value.replace(',', '.') })} placeholder={`1 ${productDraft.inboundUnit || 'đv nhập'} = ? ${productDraft.unit || 'đv trừ'}`} />
              <input value={productDraft.orderSpecificationHint} onChange={(event) => setProductDraft({ ...productDraft, orderSpecificationHint: event.target.value })} placeholder="Gợi ý quy cách đặt: VD thùng 24 chai / bao 25 kg" />
              <button className="primary-button">{editingProductId ? 'Lưu SKU' : 'Thêm SKU'}</button>
              {editingProductId && <button type="button" className="secondary-button" onClick={resetProductDraft}>Hủy sửa</button>}
            </form>
            <div className="adm-list">
              {stockProducts.map((product) => {
                const usedByMenus = products.filter((item) => item.recipe?.some((line) => line.productId === product.id))
                const inUse = product.source === 'system' || usedByMenus.length > 0
                return (
                <article className="adm-row" key={product.id}>
                  <div className="adm-row-head">
                    <div className="adm-row-id">
                      <strong>{product.name}</strong>
                      <small>
                        {product.sku} · {product.source === 'system' ? 'Hệ thống' : 'Tùy chỉnh'} · {categoryLabel(product.category)}
                        {usedByMenus.length > 0 && ` · dùng trong ${usedByMenus.length} món`}
                      </small>
                    </div>
                    <span className={`control-status ${inUse ? 'ok' : product.active ? 'ok' : 'off'}`}>{inUse ? 'Đang sử dụng' : product.active ? 'Đang dùng' : 'Tạm ngưng'}</span>
                  </div>
                  <div className="adm-metrics">
                    <span><i>Đơn vị</i><b>{product.unit}</b></span>
                    <span><i>Quy đổi nhập</i><b>{product.inboundUnit ? inboundConversionLabel(product) : `Trừ theo ${product.unit}`}</b></span>
                    <span><i>Tồn tối thiểu</i><input className="control-small-input" inputMode="numeric" value={product.lowStock} onChange={(event) => updateLowStock(product.id, event.target.value)} /></span>
                  </div>
                  <div className="control-row-actions">
                    <button className="mini-button" onClick={() => editProduct(product)}>Sửa</button>
                    <button className="mini-button" onClick={() => toggleProduct(product.id)}>{product.active ? 'Tạm ngưng' : 'Mở lại'}</button>
                    <button className="mini-button danger" onClick={() => deleteProduct(product.id)}>Xóa</button>
                  </div>
                </article>
                )
              })}
              {!stockProducts.length && <p className="empty-copy">Chưa có SKU kho nào.</p>}
            </div>
          </section>

          <section className="section-card control-menu-card">
            <div className="section-title">
              <div><span className="eyebrow dark">MENU / MÓN BÁN</span><h2>Cấu hình món và giá bán</h2></div>
              <span className="date-chip">{menuProducts.length} món</span>
            </div>
            {menuWithoutRecipe.length > 0 && (
              <div className="menu-norecipe-alert">
                <strong>{`${menuWithoutRecipe.length} món đang bán nhưng chưa gán công thức`}</strong>
                <p>Nhân viên vẫn bán được bình thường, nhưng hóa đơn của các món này KHÔNG trừ kho, nên tồn thành phẩm sẽ cao hơn thực tế cho tới lúc kiểm đếm cuối ca. Bấm "Sửa" từng món để gán thành phẩm nguồn hoặc NVL.</p>
                <div className="menu-norecipe-list">
                  {menuWithoutRecipe.map((product) => (
                    <button type="button" className="mini-button" key={product.id} onClick={() => editMenuItem(product)}>
                      {product.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <form className="menu-editor-form" onSubmit={saveMenuItem}>
              {editingMenuId && <p className="menu-recipe-required">Đang sửa món hiện có. Lưu xong nhân viên sẽ thấy menu mới sau khi đồng bộ.</p>}
              <div className="menu-core-grid">
                <label>Mã món<input value={menuDraft.sku} onChange={(event) => setMenuDraft({ ...menuDraft, sku: event.target.value })} placeholder="TP-HD-110" /></label>
                <label>Tên món<input value={menuDraft.name} onChange={(event) => setMenuDraft({ ...menuDraft, name: event.target.value })} placeholder="Hạt dẻ rang 110g" /></label>
                <label>Đơn vị bán<input value={menuDraft.unit} onChange={(event) => setMenuDraft({ ...menuDraft, unit: event.target.value })} placeholder="túi" /></label>
                <label>Giá bán<input inputMode="numeric" value={menuDraft.price} onChange={(event) => setMenuDraft({ ...menuDraft, price: cleanMoneyInput(event.target.value) })} placeholder="30000" /></label>
              </div>
              <div className="menu-recipe-builder">
                <p className="menu-recipe-required">Bắt buộc chọn nguyên vật liệu (thành phẩm nguồn hoặc dòng NVL) để hệ thống trừ tồn kho khi bán.</p>
                <label className="menu-source-field">Thành phẩm nguồn
                  <select value={menuDraft.sourceProductId} onChange={(event) => setMenuDraft({ ...menuDraft, sourceProductId: event.target.value })}>
                    <option value="">Không trừ mẻ</option>
                    {recipeSourceProducts.map((product) => <option key={product.id} value={product.id}>{product.name} - trừ theo {product.unit}</option>)}
                  </select>
                </label>
                <label>Lượng/món<input inputMode="decimal" value={menuDraft.sourceQuantity} onChange={(event) => setMenuDraft({ ...menuDraft, sourceQuantity: event.target.value.replace(',', '.') })} placeholder={selectedProductUnit(products, menuDraft.sourceProductId)} /></label>
                <label className="menu-source-field">Bao bì
                  <select value={menuDraft.packagingProductId} onChange={(event) => setMenuDraft({ ...menuDraft, packagingProductId: event.target.value })}>
                    <option value="">Không trừ bao bì</option>
                    {recipePackagingProducts.map((product) => <option key={product.id} value={product.id}>{product.name} - {product.unit}</option>)}
                  </select>
                </label>
                <label>Số bao bì<input inputMode="decimal" value={menuDraft.packagingQuantity} onChange={(event) => setMenuDraft({ ...menuDraft, packagingQuantity: event.target.value.replace(',', '.') })} placeholder={selectedProductUnit(products, menuDraft.packagingProductId)} /></label>
                <div className="menu-ingredient-list">
                  {menuRecipeDrafts.map((line) => (
                    <div className="menu-ingredient-row" key={line.id}>
                      <label>NVL / thành phẩm
                        <select value={line.productId} onChange={(event) => updateMenuRecipeDraft(line.id, { productId: event.target.value })}>
                          <option value="">Chọn hàng kho</option>
                          {recipeIngredientProducts.map((product) => <option key={product.id} value={product.id}>{product.name} - trừ theo {product.unit}</option>)}
                        </select>
                      </label>
                      <label>Lượng<input inputMode="decimal" value={line.quantity} onChange={(event) => updateMenuRecipeDraft(line.id, { quantity: event.target.value.replace(',', '.') })} placeholder={selectedProductUnit(products, line.productId)} /></label>
                      <button type="button" className="mini-button danger" onClick={() => removeMenuRecipeDraft(line.id)}>Xóa</button>
                    </div>
                  ))}
                  <button type="button" className="mini-button" onClick={addMenuRecipeDraft}>Thêm NVL</button>
                </div>
              </div>
              <div className="control-row-actions">
                <button className="primary-button">{editingMenuId ? 'Lưu món' : 'Thêm món'}</button>
                {editingMenuId && <button type="button" className="mini-button" onClick={resetMenuDraft}>Hủy sửa</button>}
              </div>
            </form>
            <div className="adm-list">
              {menuProducts.map((product) => (
                <article className="adm-row" key={product.id}>
                  <div className="adm-row-head">
                    <div className="adm-row-id">
                      <strong>{product.name}</strong>
                      <small>{product.sku} · {product.source === 'system' ? 'Hệ thống' : 'Tùy chỉnh'}</small>
                    </div>
                    <div className="adm-row-hero">
                      <b className="adm-hero-money">{formatMoney(product.price)}</b>
                      <span>/{product.unit}</span>
                    </div>
                  </div>
                  <div className="adm-metrics">
                    <span className={product.active ? 'ok' : 'warn'}><i>Trạng thái</i><b>{product.active ? 'Đang bán' : 'Tạm ngưng'}</b></span>
                    <span className={product.active && Number(product.price) > 0 ? 'ok' : 'warn'}><i>Menu POS</i><b>{product.active && Number(product.price) > 0 ? 'Hiển thị' : 'Ẩn (cần bật + có giá)'}</b></span>
                    <span className={hasMenuRecipe(product) ? 'ok' : 'warn'}><i>Trừ kho khi bán</i><b>{hasMenuRecipe(product) ? 'Có' : 'Chưa gán công thức'}</b></span>
                    {product.recipe?.map((line) => {
                      const recipeProduct = productById(line.productId)
                      return <span key={`${product.id}-${line.role}-${line.productId}`}><i>{line.role === 'source' ? 'Trừ từ mẻ' : line.role === 'packaging' ? 'Trừ bao bì' : 'Trừ NVL'}</i><b>{formatNumber(line.quantity)} {recipeProduct?.unit || ''} {recipeProduct?.name || line.productId}</b><small>{recipeProduct ? inboundConversionLabel(recipeProduct) : ''}</small></span>
                    })}
                  </div>
                  <div className="control-row-actions">
                    <button className="mini-button" onClick={() => editMenuItem(product)}>Sửa</button>
                    <button className="mini-button" onClick={() => toggleProduct(product.id)}>{product.active ? 'Tạm ngưng' : 'Mở bán'}</button>
                    <button className="mini-button danger" onClick={() => deleteProduct(product.id)}>Xóa</button>
                  </div>
                </article>
              ))}
              {!menuProducts.length && <p className="empty-copy">Chưa có món bán nào.</p>}
            </div>
          </section>

        </div>
      )}

      {tab === 'permissions' && (
        <section className="section-card">
          <div className="section-title">
            <div><span className="eyebrow dark">DYNAMIC RBAC</span><h2>Ma trận quyền theo module</h2></div>
            <button className="primary-button" onClick={savePermissionAudit}>Lưu audit</button>
          </div>
          <div className="control-rbac-grid">
            {(Object.keys(ROLE_LABELS) as PermissionRole[]).map((role) => (
              <article key={role} className="control-role-card">
                <header><strong>{ROLE_LABELS[role]}</strong><small>{role}</small></header>
                <div className="control-permission-table">
                  <div className="control-permission-row header">
                    <span>Module</span>
                    {ACTIONS.map((action) => <b key={action.id}>{action.label}</b>)}
                  </div>
                  {MODULES.map((module) => (
                    <div className="control-permission-row" key={module.id}>
                      <span>{module.label}</span>
                      {ACTIONS.map((action) => (
                        <label key={action.id} title={`${module.label} - ${action.label}`}>
                          <input
                            type="checkbox"
                            checked={(permissions[role]?.[module.id] || []).includes(action.id)}
                            onChange={() => togglePermission(role, module.id, action.id)}
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <p className="commission-note">Ma trận này là lớp cấu hình UI theo BA. Khi triển khai production cần đồng bộ xuống bảng roles, permissions, role_permissions và policy backend/RLS.</p>
        </section>
      )}

      {tab === 'reconciliation' && (
        <section className="section-card">
          <div className="section-title">
            <div><span className="eyebrow dark">ĐỐI SOÁT LOTTE</span><h2>Ghép Order ID nội bộ với bill quầy tổng</h2></div>
            <div className="section-actions">
              <button className="primary-button" onClick={exportReconciliation} disabled={!reconciliationRows.length}>Tải CSV</button>
              <span className={mismatchCount ? 'date-chip warning-chip' : 'date-chip'}>{mismatchCount} lệch cần xử lý</span>
            </div>
          </div>
          <form className="control-form-grid lotte-form" onSubmit={addLotteLine}>
            <input value={lotteDraft.orderCode} onChange={(event) => setLotteDraft({ ...lotteDraft, orderCode: event.target.value })} placeholder="Order ID nội bộ" />
            <input value={lotteDraft.lotteBillCode} onChange={(event) => setLotteDraft({ ...lotteDraft, lotteBillCode: event.target.value })} placeholder="Mã bill Lotte" />
            <input inputMode="numeric" value={lotteDraft.quantity} onChange={(event) => setLotteDraft({ ...lotteDraft, quantity: cleanMoneyInput(event.target.value) })} placeholder="Số lượng" />
            <input inputMode="numeric" value={lotteDraft.amount} onChange={(event) => setLotteDraft({ ...lotteDraft, amount: cleanMoneyInput(event.target.value) })} placeholder="Số tiền" />
            <input value={lotteDraft.note} onChange={(event) => setLotteDraft({ ...lotteDraft, note: event.target.value })} placeholder="Ghi chú xử lý" />
            <button className="primary-button">Thêm bill Lotte</button>
          </form>
          <div className="table-scroll">
            <table className="data-table control-data-table reconciliation-table">
              <thead><tr><th>Ngày</th><th>Order ID</th><th>Bill Lotte</th><th>POS</th><th>Lotte</th><th>Trạng thái</th><th>Ghi chú</th><th></th></tr></thead>
              <tbody>
                {reconciliationRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.date)}</td>
                    <td><strong>{row.orderCode}</strong><small>{branchName(row.branchId, branches)}</small></td>
                    <td>{row.lotteBillCode || '-'}</td>
                    <td>{row.receiptQuantity || '-'} · {row.receiptAmount ? formatMoney(row.receiptAmount) : '-'}</td>
                    <td>{row.lotteQuantity || '-'} · {row.lotteAmount ? formatMoney(row.lotteAmount) : '-'}</td>
                    <td><span className={`reconciliation-status ${row.status}`}>{reconciliationLabel(row.status)}</span></td>
                    <td>{row.note || '-'}</td>
                    <td>{row.lotteLineId && <button className="mini-button" onClick={() => resolveLotteLine(row.lotteLineId!)}>{row.status === 'resolved' ? 'Mở lại' : 'Đã xử lý'}</button>}</td>
                  </tr>
                ))}
                {!reconciliationRows.length && <tr><td colSpan={8} className="empty-state">Chưa có hóa đơn POS hoặc bill Lotte trong bộ lọc này.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'audit' && (
        <section className="section-card">
          <div className="section-title">
            <div><span className="eyebrow dark">AUDIT LOG</span><h2>Nhật ký hành động quan trọng</h2></div>
            <span className="date-chip">{auditEntries.length} bản ghi</span>
          </div>
          <div className="audit-timeline">
            {auditEntries.map((entry) => (
              <article key={entry.id}>
                <time>{formatDateTime(entry.createdAt)}</time>
                <span><strong>{entry.module} · {entry.action}</strong><small>{entry.detail}</small></span>
                <b>{entry.actorName}</b>
              </article>
            ))}
            {!auditEntries.length && <p className="empty-copy">Chưa có audit log. Các thao tác trong Thiết lập BA sẽ được ghi tại đây.</p>}
          </div>
        </section>
      )}
    </div>
  )
}

type PermissionMatrix = Record<PermissionRole, Record<string, PermissionAction[]>>

function loadProducts(): ConfigProduct[] {
  return baseConfiguredProducts()
}

function loadBranches(): ConfigBranch[] {
  return canonicalizeControlBranches(readConfiguredBranchRows())
}

function canonicalizeControlBranches(rows: ConfigBranch[]) {
  const byId = new Map<string, ConfigBranch>()
  rows.forEach((branch) => {
    if (!branch.id) return
    const existing = byId.get(branch.id)
    byId.set(branch.id, existing
      ? {
        ...existing,
        ...branch,
        address: branch.address || existing.address,
        manager: branch.manager || existing.manager,
        active: existing.active || branch.active,
        source: existing.source === 'system' ? 'system' : branch.source,
      }
      : branch)
  })
  return Array.from(byId.values()).sort((a, b) =>
    Number(b.active) - Number(a.active)
    || a.name.localeCompare(b.name, 'vi')
    || a.id.localeCompare(b.id),
  )
}

function loadPermissions(): PermissionMatrix {
  const allActions = ACTIONS.map((action) => action.id)
  const viewOnly: PermissionAction[] = ['view']
  const operate: PermissionAction[] = ['view', 'add', 'edit']
  const exportable: PermissionAction[] = ['view', 'export']
  const matrix: PermissionMatrix = {
    manager: {},
    supmt: {},
    shift_leader: {},
    staff: {},
    cashier: {},
    kitchen: {},
  }
  MODULES.forEach((module) => {
    matrix.manager[module.id] = allActions
    // SUP MT giám sát toàn hệ thống: thấy đúng bộ dữ liệu của admin nhưng CHỈ xem và
    // xuất báo cáo. Riêng chấm công có thêm quyền ghi cho ca của CHÍNH họ (RLS
    // `supmt adds own shift anywhere`), không phải quyền sửa công người khác.
    matrix.supmt[module.id] = ['pos', 'kitchen'].includes(module.id) ? [] : exportable
    matrix.shift_leader[module.id] = ['inventory', 'handover', 'report', 'orders', 'pos', 'attendance'].includes(module.id) ? operate : viewOnly
    matrix.staff[module.id] = ['pos', 'attendance', 'schedule'].includes(module.id) ? operate : []
    matrix.cashier[module.id] = module.id === 'pos' ? operate : []
    matrix.kitchen[module.id] = module.id === 'kitchen' ? operate : module.id === 'orders' ? viewOnly : []
  })
  matrix.shift_leader.report = [...operate, 'export']
  matrix.manager.payroll = allActions
  matrix.manager.audit = exportable
  return matrix
}

function loadLotteLines() {
  return [] as LotteLine[]
}

function loadAuditEntries() {
  return [] as AuditEntry[]
}

function mapLotteLine(row: any): LotteLine {
  return {
    id: row.id,
    branchId: row.branch_id,
    businessDate: row.business_date,
    orderCode: row.order_code,
    lotteBillCode: row.lotte_bill_code,
    quantity: Number(row.quantity || 0),
    amount: Number(row.amount || 0),
    note: row.note || '',
    resolved: Boolean(row.resolved),
    createdAt: row.created_at,
  }
}

function mapAuditEntry(row: any): AuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id || '',
    actorName: row.actor_name || '',
    module: row.module,
    action: row.action,
    detail: row.detail,
    before: row.before_value || undefined,
    after: row.after_value || undefined,
    reason: row.reason || undefined,
    createdAt: row.created_at,
  }
}

function buildReconciliationRows(receipts: SalesReceipt[], lotteLines: LotteLine[]) {
  const rows: Array<{
    id: string
    branchId: string
    date: string
    orderCode: string
    lotteLineId?: string
    lotteBillCode?: string
    receiptQuantity: number
    lotteQuantity: number
    receiptAmount: number
    lotteAmount: number
    note?: string
    status: 'matched' | 'amount_diff' | 'quantity_diff' | 'missing_lotte' | 'missing_internal' | 'resolved'
  }> = []
  const usedLotteIds = new Set<string>()
  receipts.forEach((receipt) => {
    const line = lotteLines.find((item) => item.orderCode.trim().toUpperCase() === receipt.code.trim().toUpperCase())
    if (line) usedLotteIds.add(line.id)
    let status: typeof rows[number]['status'] = 'missing_lotte'
    if (line?.resolved) status = 'resolved'
    else if (line && line.amount !== receipt.totalAmount) status = 'amount_diff'
    else if (line && line.quantity !== receipt.totalQuantity) status = 'quantity_diff'
    else if (line) status = 'matched'
    rows.push({
      id: `receipt-${receipt.id}`,
      branchId: receipt.branchId,
      date: receipt.businessDate,
      orderCode: receipt.code,
      lotteLineId: line?.id,
      lotteBillCode: line?.lotteBillCode,
      receiptQuantity: receipt.totalQuantity,
      lotteQuantity: line?.quantity || 0,
      receiptAmount: receipt.totalAmount,
      lotteAmount: line?.amount || 0,
      note: line?.note,
      status,
    })
  })
  lotteLines.filter((line) => !usedLotteIds.has(line.id)).forEach((line) => {
    rows.push({
      id: `lotte-${line.id}`,
      branchId: line.branchId,
      date: line.businessDate,
      orderCode: line.orderCode,
      lotteLineId: line.id,
      lotteBillCode: line.lotteBillCode,
      receiptQuantity: 0,
      lotteQuantity: line.quantity,
      receiptAmount: 0,
      lotteAmount: line.amount,
      note: line.note,
      status: line.resolved ? 'resolved' : 'missing_internal',
    })
  })
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.orderCode.localeCompare(b.orderCode))
}

function categoryLabel(category: Product['category']) {
  return category === 'raw' ? 'Nguyên liệu' : category === 'packaging' ? 'Bao bì' : 'Thành phẩm'
}

function inboundConversionLabel(product: Pick<Product, 'unit' | 'inboundUnit' | 'inboundPackKg' | 'inboundPackQuantity'>) {
  const packSize = product.inboundPackKg ?? product.inboundPackQuantity
  if (product.inboundUnit && packSize) return `Nhập ${product.inboundUnit}, trừ ${product.unit}: 1 ${product.inboundUnit} = ${formatNumber(packSize)} ${product.unit}`
  if (product.inboundUnit) return `Nhập ${product.inboundUnit}, trừ ${product.unit}`
  return `Trừ theo ${product.unit}`
}

function selectedProductUnit(products: Product[], productId: string) {
  const product = products.find((item) => item.id === productId)
  return product ? `Số ${product.unit} trừ / món` : '0'
}

function mergeRecipeLines(lines: ProductRecipeLine[]) {
  const map = new Map<string, ProductRecipeLine>()
  lines.forEach((line) => {
    if (!line.productId || line.quantity <= 0) return
    const key = `${line.role}:${line.productId}`
    const existing = map.get(key)
    map.set(key, existing ? { ...existing, quantity: existing.quantity + line.quantity } : line)
  })
  return Array.from(map.values())
}

// Món menu = thành phẩm nhân viên thực sự có thể bán trên POS: khác kg và có giá.
// Thành phẩm kho theo cái nhưng giá 0 (vd TP-BANH trước khi đóng hộp) vẫn là SKU KHO.
function isMenuProduct(product: ConfigProduct) {
  return product.category === 'finished' && product.unit !== 'kg' && Number(product.price || 0) > 0
}

function reconciliationLabel(status: ReturnType<typeof buildReconciliationRows>[number]['status']) {
  return {
    matched: 'Đã khớp',
    amount_diff: 'Lệch tiền',
    quantity_diff: 'Lệch SL',
    missing_lotte: 'Thiếu bill Lotte',
    missing_internal: 'Thiếu đơn nội bộ',
    resolved: 'Đã xử lý',
  }[status]
}

function branchName(id: string, branches: ConfigBranch[]) {
  return branches.find((branch) => branch.id === id)?.name || id
}

function cleanMoneyInput(value: string) {
  return value.replace(/[^\d]/g, '')
}

function mergeDeleteCounts(...items: Array<Record<string, number>>) {
  return items.reduce<Record<string, number>>((merged, item) => {
    Object.entries(item).forEach(([key, count]) => {
      merged[key] = (merged[key] || 0) + Number(count || 0)
    })
    return merged
  }, {})
}

function branchSlug(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

// Định mức trừ kho là số lượng kho: giữ đủ 3 chữ số lẻ như DB, đừng làm tròn 2
// số rồi để công thức hiện một đằng, phiếu kho trừ một nẻo.
function formatNumber(value: number) {
  return formatQuantity(Number(value || 0))
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', { hour12: false })
}

function monthRange() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  return { from: localDateKey(first > yesterday ? yesterday : first), to: localDateKey(yesterday) }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function previousDateKey(value: string) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - 1)
  return localDateKey(date)
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function download(blob: Blob, name: string) {
  downloadBlob(blob, name)
}
