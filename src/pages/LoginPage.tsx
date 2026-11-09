import { useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { AppUser, Role } from '../types'
import { isRoamingStaffIdentity, normalizeRole } from '../lib/access'
import { usernameToEmail } from '../lib/authIdentity'
import { consumeSessionExpiredNotice } from '../lib/sessionExpiry'
import { AppFooter } from '../components/AppFooter'

interface Props {
  onLogin: (user: AppUser) => void
}

const LEGACY_ACCOUNT_DOMAIN = 'gustino.vn'

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [branchId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Bị đăng xuất vì phiên quá 24 giờ → giải thích rõ để nhân viên không tưởng là lỗi.
  const [sessionNotice] = useState(() => consumeSessionExpiredNotice())

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const cleanPassword = password.trim()
      if (cleanPassword.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.')

      if (supabase && isSupabaseConfigured) {
        let email = usernameToEmail(username)
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
        let { data, error: authError } = await supabase.auth.signInWithPassword({ email, password: cleanPassword })
        if (authError && !username.includes('@') && authError.message.toLowerCase().includes('invalid login')) {
          const legacyEmail = `${username.trim().toLowerCase()}@${LEGACY_ACCOUNT_DOMAIN}`
          const legacyResult = await supabase.auth.signInWithPassword({ email: legacyEmail, password: cleanPassword })
          if (!legacyResult.error) {
            email = legacyEmail
            data = legacyResult.data
            authError = null
          }
        }
        if (authError) throw new Error(
          authError.message.toLowerCase().includes('invalid login')
            ? 'Tên đăng nhập hoặc mật khẩu không đúng.'
            : authError.message,
        )
        if (!data.user) throw new Error('Không thể đăng nhập. Vui lòng thử lại.')
        const metadata = data.user.user_metadata
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, role, branch_id, can_roam_branches, active, employment_type, position_title, avatar_url')
          .eq('id', data.user.id)
          .maybeSingle()
        if (!profile || profile.active === false) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
          throw new Error('Tài khoản này đã bị khóa hoặc chưa được cấp hồ sơ nhân sự.')
        }
        const role = normalizeRole((profile?.role || metadata.role || 'shift_leader') as Role)
        const canRoamBranches = Boolean(profile?.can_roam_branches) || isRoamingStaffIdentity({
          name: profile?.full_name || metadata.full_name || username,
          email,
        })
        let profileBranchId = profile?.branch_id || metadata.branch_id || branchId
        let branchIds: string[] = []
        // SUP MT (giám sát) hoặc nhân sự lưu động (canRoamBranches) thấy mọi chi nhánh active.
        if (role === 'admin' || role === 'supmt' || canRoamBranches) {
          const { data: activeBranches } = await supabase
            .from('branches')
            .select('id')
            .eq('active', true)
          const activeBranchList = ((activeBranches || []) as Array<{ id: string }>).map((item) => item.id)
          if (canRoamBranches && (!profileBranchId || !activeBranchList.includes(profileBranchId)) && activeBranchList.length > 0) {
            profileBranchId = activeBranchList[0]
            await supabase.rpc('switch_my_active_branch', { p_branch_id: profileBranchId })
          }
          branchIds = Array.from(new Set([
            profileBranchId,
            ...activeBranchList,
          ].filter(Boolean)))
        } else if (role === 'manager') {
          const { data: assignments } = await supabase
            .from('manager_branch_assignments')
            .select('branch_id')
            .eq('manager_id', data.user.id)
          branchIds = Array.from(new Set([
            profileBranchId,
            ...((assignments || []) as Array<{ branch_id: string }>).map((item) => item.branch_id),
          ].filter(Boolean)))
        }
        if ((role === 'staff' || role === 'shift_leader' || role === 'cashier') && !profileBranchId) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
          throw new Error('Tài khoản nhân viên chưa được gán chi nhánh. Liên hệ Admin để cập nhật trước khi đăng nhập.')
        }
        if ((role === 'staff' || role === 'shift_leader' || role === 'cashier') && profileBranchId) {
          const { data: branch } = await supabase
            .from('branches')
            .select('id, active')
            .eq('id', profileBranchId)
            .maybeSingle()
          if (!branch || branch.active === false) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
            throw new Error('Chi nhánh của tài khoản này đã bị xóa hoặc tạm ngưng. Liên hệ Admin để chuyển chi nhánh trước khi đăng nhập.')
          }
        }
        if (branchIds.length) {
          const { data: activeBranches } = await supabase
            .from('branches')
            .select('id')
            .in('id', branchIds)
            .eq('active', true)
          const activeIds = new Set((activeBranches || []).map((item: { id: string }) => item.id))
          branchIds = branchIds.filter((id) => activeIds.has(id))
        }
        onLogin({
          id: data.user.id,
          name: profile?.full_name || metadata.full_name || username,
          email,
          role,
          branchId: profileBranchId,
          branchIds,
          canRoamBranches,
          employmentType: profile?.employment_type || undefined,
          positionTitle: profile?.position_title || undefined,
          avatarUrl: profile?.avatar_url || undefined,
        })
      } else {
        const response = await fetch('/api/attendance/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: cleanPassword }),
        })
        const account = await response.json().catch(() => null)
        if (!response.ok) {
          const apiOffline = !account?.error && response.status >= 500
          throw new Error(apiOffline ? apiOfflineMessage() : account?.error || 'Tên đăng nhập hoặc mật khẩu không đúng.')
        }
        const role = normalizeRole(account.role as Role)
        onLogin({
          id: account.id,
          name: account.name,
          email: account.email,
          role,
          branchId: account.branchId,
          branchIds: account.branchIds || [account.branchId].filter(Boolean),
          authToken: account.authToken,
          employmentType: account.employmentType,
          positionTitle: account.positionTitle,
          avatarUrl: account.avatarUrl,
        })
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể đăng nhập'
      setError(
        message === 'Failed to fetch' || message === 'NetworkError when attempting to fetch resource.'
          ? apiOfflineMessage()
          : message,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="hero-glow" />
        <div className="login-brand">
          <span className="brand-mark large"><img src="/gustino-logo.jpg" alt="GUSTINO" /></span>
          <div><strong>GUSTINO</strong><small>VẬN HÀNH CHÍNH THỨC</small></div>
        </div>
        <div className="hero-copy">
          <span className="eyebrow">TRANG CHỦ</span>
          <h1>Chúc một ngày tốt lành.</h1>
          <p>Đăng nhập để bắt đầu ca làm, ghi nhận đúng việc và bàn giao gọn.</p>
          <div className="hero-points">
            <span>Báo cáo rõ</span>
            <span>Kho không lệch</span>
            <span>Ca làm minh bạch</span>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div>
            <span className="eyebrow dark">CHÀO MỪNG TRỞ LẠI</span>
            <h2>Đăng nhập hệ thống</h2>
            <p>Sử dụng tài khoản được quản lý cấp.</p>
          </div>
          <label>Tên đăng nhập
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required />
          </label>
          <label>Mật khẩu
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="password-visibility">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
            Hiện mật khẩu
          </label>
          {sessionNotice && !error && (
            <div className="form-notice">
              Phiên đăng nhập đã quá 24 giờ nên hệ thống tự đăng xuất để làm mới dữ liệu. Vui lòng đăng nhập lại.
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button wide" disabled={loading}>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
          <small className="login-help">Cần hỗ trợ? Liên hệ quản lý hệ thống.</small>
        </form>
      </section>
      <AppFooter />
    </div>
  )
}

function apiOfflineMessage() {
  return 'Máy chủ chưa sẵn sàng. Vui lòng tải lại trang hoặc báo quản lý hệ thống.'
}
