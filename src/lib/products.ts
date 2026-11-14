import {
  baseConfiguredProducts,
  markConfiguredProductDeleted,
  setConfiguredProductsCache,
  type ConfiguredProduct,
} from './constants'
import { shouldUseLanApi, supabase, uniqueChannelName } from './supabase'
import type { AppUser, ProductRecipeLine } from '../types'

export const PRODUCTS_CHANGED_EVENT = 'gustino-products-updated'
const PRODUCTS_CACHE_KEY = 'gustino:configured-products:v1'

interface ProductRow {
  id: string
  sku: string
  name: string
  unit: string
  category: string
  low_stock: number | null
  active: boolean | null
  price: number | null
  source: string | null
  weight_kg: number | null
  counts_for_yield: boolean | null
  inbound_unit: string | null
  inbound_pack_kg: number | null
  inbound_pack_quantity: number | null
  order_specification_hint: string | null
  recipe: ProductRecipeLine[] | null
  deleted_at: string | null
}

function rowToProduct(row: ProductRow): ConfiguredProduct {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    category: (row.category as ConfiguredProduct['category']) || 'finished',
    lowStock: Number(row.low_stock || 0),
    active: row.active !== false,
    price: Number(row.price || 0),
    source: row.source === 'custom' ? 'custom' : 'system',
    weightKg: row.weight_kg ? Number(row.weight_kg) : undefined,
    countsForYield: row.counts_for_yield ?? undefined,
    inboundUnit: row.inbound_unit || undefined,
    inboundPackKg: row.inbound_pack_kg ? Number(row.inbound_pack_kg) : undefined,
    inboundPackQuantity: row.inbound_pack_quantity ? Number(row.inbound_pack_quantity) : undefined,
    orderSpecificationHint: row.order_specification_hint || undefined,
    recipe: Array.isArray(row.recipe) && row.recipe.length ? row.recipe : undefined,
    deletedAt: row.deleted_at || undefined,
  }
}

function productToRow(product: ConfiguredProduct) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    category: product.category,
    low_stock: Number(product.lowStock || 0),
    active: product.active !== false,
    price: Number(product.price || 0),
    source: product.source || 'custom',
    weight_kg: product.weightKg ?? null,
    counts_for_yield: product.countsForYield ?? null,
    inbound_unit: product.inboundUnit ?? null,
    inbound_pack_kg: product.inboundPackKg ?? null,
    inbound_pack_quantity: product.inboundPackQuantity ?? null,
    order_specification_hint: product.orderSpecificationHint?.trim() || null,
    recipe: product.recipe?.length ? product.recipe : null,
    deleted_at: product.deletedAt ?? null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Danh mục SKU chỉ sống trong BỘ NHỚ của phiên, KHÔNG ghi xuống localStorage.
 *
 * Quyết định 07/08/2026 (chủ quán): "không có dữ liệu nào được phép lưu trong
 * local". Bản cũ ghi nguyên danh mục (tên, giá, nhóm hàng, công thức) vào
 * `localStorage['gustino:configured-products:v1']`. Bản cache đó sống qua nhiều
 * ngày và không có đường hết hạn, nên admin sửa giá/tắt món trên một máy thì máy
 * khác vẫn đọc bản cũ — đúng lớp lỗi "máy này thấy khác máy kia" đã đeo bám kho.
 * Cloud là nguồn sự thật duy nhất; mỗi lần mở app đọc lại từ Supabase.
 */
const clearPersistedProducts = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PRODUCTS_CACHE_KEY)
  } catch {
    // Trình duyệt riêng tư chặn storage — không có gì để dọn thì thôi.
  }
}

function writeLocalProducts(products: ConfiguredProduct[], deletedProducts?: ConfiguredProduct[]) {
  setConfiguredProductsCache(products, deletedProducts)
  // Dọn bản cache cũ còn sót trên máy người dùng từ các phiên bản trước.
  clearPersistedProducts()
  window.dispatchEvent(new CustomEvent(PRODUCTS_CHANGED_EVENT))
}

