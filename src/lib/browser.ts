export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Gộp một chuỗi sự kiện realtime dồn dập thành MỘT lượt tải lại.
 * Supabase bắn `postgres_changes` theo từng DÒNG: bán một hoá đơn POS là 1 event
 * `sales_receipts` + n event `sales_receipt_items`, mà bảng items không có
 * `branch_id` nên máy của MỌI chi nhánh đều nhận. Không gộp thì mỗi lần bán là
 * vài lượt tải lại toàn trang — đúng cảm giác "giật" lúc đông khách.
 */
export function burstGuard(run: () => void, delayMs = 600): (() => void) & { cancel: () => void } {
  let timer: number | undefined
  const trigger = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(run, delayMs)
  }
  return Object.assign(trigger, { cancel: () => window.clearTimeout(timer) })
}

/** Realtime is primary; visible fallback polling and bounded bursts reconcile missed events. */
export function watchVisibleData(run: () => void | Promise<unknown>, options: { fallbackMs?: number; reconcileMs?: number; minIntervalMs?: number } = {}) {
  const fallbackMs = options.fallbackMs ?? 60_000
  const reconcileMs = options.reconcileMs ?? 150_000
  const minIntervalMs = options.minIntervalMs ?? 5_000
  let lastStarted = Date.now()
  let connected = false
  let subscribedBefore = false
  let disposed = false
  let busy = false
  let dirty = false
  let scheduled: number | undefined
  const visible = () => document.visibilityState === 'visible'
  const execute = () => {
    scheduled = undefined
    if (disposed || !visible()) return
    if (busy) { dirty = true; return }
    busy = true
    dirty = false
    lastStarted = Date.now()
    void Promise.resolve().then(run).catch(() => undefined).finally(() => {
      busy = false
      if (dirty) trigger()
    })
  }
  const trigger = () => {
    if (disposed) return
    dirty = true
    if (!visible() || busy || scheduled !== undefined) return
    scheduled = window.setTimeout(execute, Math.max(300, minIntervalMs - (Date.now() - lastStarted)))
  }
  const interval = window.setInterval(() => {
    if (!connected || Date.now() - lastStarted >= reconcileMs) trigger()
  }, fallbackMs)
  const resume = () => { if (visible()) trigger() }
  window.addEventListener('focus', resume)
  document.addEventListener('visibilitychange', resume)
  return {
    trigger,
    status(status: string) {
      if (status === 'SUBSCRIBED') {
        const reconnect = subscribedBefore && !connected
        connected = true
        subscribedBefore = true
        if (reconnect) trigger()
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) connected = false
    },
    dispose() {
      disposed = true
      window.clearInterval(interval)
      window.clearTimeout(scheduled)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    },
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  // Safari/Chrome mobile cần link nằm trong DOM và không được revoke URL ngay,
  // nếu không tải file sẽ im lặng thất bại (nút "không phản hồi").
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    URL.revokeObjectURL(link.href)
    link.remove()
  }, 4000)
}

export async function shareOrDownloadBlob(
  blob: Blob,
  name: string,
  options: { title?: string; text?: string } = {},
): Promise<'shared' | 'downloaded'> {
  const share = navigator.share?.bind(navigator)
  if (share && typeof File !== 'undefined') {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
    const sharePayload = { files: [file], title: options.title, text: options.text }
    const canShareFile = !navigator.canShare || navigator.canShare({ files: [file] })
    if (canShareFile) {
      try {
        await share(sharePayload)
        return 'shared'
      } catch (error) {
        if ((error as DOMException | null)?.name === 'AbortError') {
          throw new Error('Bạn đã đóng bảng chia sẻ nên ảnh chưa được lưu.')
        }
        // Một số bản Safari có navigator.share nhưng từ chối File; dùng tải file chuẩn làm fallback.
      }
    }
  }
  downloadBlob(blob, name)
  return 'downloaded'
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = .95) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) resolve(blob)
      else reject(new Error('Không thể tạo file ảnh để lưu.'))
    }, type, quality)
  })
}

export interface DecodedCanvasImage {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

/** Kích thước ảnh đọc từ header (JPEG SOF / PNG IHDR) — không cần giải mã toàn bộ khung hình. */
async function readImageHeader(blob: Blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 262144).arrayBuffer())
    return { size: readImageSizeFromHeader(head), heif: isHeifHeader(head) }
  } catch {
    return { size: undefined, heif: false }
  }
}

