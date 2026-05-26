import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../lib/roles'

type RoleCtx = { role: UserRole; userId: string | null; email: string | null; loading: boolean }

const ROLE_CACHE_PREFIX = 'yva_role'
const Ctx = createContext<RoleCtx>({ role: 'recruiter', userId: null, email: null, loading: true })

function roleCacheKey(userId: string): string {
  return `${ROLE_CACHE_PREFIX}:${userId}`
}

function getCachedRole(userId: string): UserRole | null {
  try {
    return sessionStorage.getItem(roleCacheKey(userId)) as UserRole | null
  } catch {
    return null
  }
}

function setCachedRole(userId: string, role: UserRole): void {
  try {
    sessionStorage.setItem(roleCacheKey(userId), role)
    sessionStorage.removeItem(ROLE_CACHE_PREFIX)
  } catch {
    // Ignore storage failures; Supabase remains the source of truth.
  }
}

function clearCachedRoles(): void {
  try {
    sessionStorage.removeItem(ROLE_CACHE_PREFIX)
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(`${ROLE_CACHE_PREFIX}:`)) sessionStorage.removeItem(key)
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role,    setRole]    = useState<UserRole>('recruiter')
  const [userId,  setUserId]  = useState<string | null>(null)
  const [email,   setEmail]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { setLoading(false); return }
      setUserId(user.id)
      setEmail(user.email ?? null)
      const cached = getCachedRole(user.id)
      if (cached) {
        setRole(cached)
        setLoading(false)
      }

      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (data?.role) {
        setRole(data.role as UserRole)
        setCachedRole(user.id, data.role as UserRole)
      } else {
        await supabase
          .from('user_roles')
          .insert({ user_id: user.id, email: user.email, role: 'recruiter' })
        setRole('recruiter')
        setCachedRole(user.id, 'recruiter')
      }
      setLoading(false)
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearCachedRoles()
        setRole('recruiter')
        setUserId(null)
        setEmail(null)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  return <Ctx.Provider value={{ role, userId, email, loading }}>{children}</Ctx.Provider>
}

export function useRole() { return useContext(Ctx) }
