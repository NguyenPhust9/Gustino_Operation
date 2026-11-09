// File: gustino_operations/api/n8n/poster-image.ts
// Đặt CÙNG THƯ MỤC với revenue.ts (api/n8n/)
//
// KHUNG ẢNH: 720x1280 (tỉ lệ 9:16), xuất PNG 1440x2560 do deviceScaleFactor 2.
// Chiều cao cố định -> chụp theo viewport, KHÔNG dùng fullPage. Các card dùng
// flex:1 nên tự co giãn lấp đầy khung dù có 3 hay 4 card.
//
// GHI CHÚ VỀ FONT (quan trọng, đừng đổi lại):
// Chromium của @sparticuz/chromium trên Vercel KHÔNG dùng được fontconfig ->
// mọi chữ render ra vô hình. Vì vậy font được TẢI VỀ RỒI NHÚNG THẲNG VÀO CSS
// dưới dạng base64 @font-face. KHÔNG dùng emoji ở bất kỳ đâu (không có font emoji).
// Huy chương, vương miện, vòng nguyệt quế, cúp, sao, mũi tên, dải lá (garland),
// cánh (wing): vẽ bằng SVG inline.
//
// CẬP NHẬT STYLE (theo mẫu tham chiếu):
//  - Thêm dải lá (garland) lấp lánh vắt ngang phía trên logo, có đèn nhỏ điểm xuyết.
//  - Badge số giao dịch dịch ra ĐÚNG GÓC BO TRÒN của card (nửa trong nửa ngoài viền)
//    thay vì nằm sát mép trong như bản cũ.
//  - Cánh (wing) hai bên khung "Cập nhật lúc" được vẽ dày, xòe rõ hơn.
//  - Lớp lấp lánh (sparkle) tăng số lượng, thêm biến thể màu vàng gần logo.
//
// HÌNH MINH HỌA: đặt 4 file PNG vào gustino_operations/public/poster/
//   gold-coast.png | lotte-vt.png | lotte-2310.png | tong.png
// Kích thước gợi ý 400x300. Thiếu file thì card vẫn chạy, chỉ hiện nền gradient.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { timingSafeEqual } from 'node:crypto'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const POSTER_W = 720
const POSTER_H = 1280

const FONT_CACHE_DIR = join(tmpdir(), 'font-cache')

const FONT_REGULAR_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/BeVietnamPro-Regular.ttf'

// Font thân (label, tên chi nhánh, stat...) — giữ Be Vietnam Pro, 3 weight tĩnh, đã chạy ổn định.
const FONTS = [
  { weight: 400, file: 'BeVietnamPro-Regular.ttf', url: FONT_REGULAR_URL },
  {
    weight: 700,
    file: 'BeVietnamPro-Bold.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/BeVietnamPro-Bold.ttf',
  },
  {
    weight: 800,
    file: 'BeVietnamPro-ExtraBold.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/BeVietnamPro-ExtraBold.ttf',
  },
]

// Font tiêu đề/số liệu (title, revenue, badge-num) — Baloo 2: bo tròn, đậm, có hỗ trợ
// tiếng Việt. Google Fonts đóng gói dạng VARIABLE FONT (1 file, trục weight 400-800),
// nên chỉ cần tải 1 lần, không tách 3 file như BVP. Nếu URL này lỗi (Google đổi cấu
// trúc repo), kiểm tra lại tên file chính xác tại:
// https://github.com/google/fonts/tree/main/ofl/baloo2
const DISPLAY_FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/Baloo2%5Bwght%5D.ttf'
const DISPLAY_FONT_FILE = 'Baloo2-Variable.ttf'
const DISPLAY_FONT_FAMILY = 'BaloDisplay'
const DISPLAY_FONT_WEIGHT_RANGE = '400 800'

// TTF: 0x00010000 | 'true'   OTF: 'OTTO'
function isValidFont(buf: Buffer): boolean {
  if (buf.length < 10000) return false
  const tag = buf.subarray(0, 4)
  return (
    (tag[0] === 0x00 && tag[1] === 0x01 && tag[2] === 0x00 && tag[3] === 0x00) ||
    tag.toString('latin1') === 'true' ||
    tag.toString('latin1') === 'OTTO'
  )
}

