import { createClient } from '@supabase/supabase-js'
import type { AppUser } from '../types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(
  url &&
  key &&
  !url.includes('your-project') &&
  !key.includes('your-anon-key'),
)

let supabaseNetworkDown = false

function markSupabaseNetworkDown() {
  supabaseNetworkDown = true
  try {
    sessionStorage.setItem('gustino_supabase_network_down', '1')
  } catch {
    // Best effort only. Some mobile/private browsers block storage.
  }
}

function isSupabaseNetworkDown() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (supabaseNetworkDown) return true
  try {
    return sessionStorage.getItem('gustino_supabase_network_down') === '1'
  } catch {
    return false
  }
}

const supabaseFetch: typeof fetch = async (input, init) => {
  try {
    const response = await fetch(input, init)
    if (response.ok) {
      supabaseNetworkDown = false
      try {
        sessionStorage.removeItem('gustino_supabase_network_down')
      } catch {
        // Storage may be unavailable; the in-memory flag is enough for this tab.
      }
    }
    return response
  } catch (error) {
    markSupabaseNetworkDown()
    throw error
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(url!, key!, {
      global: { fetch: supabaseFetch },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: `gustino_supabase_auth_v1:${new URL(url!).hostname}`,
      },
    })
  : null

// supabase-js >= 2.10x: client.channel(topic) TÁI SỬ DỤNG channel cũ nếu trùng topic,
// và .on('postgres_changes') trên channel đã subscribe sẽ THROW làm crash React tree.
// Vì removeChannel là async, mount lại nhanh (StrictMode, đổi trang/filter) vẫn thấy
// channel cũ → luôn đặt tên duy nhất cho channel chỉ-nghe-postgres_changes.
// KHÔNG dùng cho channel presence (cần topic chung giữa các client).
let realtimeChannelSeq = 0
export function uniqueChannelName(base: string) {
  realtimeChannelSeq += 1
  return `${base}:${realtimeChannelSeq}:${Date.now()}`
}

export function shouldUseLanApi(user?: Pick<AppUser, 'authToken'> | null) {
  // Do not silently swap a Supabase-authenticated session to LAN/local data after
  // a transient network error. Showing the real Supabase error is safer than
  // rendering an empty local dataset that looks like data loss.
  if (supabase && !isLocalLanHost()) return false
  return !supabase || Boolean(user?.authToken)
}

function isLocalLanHost() {
  if (typeof window === 'undefined') return true
  const host = window.location.hostname
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host.endsWith('.local')
    || /^192\.168\./.test(host)
    || /^10\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
}
