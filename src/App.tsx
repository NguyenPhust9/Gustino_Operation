import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AppShell, type InventoryTab, type Page } from './components/AppShell'
import { fetchMovements, fetchMovementsDelta, loadLocalUser, saveLocalUser } from './lib/store'
import { reconcileOperationalShift } from './lib/shiftAutoOpen'
import { flushAttendanceOutbox } from './lib/attendance'
import { attendanceOutboxSendableFastCount } from './lib/attendanceOutbox'
import { shouldUseLanApi, supabase, uniqueChannelName } from './lib/supabase'
import { burstGuard } from './lib/browser'
import { LauncherPage } from './pages/LauncherPage'
import { LoginPage } from './pages/LoginPage'
import type { AdminSection } from './pages/AdminPage'
import { adminRouteForSection, adminSectionForRoute } from './pages/admin/routeMap'
import { canOpenAdminConsole, canUseAdmin, canUseKitchen, canUseManagement, canUseOperations, canUseSales, hasSystemWideScope, normalizeRole } from './lib/access'
import { clearSessionStart, markSessionStart, sessionOverdueMs, setSessionExpiredNotice } from './lib/sessionExpiry'
import { fetchConfiguredProducts, subscribeConfiguredProducts } from './lib/products'
import { canReceivePayslip } from './lib/payroll'
import type { AppUser, StockMovement } from './types'
import { applyLanguageToDocument, useLang } from './lib/i18n'
import { CapyLoadingWindow } from './components/GlobalLoadingOverlay'
import { LazyRouteErrorBoundary } from './components/LazyRouteErrorBoundary'
import { lazyWithReload } from './lib/lazyRoute'

const InventoryPage = lazyWithReload(() => import('./pages/InventoryPage').then((module) => ({ default: module.InventoryPage })))
const ReportPage = lazyWithReload(() => import('./pages/ReportPage').then((module) => ({ default: module.ReportPage })))
const ReportArchivePage = lazyWithReload(() => import('./pages/ReportArchivePage').then((module) => ({ default: module.ReportArchivePage })))
const RestaurantPage = lazyWithReload(() => import('./pages/RestaurantPage').then((module) => ({ default: module.RestaurantPage })))
const SalesPage = lazyWithReload(() => import('./pages/SalesPage').then((module) => ({ default: module.SalesPage })))
const MyRecordsPage = lazyWithReload(() => import('./pages/MyRecordsPage').then((module) => ({ default: module.MyRecordsPage })))
const TodayPage = lazyWithReload(() => import('./pages/TodayPage').then((module) => ({ default: module.TodayPage })))
const AttendancePage = lazyWithReload(() => import('./pages/AttendancePage').then((module) => ({ default: module.AttendancePage })))
const ShiftHandoverPage = lazyWithReload(() => import('./pages/ShiftHandoverPage').then((module) => ({ default: module.ShiftHandoverPage })))
const ManagementPage = lazyWithReload(() => import('./pages/AdminPage').then((module) => ({ default: module.ManagementPage })))
const KitchenPage = lazyWithReload(() => import('./pages/KitchenPage').then((module) => ({ default: module.KitchenPage })))
const OrdersPage = lazyWithReload(() => import('./pages/OrdersPage').then((module) => ({ default: module.OrdersPage })))
const ManagerDashboardPage = lazyWithReload(() => import('./pages/ManagerDashboardPage').then((module) => ({ default: module.ManagerDashboardPage })))
const ControlCenterPage = lazyWithReload(() => import('./pages/ControlCenterPage').then((module) => ({ default: module.ControlCenterPage })))
const MyTimesheetPage = lazyWithReload(() => import('./pages/MyTimesheetPage').then((module) => ({ default: module.MyTimesheetPage })))
const PayrollPage = lazyWithReload(() => import('./pages/PayrollPage').then((module) => ({ default: module.PayrollPage })))
const MyPayslipsPage = lazyWithReload(() => import('./pages/MyPayslipsPage').then((module) => ({ default: module.MyPayslipsPage })))
const MessagesPage = lazyWithReload(() => import('./pages/MessagesPage').then((module) => ({ default: module.MessagesPage })))
const GustinoAnalystPage = lazyWithReload(() => import('./pages/GustinoAnalystPage').then((module) => ({ default: module.GustinoAnalystPage })))