function safeTokenEqual(provided: unknown, expected: string | undefined): boolean {
  const value = Array.isArray(provided) ? provided[0] : provided
  if (typeof value !== 'string' || !value || !expected) return false
  const providedBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}

// Tải 1 file font (dùng chung logic cache cho cả static weight lẫn variable font).
async function downloadFontFile(file: string, url: string): Promise<Buffer> {
  const path = join(FONT_CACHE_DIR, file)
  try {
    const cached = await readFile(path)
    if (isValidFont(cached)) return cached
  } catch {
    /* chưa có cache */
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Tải font thất bại (${res.status}): ${url}`)
  const dl = Buffer.from(await res.arrayBuffer())
  if (!isValidFont(dl)) throw new Error(`File font không hợp lệ (${dl.length} bytes): ${url}`)
  await writeFile(path + '.tmp', dl)
  await rename(path + '.tmp', path)
  return dl
}

async function buildFontFaceCss(): Promise<string> {
  await mkdir(FONT_CACHE_DIR, { recursive: true })

  const bodyFaces = await Promise.all(
    FONTS.map(async (f) => {
      const buf = await downloadFontFile(f.file, f.url)
      return `@font-face{font-family:"BVP";font-style:normal;font-weight:${f.weight};font-display:block;src:url(data:font/ttf;base64,${buf.toString('base64')}) format("truetype");}`
    }),
  )

  // Font hiển thị (Baloo 2) — variable font, khai báo 1 @font-face với dải weight
  // 400-800; trình duyệt/Chromium tự nội suy độ đậm theo font-weight CSS yêu cầu.
  const displayBuf = await downloadFontFile(DISPLAY_FONT_FILE, DISPLAY_FONT_URL)
  const displayFace = `@font-face{font-family:"${DISPLAY_FONT_FAMILY}";font-style:normal;font-weight:${DISPLAY_FONT_WEIGHT_RANGE};font-display:block;src:url(data:font/ttf;base64,${displayBuf.toString('base64')}) format("truetype");}`

  return [...bodyFaces, displayFace].join('')
}

type RevenueRow = {
  branchId: string
  reportDate: string
  revenue: number
  totalSold: number
}

const BRANCH_META: Record<string, { name: string; img: string; active: boolean }> = {
  'lotte-2310': { name: 'LOTTE 23/10', img: 'lotte-2310.png', active: true },
  'lotte-vt': { name: 'LOTTE VŨNG TÀU', img: 'lotte-vt.png', active: true },
  'gold-coast': { name: 'LOTTE GOLD COAST NT', img: 'gold-coast.png', active: true },
  'passio-pho-quang': { name: 'PASSIO PHỔ QUANG', img: 'passio-pho-quang.png', active: true },
  'passio-dong-den': { name: 'PASSIO ĐỒNG ĐEN', img: 'passio-dong-den.png', active: true },
  // Tạm ẩn; đổi active thành true để đưa 15H trở lại bảng xếp hạng.
  'cn-15h': { name: '15H', img: 'cn-15h.png', active: false },
}

function pctChange(current: number, compare: number): number | null {
  if (!compare) return null
  return Math.round(((current - compare) / compare) * 1000) / 10
}

function fmtVND(v: number) {
  return v.toLocaleString('vi-VN')
}

function fmtPercent(v: number | null) {
  if (v === null) return '0,0%'
  const sign = v > 0 ? '+' : ''
  return sign + v.toString().replace('.', ',') + '%'
}

function pctColor(v: number | null) {
  if (v === null) return '#8a8a8a'
  if (v > 0) return '#12a150'
  if (v < 0) return '#dc2626'
  return '#8a8a8a'
}

function pctArrow(v: number | null) {
  if (v === null || v === 0) return ''
  const up = v > 0
  return `<svg class="arrow" viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
    <path d="${up ? 'M12 3 L21 14 H15 V21 H9 V14 H3 Z' : 'M12 21 L3 10 H9 V3 H15 V10 H21 Z'}"/>
  </svg>`
}

// Cộng/trừ ngày thuần theo lịch, dùng UTC hai đầu để không lệch múi giờ.
function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ---------- Bộ đồ họa SVG ----------

// Vòng nguyệt quế: lá xếp dọc hai cung trái/phải, hở phía trên.
function laurel(color: string, dark: string) {
  const leaves: string[] = []
  const cx = 60
  const cy = 62
  const R = 44
  const N = 8

  for (const side of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      const deg = 150 - t * 130
      const rad = (deg * Math.PI) / 180
      const x = cx + side * R * Math.cos(rad) * 0.78
      const y = cy - R * Math.sin(rad) * 0.02 + (1 - Math.sin(rad)) * 26
      const rot = side * (90 - deg) * 0.9
      const scale = 0.72 + 0.28 * Math.sin(rad)
      leaves.push(
        `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(9 * scale).toFixed(1)}" ry="${(4.6 * scale).toFixed(1)}"
          fill="${i % 2 ? dark : color}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`,
      )
    }
  }
  return leaves.join('')
}

