import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../lib/roles'

type RoleCtx = { role: UserRole; userId: string | null; email: string | null; loading: boolean }

const Ctx = createContext<RoleCtx>({ role: 'recruiter', userId: null, email: null, loading: true })

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

      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      console.log('[RoleContext] user:', user.email, 'data:', data, 'error:', error)

      if (data?.role) {
        setRole(data.role as UserRole)
      } else {
        const { error: insertError } = await supabase
          .from('user_roles')
          .insert({ user_id: user.id, email: user.email, role: 'recruiter' })
        console.log('[RoleContext] insert error:', insertError)
        setRole('recruiter')
      }
      setLoading(false)
    })()
  }, [])

  return <Ctx.Provider value={{ role, userId, email, loading }}>{children}</Ctx.Provider>
}

export function useRole() { return useContext(Ctx) }