function App() {
  const lang = useLang()
  const [user, setUser] = useState<AppUser | null>(() => {
    const saved = loadLocalUser()
    if (saved?.authToken && supabase && !shouldUseLanApi(saved)) return null
    return saved ? { ...saved, role: normalizeRole(saved.role) } : null
  })
  const [page, setPage] = useState<Page>(() => pageFromHash())
  const [authReady, setAuthReady] = useState(!supabase)
  const [movements, setMovements] = useState<StockMovement[]>([])
  /**
   * Trạng thái nạp sổ kho. Trước đây chỉ có mảng `movements` rỗng: trang Kho
   * dựng bảng từ mảng rỗng nên hiện ĐÚNG SỐ 0 cho mọi mặt hàng, và nếu lượt tải
   * lỗi (4G chập chờn) thì `void refreshMovements()` nuốt luôn lỗi — màn hình
   * đứng ở toàn số 0 cho tới nhịp 15 giây kế tiếp mới "tự nhiên" hiện số thật.
   * Đúng hiện tượng chủ quán mô tả: "mất thành 0 hết rồi một lúc sau mới ra".
   */
  const [movementsStatus, setMovementsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>('overview')
  const [mgmtSection, setMgmtSection] = useState<AdminSection | undefined>(() => managementSectionFromHash())
  const needsMovements = ['today', 'restaurant', 'report', 'inventory', 'handover', 'orders'].includes(page)

  // Mốc đồng bộ sổ kho: chi nhánh + dòng mới nhất đã có.
  const movementSyncRef = useRef<{ branchId: string; latestCreatedAt: string } | null>(null)
  // Bản sao đồng bộ của `movements` để nhịp nền đối chiếu mà không phải đưa
  // `movements` vào deps (đưa vào là mỗi lần có phiếu mới lại dựng lại bộ đếm).
  const movementsRef = useRef<StockMovement[]>([])

  const applyMovements = useCallback((next: StockMovement[] | ((current: StockMovement[]) => StockMovement[])) => {
    setMovements((current) => {
      const value = typeof next === 'function' ? next(current) : next
      movementsRef.current = value
      return value
    })
  }, [])

  const refreshMovements = useCallback(async () => {
    if (!user) return
    const hadData = movementSyncRef.current?.branchId === user.branchId
    if (!hadData) setMovementsStatus('loading')
    try {
      const data = await fetchMovements(user.branchId, user)
      movementSyncRef.current = {
        branchId: user.branchId,
        latestCreatedAt: latestMovementStamp(data, ''),
      }
      applyMovements((current) => movementFingerprint(current) === movementFingerprint(data) ? current : data)
      setMovementsStatus('ready')
    } catch (error) {
      // Giữ nguyên số đang hiển thị nếu đã từng tải được: số cũ vài phút vẫn
      // đúng hơn một bảng toàn 0. Chỉ báo lỗi để trang Kho hiện nút "Tải lại".
      setMovementsStatus(hadData ? 'ready' : 'error')
      throw error
    }
  }, [user, applyMovements])

  /**
   * Nhịp nền chỉ kéo phần MỚI của sổ kho. Tải lại toàn bộ lịch sử mỗi 15 giây là
   * lý do app ngày càng ì (mỗi chi nhánh đã ~2.800 dòng và mỗi ngày thêm ~90).
   *
   * Phát hiện XOÁ phiếu: máy chủ trả số dòng của vài ngày gần nhất; đem so với
   * chính danh sách đang giữ trong máy trong cùng cửa sổ đó. Lệch = có dòng bị
   * xoá/sửa ⇒ tải đầy đủ lại. Bản trước so bằng `count exact` trên TOÀN chi
   * nhánh, chạy 15 giây một lần — chính là truy vấn 2 giây đã ngốn 8,7 giờ CPU
   * database và trả HTTP 500 khi quá hạn.
   */
  const syncMovements = useCallback(async () => {
    if (!user) return
    const state = movementSyncRef.current
    if (!state || state.branchId !== user.branchId || !state.latestCreatedAt) return refreshMovements()
    // Lỗi ở nhịp gia số (mạng rớt, timeout) không được làm chết việc đồng bộ:
    // nuốt lỗi rồi thôi thì máy đứng ở số cũ mà không ai biết. Hỏng nhịp nhẹ thì
    // quay về đường tải đầy đủ.
    const delta = await fetchMovementsDelta(user.branchId, state.latestCreatedAt, user).catch(() => null)
    if (!delta) return refreshMovements()
    const known = new Set(movementsRef.current.map((item) => item.id))
    const fresh = delta.rows.filter((item) => !known.has(item.id))
    const recentInMemory = movementsRef.current
      .filter((item) => item.shiftDate >= delta.recentSince)
      .length
      + fresh.filter((item) => item.shiftDate >= delta.recentSince).length
    if (delta.recentTotal !== recentInMemory) return refreshMovements()
    if (!fresh.length) return
    movementSyncRef.current = {
      branchId: user.branchId,
      latestCreatedAt: latestMovementStamp(delta.rows, state.latestCreatedAt),
    }
    // Cả hai danh sách đều sắp xếp mới → cũ nên ghép đầu là giữ đúng thứ tự.
    applyMovements((current) => [...fresh, ...current])
  }, [user, refreshMovements, applyMovements])

  useEffect(() => {
    if (!supabase) return
    const saved = loadLocalUser()
    if (saved?.authToken && shouldUseLanApi(saved)) {
      setAuthReady(true)
      return
    }
    if (saved?.authToken) saveLocalUser(null)
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (!data.session) {
        setUser((current) => {
          if (current?.authToken) return current
          saveLocalUser(null)
          return null
        })
      }
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        setUser((current) => {
          if (current?.authToken) return current
          saveLocalUser(null)
          navigate('launcher')
          return null
        })
      }
      setAuthReady(true)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (!needsMovements) return
    // Mỗi lần bước vào một trang cần sổ kho, bản cũ tải lại TOÀN BỘ lịch sử
    // (2 lượt mạng: đếm dòng + các trang dữ liệu). Chi nhánh đã có sẵn dữ liệu
    // trong phiên thì chỉ cần kéo phần mới — mở màn Kho không còn phải chờ.
    const warm = movementSyncRef.current?.branchId === user?.branchId
    void (warm ? syncMovements() : refreshMovements()).catch(() => undefined)
  }, [needsMovements, refreshMovements, syncMovements, user?.branchId])
  useEffect(() => {
    if (!user || !needsMovements) return
    let ticks = 0
    const timer = window.setInterval(() => {
      // Máy đang trong túi/khoá màn hình thì không kéo dữ liệu về làm gì.
      if (document.hidden) return
      ticks += 1
      // Khoảng 2,5 phút tải đầy đủ một lần để bắt cả sửa/xoá ở quá khứ.
      void (ticks % 10 === 0 ? refreshMovements() : syncMovements()).catch(() => undefined)
    }, 15000)
    const resume = () => {
      if (!document.hidden) void syncMovements().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
    }
  }, [refreshMovements, syncMovements, needsMovements, user])
  // Bộ dò ca: mở ca vận hành còn thiếu từ BẤT KỲ trang nào, không chỉ Chấm công
  // và Bàn giao. Ca trưởng check-in lỗi mạng vẫn được mở ca ngay khi còn dùng app.
  // Idempotent + tự bỏ qua rất sớm nếu ca đã mở, nên chạy lặp không tốn gì.
  useEffect(() => {
    if (!user || user.role !== 'shift_leader') return
    let active = true
    const state = { busy: false }
    const attempt = async () => {
      if (!active || state.busy) return
      state.busy = true
      try {
        await reconcileOperationalShift(user)
      } catch {
        // Im lặng: đây là lưới an toàn chạy nền, lần sau thử lại.
      } finally {
        state.busy = false
      }
    }
    void attempt()
    const timer = window.setInterval(() => void attempt(), 60000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [user?.id, user?.branchId, user?.role])
  // Hộp thư đi chấm công (BUG-118): lượt check-in/check-out chưa lên được máy chủ
  // được gửi lại nền từ BẤT KỲ trang nào (staff mở app là vào Bán hàng, không phải
  // Chấm công). Mỗi nhịp đọc IndexedDB cục bộ làm nguồn authoritative; localStorage
  // chỉ là hint và không được phép làm bỏ quên bằng chứng.
  useEffect(() => {
    if (!user) return
    let active = true
    const attempt = () => {
      if (!active || document.hidden) return
      void flushAttendanceOutbox(user).catch(() => undefined)
    }
    attempt()
    const timer = window.setInterval(attempt, 45000)
    window.addEventListener('online', attempt)
    window.addEventListener('focus', attempt)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', attempt)
      window.removeEventListener('focus', attempt)
    }
  }, [user?.id])
  // Phiên đăng nhập tự hết hạn sau 24 giờ: token + hồ sơ để lâu ngày là nguồn của
  // lớp lỗi "treo đăng nhập" (quyền/chi nhánh cũ, phiên hỏng giữa chừng). Kiểm tra
  // lúc mở app, khi quay lại tab và mỗi 5 phút; hết hạn thì đăng xuất kèm lời giải thích.
  useEffect(() => {
    if (!user) return
    let active = true
    // Hết hạn đúng lúc hộp thư chấm công còn bằng chứng CHƯA GỬI ĐƯỢC thì hoãn:
    // đăng xuất lúc đó buộc bằng chứng nằm chờ tới lần đăng nhập sau. Nhịp flush 45s
    // thường dọn sạch trong vài phút; quá SESSION_OUTBOX_GRACE_MS vẫn đăng xuất.
    // Ân hạn tính theo mốc ĐĂNG NHẬP (sessionOverdueMs) chứ không theo lần đầu phát
    // hiện quá hạn, nếu không mỗi lần mở lại app là được cộng thêm một khoảng ân hạn.
    // Op needs-review đã bị cách ly (chỉ quản lý xử lý được) nên KHÔNG tính vào đây.
    const check = () => {
      if (!active) return
      const overdueMs = sessionOverdueMs()
      if (!overdueMs) return
      const waitingEvidence = attendanceOutboxSendableFastCount(user.id) > 0
      if (waitingEvidence && overdueMs < SESSION_OUTBOX_GRACE_MS) return
      setSessionExpiredNotice()
      void logout()
    }
    check()
    const timer = window.setInterval(check, 5 * 60 * 1000)
    const resume = () => {
      if (!document.hidden) check()
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
    }
  }, [user?.id])
  useEffect(() => {
    if (!user || !needsMovements || !supabase || user.authToken) return
    const client = supabase
    // KHÔNG lọc `branch_id` ở phía Supabase cho bảng này.
    //
    // Realtime so khớp `filter` với chính DÒNG vừa đổi. Với DELETE, dòng cũ chỉ
    // còn các cột thuộc REPLICA IDENTITY — `stock_movements` đang để mặc định
    // (`relreplident = 'd'`) nên payload chỉ có `id`, KHÔNG có `branch_id`. Điều
    // kiện `branch_id=eq...` vì thế không bao giờ khớp và event xoá bị bỏ rơi:
    // máy khác không hề biết phiếu đã bị xoá, chỉ tình cờ phát hiện ở nhịp đếm
    // 15 giây. Bỏ filter thì event xoá về được (đây cũng là cách ManagerDashboard
    // và AdminPage đang nghe và chúng vẫn nhận đúng).
    //
    // Đổi lại, máy nhận cả event của chi nhánh khác nên phải tự lọc: INSERT/UPDATE
    // biết `branch_id` thì bỏ qua chi nhánh lạ; DELETE không biết chi nhánh nên
    // đành tải đầy đủ — xoá phiếu là việc hiếm, còn bỏ sót thì sai số kho.
    const bumpDelta = burstGuard(() => void syncMovements(), 600)
    const bumpFull = burstGuard(() => void refreshMovements(), 600)
    const channel = client.channel(uniqueChannelName(`app-stock:${user.branchId}`))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'stock_movements',
      }, (payload) => {
        if (payload.eventType === 'DELETE') return bumpFull()
        const branchId = (payload.new as { branch_id?: string } | null)?.branch_id
        if (branchId && branchId !== user.branchId) return
        bumpDelta()
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'operation_days',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void syncMovements())
      .subscribe()
    return () => {
      bumpDelta.cancel()
      bumpFull.cancel()
      void client.removeChannel(channel)
    }
  }, [refreshMovements, syncMovements, needsMovements, user])
  useEffect(() => {
    // Menu/SKU dùng chung toàn hệ thống: kéo từ Supabase về và nghe realtime
    // để mọi thiết bị (ca trưởng, POS, kho, admin) nhìn cùng một danh mục.
    if (!user) return
    void fetchConfiguredProducts(user).catch(() => null)
    return subscribeConfiguredProducts(user, () => {
      void fetchConfiguredProducts(user).catch(() => null)
    })
  }, [user?.id, user?.authToken])
  useEffect(() => {
    if (!user || !supabase || user.authToken) return
    let active = true
    void (async () => {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, branch_id, active')
        .eq('id', user.id)
        .maybeSingle()
      if (!active || error) return
      const role = normalizeRole((profile?.role || user.role) as AppUser['role'])
      const branchId = profile?.branch_id || user.branchId
      let blocked = !profile || profile.active === false
      if ((role === 'staff' || role === 'shift_leader' || role === 'cashier') && !branchId) blocked = true
      if (!blocked && (role === 'staff' || role === 'shift_leader' || role === 'cashier')) {
        const { data: branch } = await supabase
          .from('branches')
          .select('id, active')
          .eq('id', branchId)
          .maybeSingle()
        blocked = !branch || branch.active === false
      }
      if (!active || !blocked) return
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      saveLocalUser(null)
      setUser(null)
      navigate('launcher')
    })()
    return () => {
      active = false
    }
  }, [user?.id, user?.branchId, user?.role, user?.authToken])
  useEffect(() => {
    if (!user || !supabase || user.authToken || !(canUseManagement(user.role) || user.role === 'supmt')) return
    let active = true
    void (async () => {
      let nextBranchIds: string[] = []
      // SUP MT đối chiếu toàn hệ thống nên nhận mọi chi nhánh active như admin.
      if (hasSystemWideScope(user.role)) {
        const { data } = await supabase
          .from('branches')
          .select('id')
          .eq('active', true)
        nextBranchIds = (data || []).map((item: { id: string }) => item.id)
      } else {
        const { data: assignments } = await supabase
          .from('manager_branch_assignments')
          .select('branch_id')
          .eq('manager_id', user.id)
        nextBranchIds = Array.from(new Set([
          user.branchId,
          ...((assignments || []) as Array<{ branch_id: string }>).map((item) => item.branch_id),
        ].filter(Boolean)))
      }
      if (!active || !nextBranchIds.length) return
      setUser((current) => {
        if (!current || current.id !== user.id) return current
        const nextBranchId = nextBranchIds.includes(current.branchId) ? current.branchId : nextBranchIds[0]
        const currentIds = [...(current.branchIds || [])].sort().join('|')
        const nextIds = [...nextBranchIds].sort().join('|')
        if (current.branchId === nextBranchId && currentIds === nextIds) return current
        const next = { ...current, branchId: nextBranchId, branchIds: nextBranchIds }
        saveLocalUser(next)
        return next
      })
    })()
    return () => {
      active = false
    }
  }, [user?.id, user?.role, user?.authToken])
  useEffect(() => {
    const onHashChange = () => {
      setPage(pageFromHash())
      setMgmtSection(managementSectionFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    const onProfileUpdated = (event: Event) => {
      const patch = (event as CustomEvent<Partial<AppUser> & { id?: string }>).detail
      if (!patch?.id) return
      setUser((current) => {
        if (!current || current.id !== patch.id) return current
        const next = { ...current, ...patch, role: normalizeRole(patch.role || current.role) }
        saveLocalUser(next)
        return next
      })
    }
    window.addEventListener('gustino:user-profile-updated', onProfileUpdated)
    return () => window.removeEventListener('gustino:user-profile-updated', onProfileUpdated)
  }, [])
  useEffect(() => {
    if (!user) return
    if (page === 'launcher') {
      navigate(defaultPageForRole(user))
      return
    }
    if (!canAccessPage(user, page)) navigate(defaultPageForRole(user))
  }, [page, user])
  useEffect(() => {
    window.requestAnimationFrame(() => applyLanguageToDocument(lang))
  }, [lang, page, user])

  function navigate(nextPage: Page, section?: string) {
    setPage(nextPage)
    const nextSection = nextPage === 'management' ? ((section || 'overview') as AdminSection) : undefined
    setMgmtSection(nextSection)
    const nextHash = nextPage === 'management' ? `#${adminRouteForSection(nextSection!)}` : `#${nextPage}`
    if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash)
  }

  function handleLogin(nextUser: AppUser) {
    const normalizedUser = { ...nextUser, role: normalizeRole(nextUser.role) }
    applyMovements([])
    setMovementsStatus('loading')
    movementSyncRef.current = null
    saveLocalUser(normalizedUser)
    markSessionStart()
    setUser(normalizedUser)
    navigate(defaultPageForRole(normalizedUser))
  }

  function openInventory(tab: InventoryTab) {
    setInventoryTab(tab)
    navigate('inventory')
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
    saveLocalUser(null)
    clearSessionStart()
    setUser(null)
    navigate('launcher')
  }

  if (!authReady) return <CapyLoadingWindow forced label="Đang kiểm tra phiên đăng nhập…" />
  if (!user) return <LoginPage onLogin={handleLogin} />
  if (!canAccessPage(user, page)) return <PageLoadFallback label="Đang chuyển đến màn hình phù hợp…" />
  if (page === 'launcher') {
    return (
      <LauncherPage
        user={user}
        onOpenOperations={() => navigate('today')}
        onOpenSales={() => navigate('sales')}
        onOpenAttendance={() => navigate('attendance')}
        onOpenManagement={() => navigate('management')}
        onOpenKitchen={() => navigate('kitchen')}
        onLogout={logout}
      />
    )
  }

  return (
    <AppShell user={user} page={page} currentSection={mgmtSection} onNavigate={navigate} onLogout={logout}>
      <div key={page} className="page-transition">
        <LazyRouteErrorBoundary key={page}>
          <Suspense fallback={<PageLoadFallback />}>
        {page === 'today' && <TodayPage user={user} movements={movements} onNavigate={navigate} onOpenInventory={openInventory} />}
        {page === 'dashboard' && user.role === 'manager' && <ManagerDashboardPage user={user} onNavigate={navigate} />}
        {page === 'sales' && <SalesPage user={user} onNavigate={navigate} />}
        {page === 'my-records' && <MyRecordsPage user={user} onNavigate={navigate} />}
        {page === 'my-timesheet' && <MyTimesheetPage user={user} />}
        {page === 'my-payslips' && <MyPayslipsPage user={user} />}
        {page === 'messages' && <MessagesPage user={user} />}
        {page === 'report-archive' && <ReportArchivePage user={user} />}
        {page === 'restaurant' && <RestaurantPage user={user} movements={movements} />}
        {page === 'report' && <ReportPage user={user} movements={movements} onNavigate={navigate} onOpenInventory={openInventory} onRefresh={refreshMovements} />}
        {page === 'inventory' && (
          <InventoryPage
            user={user}
            movements={movements}
            movementsStatus={movementsStatus}
            onChanged={refreshMovements}
            initialTab={inventoryTab}
            onNavigate={navigate}
          />
        )}
        {page === 'handover' && (
          <ShiftHandoverPage
            user={user}
            movements={movements}
            onChanged={refreshMovements}
            onNavigate={navigate}
          />
        )}
        {page === 'orders' && <OrdersPage user={user} movements={movements} />}
        {page === 'attendance' && <AttendancePage user={user} movements={movements} onNavigate={navigate} />}
        {page === 'management' && canOpenAdminConsole(user.role) && <ManagementPage user={user} initialSection={mgmtSection} onNavigate={navigate} />}
        {page === 'manager-revenue' && canUseManagement(user.role) && <ManagementPage user={user} initialSection="revenue" focused onNavigate={navigate} />}
        {page === 'manager-business' && canUseManagement(user.role) && <ManagementPage user={user} initialSection="commission" focused onNavigate={navigate} />}
        {page === 'manager-inventory' && canUseManagement(user.role) && <ManagementPage user={user} initialSection="inventory" focused onNavigate={navigate} />}
        {page === 'manager-attendance' && canUseAdmin(user.role) && <ManagementPage user={user} initialSection="attendance" focused onNavigate={navigate} />}
        {page === 'manager-payroll' && user.role === 'admin' && <PayrollPage user={user} />}
        {page === 'manager-requests' && canUseAdmin(user.role) && <ManagementPage user={user} initialSection="requests" focused onNavigate={navigate} />}
        {page === 'admin-accounts' && canUseAdmin(user.role) && <ManagementPage user={user} initialSection="accounts" focused onNavigate={navigate} />}
        {page === 'control' && canUseAdmin(user.role) && <ControlCenterPage user={user} />}
        {page === 'gustino-analyst' && user.role === 'admin' && <GustinoAnalystPage user={user} />}
        {page === 'kitchen' && canUseKitchen(user.role) && <KitchenPage user={user} />}
            <RouteLoadSettled />
          </Suspense>
        </LazyRouteErrorBoundary>
      </div>
    </AppShell>
  )
}

function PageLoadFallback({ label = 'Đang mở màn hình…' }: { label?: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (sessionStorage.getItem(ROUTE_LOAD_WATCHDOG_KEY) === '1') return
        sessionStorage.setItem(ROUTE_LOAD_WATCHDOG_KEY, '1')
        window.location.reload()
      } catch {
        // A visible loading state remains safer than an unbounded reload loop.
      }
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [])
  return <CapyLoadingWindow forced label={label} />
}