function mergeCloudIntoBase(rows: ConfiguredProduct[]): ConfiguredProduct[] {
  const merged = new Map(baseConfiguredProducts().map((product) => [product.id, product]))
  rows.forEach((row) => {
    if (row.deletedAt) {
      merged.delete(row.id)
      return
    }
    const fallback = merged.get(row.id)
    merged.set(row.id, {
      ...fallback,
      ...row,
      // Bản ghi cloud cũ chưa cấu hình giá/ngưỡng tồn thì giữ mặc định hệ thống.
      price: row.price > 0 ? row.price : Number(fallback?.price || 0),
      lowStock: row.lowStock > 0 ? row.lowStock : Number(fallback?.lowStock || 0),
    })
  })
  return Array.from(merged.values())
}

/**
 * Kéo danh mục món/SKU từ Supabase về, gộp với danh mục hệ thống và giữ trong
 * bộ nhớ phiên để mọi màn hình (POS, kho, bàn giao ca) dùng cùng một menu.
 */
export async function fetchConfiguredProducts(user?: AppUser | null): Promise<ConfiguredProduct[]> {
  if (!supabase || (user && shouldUseLanApi(user))) {
    const products = baseConfiguredProducts()
    writeLocalProducts(products, [])
    return products
  }
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, unit, category, low_stock, active, price, source, weight_kg, counts_for_yield, inbound_unit, inbound_pack_kg, inbound_pack_quantity, recipe, deleted_at')
  // Lỗi mạng thì GIỮ danh mục đang có trong bộ nhớ phiên (nếu đã tải được lần
  // nào) và ném lỗi lên cho phía gọi. Trước đây chỗ này rơi về bản localStorage
  // — nghĩa là im lặng dùng danh mục có thể đã cũ nhiều ngày.
  if (error) throw error
  const rows = (data || []).map((row) => rowToProduct(row as ProductRow))
  const merged = mergeCloudIntoBase(rows)
  writeLocalProducts(merged, rows.filter((product) => Boolean(product.deletedAt)))
  return merged
}

/** Admin đẩy toàn bộ danh mục hiện tại lên Supabase để các thiết bị khác thấy ngay. */
export async function syncConfiguredProducts(user: AppUser, products: ConfiguredProduct[]) {
  writeLocalProducts(products)
  if (!supabase || shouldUseLanApi(user) || user.role !== 'admin') return
  const { error } = await supabase
    .from('products')
    .upsert(products.map(productToRow), { onConflict: 'id' })
  if (error) throw error
}

/** Xóa hẳn một món/SKU trên cloud (admin). */
export async function deleteConfiguredProduct(user: AppUser, productId: string, product?: ConfiguredProduct) {
  if (user.role !== 'admin') return
  const deletedAt = new Date().toISOString()
  const baseProduct = product || baseConfiguredProducts().find((item) => item.id === productId)
  if (!baseProduct) throw new Error('Không tìm thấy sản phẩm để xóa trên Supabase.')
  const deletedProduct = { ...baseProduct, active: false, deletedAt }
  if (!supabase || shouldUseLanApi(user)) {
    markConfiguredProductDeleted(deletedProduct)
    window.dispatchEvent(new CustomEvent(PRODUCTS_CHANGED_EVENT))
    return
  }
  const tombstone = productToRow(deletedProduct)
  const { error } = await supabase.from('products').upsert(tombstone, { onConflict: 'id' })
  if (error) throw error
  markConfiguredProductDeleted(deletedProduct)
  window.dispatchEvent(new CustomEvent(PRODUCTS_CHANGED_EVENT))
}

/** Theo dõi realtime bảng products; trả về hàm hủy đăng ký. */
export function subscribeConfiguredProducts(user: AppUser | null, onChange: () => void) {
  if (!supabase || (user && shouldUseLanApi(user))) return () => {}
  const client = supabase
  try {
    const channel = client.channel(uniqueChannelName('configured-products'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
      .subscribe()
    return () => { void client.removeChannel(channel) }
  } catch {
    return () => {}
  }
}