function crown(color: string, dark: string) {
  return `<g>
    <path d="M40 34 L46 16 L55 27 L60 12 L65 27 L74 16 L80 34 Z" fill="${color}" stroke="${dark}" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="40" y="33" width="40" height="7" rx="3" fill="${dark}"/>
    <circle cx="46" cy="15" r="3" fill="${dark}"/>
    <circle cx="60" cy="11" r="3.2" fill="${dark}"/>
    <circle cx="74" cy="15" r="3" fill="${dark}"/>
  </g>`
}

type MedalTheme = { light: string; mid: string; dark: string; leaf: string; leafDark: string }

const MEDAL_THEMES: MedalTheme[] = [
  { light: '#fff3b0', mid: '#f5c518', dark: '#b8860b', leaf: '#f5c518', leafDark: '#c9971a' },
  { light: '#ffffff', mid: '#c9ced4', dark: '#8a9098', leaf: '#c9ced4', leafDark: '#9aa0a8' },
  { light: '#f2c9a0', mid: '#cd7f32', dark: '#8a4f1c', leaf: '#cd7f32', leafDark: '#a1601f' },
]

function medalSvg(rank: number, i: number) {
  const t = MEDAL_THEMES[i] || MEDAL_THEMES[2]
  const gid = `mg${i}`
  return `<svg viewBox="0 0 120 120" width="98" height="98">
    <defs>
      <radialGradient id="${gid}" cx="35%" cy="28%" r="78%">
        <stop offset="0%" stop-color="${t.light}"/>
        <stop offset="55%" stop-color="${t.mid}"/>
        <stop offset="100%" stop-color="${t.dark}"/>
      </radialGradient>
    </defs>
    ${laurel(t.leaf, t.leafDark)}
    ${crown(t.mid, t.dark)}
    <circle cx="60" cy="72" r="30" fill="url(#${gid})" stroke="${t.dark}" stroke-width="2.5"/>
    <circle cx="60" cy="72" r="23" fill="none" stroke="${t.light}" stroke-width="1.5" opacity="0.7"/>
    <text x="60" y="72" text-anchor="middle" dominant-baseline="central"
      font-family="BVP" font-size="34" font-weight="800" fill="#ffffff"
      stroke="${t.dark}" stroke-width="1.2" paint-order="stroke">${rank}</text>
  </svg>`
}

function trophySvg() {
  return `<svg viewBox="0 0 120 120" width="98" height="98">
    <defs>
      <linearGradient id="tg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff3b0"/>
        <stop offset="50%" stop-color="#f5c518"/>
        <stop offset="100%" stop-color="#b8860b"/>
      </linearGradient>
    </defs>
    <path d="M30 22 h60 v22 a30 30 0 0 1 -60 0 z" fill="url(#tg)" stroke="#b8860b" stroke-width="2.5"/>
    <path d="M30 26 h-12 a14 14 0 0 0 14 22" fill="none" stroke="#b8860b" stroke-width="5" stroke-linecap="round"/>
    <path d="M90 26 h12 a14 14 0 0 1 -14 22" fill="none" stroke="#b8860b" stroke-width="5" stroke-linecap="round"/>
    <rect x="53" y="72" width="14" height="14" fill="#c9971a"/>
    <rect x="36" y="86" width="48" height="10" rx="3" fill="url(#tg)" stroke="#b8860b" stroke-width="2"/>
    <rect x="28" y="96" width="64" height="12" rx="4" fill="url(#tg)" stroke="#b8860b" stroke-width="2"/>
    <path d="M60 30 l4.2 9 10 1 -7.4 6.8 2.1 9.8 -8.9 -5.2 -8.9 5.2 2.1 -9.8 -7.4 -6.8 10 -1 z" fill="#ffffff" opacity="0.95"/>
  </svg>`
}