function readImageSizeFromHeader(head: Uint8Array) {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    if (head.byteLength >= 24) return { width: view.getUint32(16), height: view.getUint32(20) }
    return undefined
  }
  if (head[0] !== 0xff || head[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < head.byteLength) {
    if (head[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = head[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // SOF0..SOF15 (bỏ DHT 0xC4, JPG 0xC8, DAC 0xCC) mang kích thước thật của ảnh.
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      return {
        height: (head[offset + 5] << 8) | head[offset + 6],
        width: (head[offset + 7] << 8) | head[offset + 8],
      }
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = (head[offset + 2] << 8) | head[offset + 3]
    if (length < 2) return undefined
    offset += 2 + length
  }
  return undefined
}

/** HEIC/HEIF (Samsung "Ảnh hiệu suất cao", iPhone) — Chrome Android không giải mã được. */
function isHeifHeader(head: Uint8Array) {
  if (head.byteLength < 12) return false
  const box = String.fromCharCode(head[4], head[5], head[6], head[7])
  if (box !== 'ftyp') return false
  const brand = String.fromCharCode(head[8], head[9], head[10], head[11])
  return ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)
}

/**
 * Decode ảnh camera theo EXIF orientation, có fallback cho Safari/iPhone và ảnh HEIC trình duyệt đọc được.
 *
 * `maxSize` (BUG-107): máy Android phổ thông có camera 50MP+ (vd Galaxy A23 SM-A235F).
 * Giải mã full-res tốn ~4 byte/điểm ảnh (50MP ≈ 200MB) nên máy 4GB RAM sẽ treo hoặc bị hệ
 * điều hành giết ngay ở `createImageBitmap`/`canvas.toBlob`. Đọc kích thước từ header rồi
 * yêu cầu trình duyệt giải mã THẲNG về kích thước đích, không bao giờ dựng khung hình gốc.
 */
export async function decodeImageForCanvas(
  blob: Blob,
  options: { maxSize?: number } = {},
): Promise<DecodedCanvasImage> {
  const header = await readImageHeader(blob)
  const maxSize = options.maxSize && options.maxSize > 0 ? options.maxSize : 0
  const longestEdge = header.size ? Math.max(header.size.width, header.size.height) : 0
  const resizeScale = maxSize && longestEdge > maxSize ? maxSize / longestEdge : 0
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
        ...(resizeScale && header.size
          ? {
              resizeWidth: Math.max(1, Math.round(header.size.width * resizeScale)),
              resizeHeight: Math.max(1, Math.round(header.size.height * resizeScale)),
              resizeQuality: 'medium' as const,
            }
          : {}),
      })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Safari cũ/HEIC có thể không đi qua createImageBitmap nhưng vẫn hiển thị được bằng HTMLImageElement.
    }
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(unreadableImageMessage(header.heif)))
    })
    image.src = url
    if (typeof image.decode === 'function') await image.decode()
    else await loaded
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Ảnh camera không có kích thước hợp lệ.')
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    if (header.heif) throw new Error(unreadableImageMessage(true))
    throw error instanceof Error ? error : new Error('Thiết bị không đọc được ảnh camera. Hãy đổi định dạng ảnh hoặc chụp lại.')
  }
}

function unreadableImageMessage(heif: boolean) {
  return heif
    ? 'Ảnh đang ở định dạng HEIC nên trình duyệt không đọc được. Vào Camera → Cài đặt → tắt "Ảnh hiệu suất cao" (HEIF), rồi chụp lại ảnh chấm công.'
    : 'Thiết bị không đọc được định dạng ảnh này.'
}

// Nén ảnh selfie/quầy về JPEG ~1280px để lưu nhẹ (dùng chung cho ảnh đầu/cuối ca).
export async function imageFileToDataUrl(file: File) {
  try {
    const maxSize = 1280
    const decoded = await decodeImageForCanvas(file, { maxSize })
    const scale = Math.min(1, maxSize / Math.max(decoded.width, decoded.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Không thể xử lý ảnh.')
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    decoded.close()
    return canvas.toDataURL('image/jpeg', 0.78)
  } catch {
    return readFileAsDataUrl(file)
  }
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    localStorage.removeItem(key)
    return fallback
  }
}