const ROUTE_LOAD_WATCHDOG_KEY = 'gustino:route-load-watchdog'

/** Trần thời gian hoãn đăng xuất 24h khi hộp thư chấm công còn hàng chờ. */
const SESSION_OUTBOX_GRACE_MS = 2 * 60 * 60 * 1000

function RouteLoadSettled() {
  useEffect(() => {
    try {
      sessionStorage.removeItem(ROUTE_LOAD_WATCHDOG_KEY)
    } catch {
      // Storage can be unavailable in strict privacy modes.
    }
  }, [])
  return null
}

function pageFromHash(): Page {
  const hashPath = window.location.hash.replace(/^#/, '')
  if (hashPath.startsWith('/admin/')) return 'management'
  const candidate = hashPath.split('/')[0]
  if (candidate === 'history') return 'orders'
  if (candidate === 'admin') return 'management'
  return [
    'launcher',
    'dashboard',
    'today',
    'sales',
    'my-records',
    'my-timesheet',
    'my-payslips',
    'messages',
    'report-archive',
    'restaurant',
    'report',
    'inventory',
    'handover',
    'orders',
    'attendance',
    'management',
    'manager-revenue',
    'manager-business',
    'manager-inventory',
    'manager-attendance',
    'manager-payroll',
    'manager-requests',
    'admin-accounts',
    'control',
    'gustino-analyst',
    'kitchen',
  ].includes(candidate)
    ? candidate as Page
    : 'launcher'
}

function managementSectionFromHash(): AdminSection | undefined {
  const path = window.location.hash.replace(/^#/, '')
  if (path.startsWith('/admin/')) return adminSectionForRoute(path)
  const [page, section] = path.split('/')
  if (page !== 'management') return undefined
  return ['overview', 'revenue', 'attendance', 'commission', 'inventory', 'requests', 'accounts'].includes(section)
    ? section as AdminSection
    : 'overview'
}

export default App

/**
 * Dấu vân tay rẻ để bỏ qua setState khi dữ liệu không đổi. Bản cũ nối chuỗi qua
 * TOÀN BỘ mảng hai lần mỗi nhịp 15 giây — vài nghìn dòng là thấy giật ngay.
 */
function movementFingerprint(items: StockMovement[]) {
  let quantitySum = 0
  for (const item of items) quantitySum += item.quantity
  const first = items[0]
  const last = items[items.length - 1]
  return `${items.length}:${quantitySum}:${first?.id || ''}:${first?.createdAt || ''}:${last?.id || ''}`
}

function latestMovementStamp(items: StockMovement[], fallback: string) {
  let latest = fallback
  for (const item of items) if (item.createdAt > latest) latest = item.createdAt
  return latest
}

function canAccessPage(user: AppUser, page: Page) {
  if (page === 'launcher') return true
  if (page === 'messages') return true
  if (page === 'attendance') return user.role !== 'kitchen' && user.role !== 'manager' && user.role !== 'cashier'
  if (page === 'dashboard') return user.role === 'manager'
  if (page === 'sales') return canUseSales(user.role)
  if (page === 'my-records') return user.role === 'staff' || user.role === 'shift_leader'
  // Xem công: nhân viên/ca trưởng xem lịch công của chính mình (SUP MT xem được nếu tồn tại).
  if (page === 'my-timesheet') return user.role === 'staff' || user.role === 'shift_leader' || user.role === 'supmt'
  if (page === 'my-payslips') return canReceivePayslip(user.role)
  if (page === 'report-archive') return canUseManagement(user.role)
  if (page === 'report') return canUseOperations(user.role)
  if (page === 'inventory') return canUseOperations(user.role)
  // Admin không phải người đặt hàng: admin theo dõi/lọc/xuất đơn ở mục Đặt hàng trong trang
  // Quản trị (#/management/requests), nên không vào trang lập phiếu đặt hàng của chi nhánh.
  if (page === 'orders') return user.role !== 'admin' && (canUseManagement(user.role) || canUseOperations(user.role))
  // SUP MT vào cùng trang Quản trị với admin, nhưng ManagementPage khóa mọi thao tác ghi.
  if (page === 'management') return canOpenAdminConsole(user.role)
  if (page === 'manager-attendance') return canUseAdmin(user.role)
  if (page === 'manager-payroll') return canUseAdmin(user.role)
  if (page === 'manager-requests') return canUseAdmin(user.role)
  if (['manager-revenue', 'manager-business', 'manager-inventory'].includes(page)) return user.role === 'manager'
  if (page === 'admin-accounts') return canUseAdmin(user.role)
  if (page === 'control') return canUseAdmin(user.role)
  if (page === 'gustino-analyst') return user.role === 'admin'
  if (page === 'kitchen') return canUseKitchen(user.role)
  return canUseOperations(user.role)
}

function defaultPageForRole(user: AppUser): Page {
  if (user.role === 'kitchen') return 'kitchen'
  if (user.role === 'staff' || user.role === 'cashier') return 'sales'
  if (user.role === 'admin') return 'management'
  if (user.role === 'manager') return 'dashboard'
  // SUP MT mở thẳng trang Quản trị (chỉ xem); màn chấm công cá nhân nằm ở mục riêng.
  if (user.role === 'supmt') return 'management'
  if (canUseOperations(user.role)) return 'today'
  return 'attendance'
}