function chestnutSvg() {
  return `<svg viewBox="0 0 40 40" width="28" height="28">
    <path d="M20 6 C29 6 35 14 35 22 C35 30 28 35 20 35 C12 35 5 30 5 22 C5 14 11 6 20 6 z" fill="#7a3f12"/>
    <path d="M20 6 C27 6 32 11 33 17 C28 20 12 20 7 17 C8 11 13 6 20 6 z" fill="#a8622a"/>
    <path d="M18 10 q4 3 4 8" stroke="#e8b87a" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`
}



// Dải lá lấp lánh (garland) vắt ngang phía trên logo, có đèn nhỏ điểm xuyết.
function garlandSvg() {
  const W = POSTER_W
  const step = 54
  const clusters: string[] = []
  const lights: string[] = []

  for (let x = 24, i = 0; x <= W - 24; x += step, i++) {
    // Đường cong nhẹ: thấp hai đầu, hơi nhô lên giữa (chỗ logo sẽ đè lên trên).
    const t = x / W
    const y = 20 - Math.sin(t * Math.PI) * 10
    const rot = (i % 2 === 0 ? -1 : 1) * (18 + (i % 3) * 6)
    clusters.push(
      `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot})">
        <ellipse cx="-8" cy="0" rx="11" ry="5" fill="#2d6e1c"/>
        <ellipse cx="8" cy="-2" rx="11" ry="5" fill="#5fb238"/>
        <ellipse cx="0" cy="-5" rx="9" ry="4.4" fill="#7dd94a"/>
      </g>`,
    )
    if (i % 2 === 0) {
      lights.push(`<circle cx="${x.toFixed(1)}" cy="${(y + 9).toFixed(1)}" r="2.6" fill="#ffe27a"/>`)
    }
  }

  return `<svg class="garland" viewBox="0 0 ${W} 40" width="${W}" height="40" preserveAspectRatio="none">
    <path d="M14 22 Q ${W / 2} 4 ${W - 14} 22" stroke="#2d6e1c" stroke-width="2.5" fill="none" opacity="0.55"/>
    ${clusters.join('')}
    ${lights.join('')}
  </svg>`
}

// Đốm lấp lánh 4 cánh, rải nền — kèm màu để phân biệt vùng gần logo (vàng) và phần còn lại (xanh non).
const SPARKS: [number, number, number, string][] = [
  [30, 46, 20, '#ffe27a'],
  [688, 40, 22, '#ffe27a'],
  [110, 100, 13, '#ffe27a'],
  [600, 96, 15, '#ffe27a'],
  [36, 210, 15, '#eaff9a'],
  [640, 236, 17, '#eaff9a'],
  [70, 330, 12, '#eaff9a'],
  [612, 350, 13, '#eaff9a'],
  [44, 500, 17, '#eaff9a'],
  [648, 520, 15, '#eaff9a'],
  [30, 636, 13, '#eaff9a'],
  [624, 660, 16, '#eaff9a'],
  [40, 800, 15, '#eaff9a'],
  [628, 828, 18, '#eaff9a'],
  [64, 980, 12, '#eaff9a'],
  [614, 1050, 16, '#eaff9a'],
  [340, 30, 12, '#ffe27a'],
  [180, 1210, 14, '#eaff9a'],
  [540, 1215, 12, '#eaff9a'],
]

function sparkleLayer() {
  return SPARKS.map(([x, y, s, color]) => {
    const h = s / 2
    return `<svg class="spark" style="left:${x}px;top:${y}px" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
      <path d="M${h} 0 Q${h * 1.15} ${h * 0.85} ${s} ${h} Q${h * 1.15} ${h * 1.15} ${h} ${s} Q${h * 0.85} ${h * 1.15} 0 ${h} Q${h * 0.85} ${h * 0.85} ${h} 0 z" fill="${color}" opacity="0.9"/>
    </svg>`
  }).join('')
}

function statBlock(label: string, value: number | null) {
  return `<div class="stat">
    <div class="stat-value" style="color:${pctColor(value)}">${fmtPercent(value)}${pctArrow(value)}</div>
    <div class="stat-label">(${label})</div>
  </div>`
}

