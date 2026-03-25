import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../lib/roles'

type RoleCtx = { role: UserRole; userId: string | null; email: string | null; loading: boolean }

const ROLE_CACHE_KEY = 'yva_role'
const Ctx = createContext<RoleCtx>({ role: 'recruiter', userId: null, email: null, loading: true })

export function RoleProvider({ children }: { children: ReactNode }) {
  const cached = sessionStorage.getItem(ROLE_CACHE_KEY) as UserRole | null
  const [role,    setRole]    = useState<UserRole>(cached ?? 'recruiter')
  const [userId,  setUserId]  = useState<string | null>(null)
  const [email,   setEmail]   = useState<string | null>(null)
  // If we have a cached role, skip the loading gate — render immediately
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { setLoading(false); return }
      setUserId(user.id)
      setEmail(user.email ?? null)

      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (data?.role) {
        setRole(data.role as UserRole)
        sessionStorage.setItem(ROLE_CACHE_KEY, data.role)
      } else {
        await supabase
          .from('user_roles')
          .insert({ user_id: user.id, email: user.email, role: 'recruiter' })
        setRole('recruiter')
        sessionStorage.setItem(ROLE_CACHE_KEY, 'recruiter')
      }
      setLoading(false)
    })()
  }, [])

  return <Ctx.Provider value={{ role, userId, email, loading }}>{children}</Ctx.Provider>
}

export function useRole() { return useContext(Ctx) }