function buildHtml(params: {
  fontCss: string
  imgBase: string
  branches: { id: string; revenue: number; orders: number; vsYesterday: number | null; vsLastWeek: number | null }[]
  total: number
  totalOrders: number
  totalVsYesterday: number | null
  totalVsLastWeek: number | null
  updatedAt: string
}) {
  const totalCardCount = params.branches.length + 1
  const posterScale = Math.max(0.8, 1 - Math.max(0, totalCardCount - 4) * 0.08)
  const card = (opts: {
    emblem: string
    name: string
    revenue: number
    orders: number
    vsY: number | null
    vsW: number | null
    img: string
    extraClass?: string
  }) => `<div class="card ${opts.extraClass || ''}">
      <div class="emblem">${opts.emblem}</div>
      <div class="card-body">
        <div class="branch-name">${opts.name}</div>
        <div class="revenue">${fmtVND(opts.revenue)} VND</div>
        <div class="stats-row">
          ${statBlock('Vs Hôm qua', opts.vsY)}
          <div class="stat-divider"></div>
          ${statBlock('Vs Ngày này tuần trước', opts.vsW)}
        </div>
      </div>
      <div class="thumb"><img src="${params.imgBase}${opts.img}" onerror="this.style.display='none'"/></div>
      <div class="badge">
        <div class="badge-num">${opts.orders}</div>
        <div class="badge-label">Giao dịch</div>
      </div>
    </div>`

  const cardsHtml = params.branches
    .map((b, i) =>
      card({
        emblem: medalSvg(i + 1, i),
        name: BRANCH_META[b.id].name,
        revenue: b.revenue,
        orders: b.orders,
        vsY: b.vsYesterday,
        vsW: b.vsLastWeek,
        img: BRANCH_META[b.id].img,
      }),
    )
    .join('')

  const totalCardHtml = card({
    emblem: trophySvg(),
    name: 'TỔNG DOANH THU<br/>TOÀN CHUỖI',
    revenue: params.total,
    orders: params.totalOrders,
    vsY: params.totalVsYesterday,
    vsW: params.totalVsLastWeek,
    img: 'tong.png',
    extraClass: 'total-card',
  })

  const css = `
    ${params.fontCss}
    * { box-sizing:border-box; margin:0; padding:0; font-family:"BVP", sans-serif; }
    html, body { width:${POSTER_W}px; height:${POSTER_H}px; overflow:hidden; background:#03130c; }

    /* Khung 9:16 cố định. Cột dọc: header co theo nội dung, vùng card chiếm phần còn lại. */
    .poster { --poster-scale:${posterScale}; position:relative; width:${POSTER_W}px; height:${POSTER_H}px;
      display:flex; flex-direction:column; padding:0 calc(20px * var(--poster-scale)) calc(28px * var(--poster-scale)); overflow:hidden;
      background:
        radial-gradient(ellipse at 50% 0%, rgba(60,200,90,0.28) 0%, rgba(3,19,12,0) 58%),
        linear-gradient(180deg,#0b4a2c 0%,#062f1c 45%,#03150d 100%);
      border:7px solid #7dff2a; box-shadow: inset 0 0 60px 10px rgba(125,255,42,0.30); }
    .poster::after { content:""; position:absolute; inset:6px; border:2px solid rgba(190,255,120,0.45); pointer-events:none; }

    .spark { position:absolute; z-index:0; }

    /* Dải lá lấp lánh vắt ngang phía trên logo */
    .garland-wrap { position:relative; z-index:1; height:0; flex:0 0 auto; }
    .garland { position:absolute; top:calc(-8px * var(--poster-scale)); left:calc(-20px * var(--poster-scale));
      transform:scale(var(--poster-scale)); transform-origin:top left; }

.header { position:relative; z-index:2; text-align:center; flex:0 0 auto;
      margin-top:calc(-4px * var(--poster-scale)); margin-bottom:calc(-10px * var(--poster-scale)); line-height:0; }
    .logo-img { max-width:100%; max-height:calc(125px * var(--poster-scale)); width:auto; height:auto;
      display:block; margin:0 auto; object-fit:contain; }
    .title { position:relative; z-index:1; flex:0 0 auto; text-align:center; color:#ffffff;
      font-family:"${DISPLAY_FONT_FAMILY}", "BVP", sans-serif;
      font-size:calc(38px * var(--poster-scale)); font-weight:800; line-height:1.0; text-transform:uppercase;
      margin:calc(-2px * var(--poster-scale)) 0 calc(-8px * var(--poster-scale));
      text-shadow: 0 0 18px rgba(125,255,42,0.75), 0 4px 0 #06301c, 0 7px 12px rgba(0,0,0,0.6); }

.subtitle-wrap { position:relative; z-index:1; flex:0 0 auto;
   width:100%; height:calc(72px * var(--poster-scale)); margin-top:calc(-4px * var(--poster-scale)); margin-bottom:calc(-10px * var(--poster-scale));
   display:flex; align-items:center; justify-content:center; overflow:visible; }
  .subtitle-wrap::before {
    content:""; position:absolute; left:50%; top:50%;
     width:100%; height:calc(105px * var(--poster-scale)); transform:translate(-50%,-50%);
    background-image:url('${params.imgBase}frame-time.png');
    background-size:contain; background-repeat:no-repeat; background-position:center;
    pointer-events:none; z-index:0;
  }
  .subtitle-text {
  position: relative;
  z-index: 1;
  color: #ffffff;
   font-size: calc(19px * var(--poster-scale));
  font-weight: 800;
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}
    /* Vùng card: chiếm hết chiều cao còn lại, mỗi card flex:1 nên tự chia đều */
    .cards { position:relative; z-index:1; flex:1 1 auto; min-height:0;
      display:flex; flex-direction:column; gap:calc(10px * var(--poster-scale)); }

    .card { flex:1 1 0; min-height:0; position:relative; background:#ffffff;
      border:calc(4px * var(--poster-scale)) solid #a8ff3d; border-radius:calc(20px * var(--poster-scale));
      display:flex; align-items:center; overflow:visible;
      box-shadow: 0 0 calc(20px * var(--poster-scale)) rgba(125,255,42,0.55), inset 0 0 0 calc(3px * var(--poster-scale)) rgba(255,255,255,0.9); }
    .card > .card-body, .card > .thumb, .card > .emblem { overflow:hidden; }
    .thumb { border-top-right-radius:calc(16px * var(--poster-scale)); border-bottom-right-radius:calc(16px * var(--poster-scale)); }
    .emblem { flex:0 0 calc(106px * var(--poster-scale)); display:flex; align-items:center; justify-content:center; }
    .emblem svg { width:calc(98px * var(--poster-scale)); height:calc(98px * var(--poster-scale)); }
    .card-body { flex:1; padding:calc(14px * var(--poster-scale)) calc(8px * var(--poster-scale)) calc(14px * var(--poster-scale)) calc(2px * var(--poster-scale)); min-width:0; border-radius:calc(16px * var(--poster-scale)); }
    .thumb { flex:0 0 calc(188px * var(--poster-scale)); align-self:stretch;
      background:linear-gradient(160deg,#8fd3f4,#c9eaff); }
    .thumb img { width:100%; height:100%; object-fit:cover; display:block; }

    .branch-name { color:#0f5c33; font-size:calc(24px * var(--poster-scale)); font-weight:800; text-transform:uppercase;
      line-height:1.1; margin-bottom:calc(1px * var(--poster-scale)); white-space:nowrap; }
    .revenue { color:#e10600; font-family:"${DISPLAY_FONT_FAMILY}", "BVP", sans-serif;
      font-size:calc(34px * var(--poster-scale)); font-weight:800; letter-spacing:calc(-0.5px * var(--poster-scale));
      margin-bottom:calc(7px * var(--poster-scale)); white-space:nowrap; }

    .stats-row { display:flex; align-items:flex-start; gap:calc(10px * var(--poster-scale)); }
    .stat { text-align:center; }
    .stat-value { font-size:calc(23px * var(--poster-scale)); font-weight:800; display:flex; align-items:center;
      justify-content:center; gap:calc(3px * var(--poster-scale)); line-height:1.1; }
    .stat-label { font-size:calc(11.5px * var(--poster-scale)); color:#6b6b6b; margin-top:calc(1px * var(--poster-scale)); font-weight:400; white-space:nowrap; }
    .stat-divider { width:calc(2px * var(--poster-scale)); align-self:stretch; background:#e2e2e2; }
    .arrow { flex:0 0 auto; width:calc(17px * var(--poster-scale)); height:calc(17px * var(--poster-scale)); }

    /* Badge số giao dịch: đặt NGAY TRÊN nét cong của góc bo card — nửa trong nửa ngoài viền. */
    .badge { position:absolute; top:calc(-22px * var(--poster-scale)); right:calc(-16px * var(--poster-scale));
      width:calc(78px * var(--poster-scale)); height:calc(78px * var(--poster-scale)); border-radius:50%;
      background:#ffffff; border:calc(4px * var(--poster-scale)) solid #f5c518; display:flex; flex-direction:column;
      align-items:center; justify-content:center; box-shadow:0 calc(3px * var(--poster-scale)) calc(10px * var(--poster-scale)) rgba(0,0,0,0.35);
      z-index:3; }
    .badge-num { color:#e10600; font-family:"${DISPLAY_FONT_FAMILY}", "BVP", sans-serif;
      font-size:calc(25px * var(--poster-scale)); font-weight:800; line-height:1; }
    .badge-label { font-size:calc(10.5px * var(--poster-scale)); color:#333333; font-weight:700; margin-top:calc(1px * var(--poster-scale)); }

    .total-card { border-color:#ffd700; box-shadow:0 0 24px rgba(255,215,0,0.7), inset 0 0 0 3px rgba(255,255,255,0.9); }
    .total-card .branch-name { font-size:calc(22px * var(--poster-scale)); white-space:normal; }
  `


  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
    <div class="poster">
      ${sparkleLayer()}
      <div class="garland-wrap">${garlandSvg()}</div>
     <div class="header">
        <img class="logo-img" src="${params.imgBase}logo.png" onerror="this.style.display='none'"/>
      </div>
      <div class="title">BẢNG THI ĐUA DOANH SỐ<br/>CÁC CHI NHÁNH</div>
   <div class="subtitle-wrap">
        <div class="subtitle-text"> ${params.updatedAt}</div>
      </div>
      <div class="cards">
        ${cardsHtml}
        ${totalCardHtml}
      </div>
    </div>
  </body></html>`
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const secret = process.env.N8N_API_SECRET
  const reportWebhookToken = process.env.N8N_REPORT_WEBHOOK_TOKEN
  const hasValidApiKey = safeTokenEqual(req.headers['x-api-key'], secret)
  const hasValidGustinoToken = safeTokenEqual(req.headers['x-gustino-token'], reportWebhookToken)
  if (!hasValidApiKey && !hasValidGustinoToken) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!secret) {
    res.status(500).json({ error: 'Server thiếu biến môi trường N8N_API_SECRET' })
    return
  }

  try {
    // Mặc định lấy ngày theo giờ VN, không phải giờ UTC của Vercel
    const today =
      (req.query.date as string) ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const yesterday = shiftDate(today, -1)
    const lastWeek = shiftDate(today, -7)

    const proto = req.headers['x-forwarded-proto'] || 'https'
    const baseUrl = `${proto}://${req.headers.host}`

    const dataRes = await fetch(`${baseUrl}/api/n8n/revenue?from=${lastWeek}&to=${today}`, {
      headers: { 'x-api-key': secret },
    })
    if (!dataRes.ok) {
      res.status(502).json({ error: 'Không lấy được dữ liệu doanh thu', detail: await dataRes.text() })
      return
    }
    const { rows }: { rows: RevenueRow[] } = await dataRes.json()

    const byDate: Record<string, Record<string, RevenueRow>> = {}
    rows.forEach((r) => {
      byDate[r.reportDate] = byDate[r.reportDate] || {}
      byDate[r.reportDate][r.branchId] = r
    })

    const includeHiddenBranches = process.env.POSTER_INCLUDE_HIDDEN_BRANCHES === 'true'
    const branchIds = Object.entries(BRANCH_META)
      .filter(([, meta]) => meta.active || includeHiddenBranches)
      .map(([id]) => id)
    const getRow = (date: string, id: string): RevenueRow =>
      byDate[date]?.[id] || { branchId: id, reportDate: date, revenue: 0, totalSold: 0 }

    const branches = branchIds
      .map((id) => {
        const curr = getRow(today, id)
        return {
          id,
          revenue: curr.revenue,
          orders: curr.totalSold,
          vsYesterday: pctChange(curr.revenue, getRow(yesterday, id).revenue),
          vsLastWeek: pctChange(curr.revenue, getRow(lastWeek, id).revenue),
        }
      })
      .filter((b) => b.revenue > 0 || b.orders > 0)
      .sort((a, b) => b.revenue - a.revenue)

    const totalToday = branchIds.reduce((s, id) => s + getRow(today, id).revenue, 0)
    const totalYesterday = branchIds.reduce((s, id) => s + getRow(yesterday, id).revenue, 0)
    const totalLastWeek = branchIds.reduce((s, id) => s + getRow(lastWeek, id).revenue, 0)
    const totalOrders = branchIds.reduce((s, id) => s + getRow(today, id).totalSold, 0)

    const updatedAt = new Date().toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    const commonProps = {
      imgBase: `${baseUrl}/poster/`,
      branches,
      total: totalToday,
      totalOrders,
      totalVsYesterday: pctChange(totalToday, totalYesterday),
      totalVsLastWeek: pctChange(totalToday, totalLastWeek),
      updatedAt,
    }

    // Debug: xem HTML thô bằng trình duyệt (máy có sẵn font)
    if (req.query.debug === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.status(200).send(buildHtml({ fontCss: '', ...commonProps }))
      return
    }

    const fontCss = await buildFontFaceCss()
    const html = buildHtml({ fontCss, ...commonProps })

    let browser
    try {
      const viewport = {
        deviceScaleFactor: 2,
        hasTouch: false,
        height: POSTER_H,
        isLandscape: false,
        isMobile: false,
        width: POSTER_W,
      }

      // Nạp font vào /tmp/fonts + dựng fonts.conf. Một số bản không có hàm này.
      const chromiumAny = chromium as any
      if (typeof chromiumAny.font === 'function') {
        try {
          await chromiumAny.font(FONT_REGULAR_URL)
        } catch (e) {
          console.warn('chromium.font() thất bại, chỉ dựa vào base64 @font-face:', e)
        }
      }

      browser = await puppeteer.launch({
        args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
        defaultViewport: viewport,
        executablePath: process.env.POSTER_CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(),
        headless: 'shell',
      })

      const page = await browser.newPage()
      await page.setViewport(viewport)
      await page.setContent(html, { waitUntil: 'load' })
      const fontOk = await page.evaluate(async () => {
        await (document as any).fonts.ready
        const bodyOk = (document as any).fonts.check('800 45px BVP')
        const displayOk = (document as any).fonts.check('800 45px BaloDisplay')
        return { bodyOk, displayOk }
      })
      if (!fontOk.bodyOk) throw new Error('Font BVP không load được trong Chromium')
      if (!fontOk.displayOk) throw new Error('Font BaloDisplay (Baloo 2) không load được trong Chromium')

      // Đợi ảnh minh họa tải xong. Thiếu ảnh cũng không chặn: onerror đã ẩn thẻ img.
      await page.evaluate(
        () =>
          Promise.all(
            Array.from(document.images).map((img) =>
              img.complete
                ? Promise.resolve()
                : new Promise((r) => {
                    img.onload = r
                    img.onerror = r
                  }),
            ),
          ),
      )

      const layout = await page.evaluate(() => {
        const poster = document.querySelector('.poster')!.getBoundingClientRect()
        const elements = Array.from(document.querySelectorAll('.header, .title, .subtitle-wrap, .card'))
        const overflow = elements
          .map((element) => ({ className: element.className, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.left < poster.left - 1 || rect.right > poster.right + 1 || rect.top < poster.top - 1 || rect.bottom > poster.bottom + 1)
          .map(({ className, rect }) => ({ className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }))
        return { overflow }
      })
      if (layout.overflow.length) {
        throw new Error(`Bố cục poster vượt canvas: ${JSON.stringify(layout.overflow)}`)
      }

      // Chụp đúng khung 9:16. KHÔNG dùng fullPage vì chiều cao đã cố định.
      const buffer = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: POSTER_W, height: POSTER_H },
      })

      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).send(Buffer.from(buffer))
    } finally {
      if (browser) await browser.close()
    }
  } catch (err) {
    console.error('poster-image render error:', err)
    res.status(500).json({ error: 'Render failed', detail: String(err) })
  }
}
