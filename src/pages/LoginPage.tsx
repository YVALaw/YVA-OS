import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [mode, setMode]           = useState<'login' | 'signup'>('login')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setLoading(false)
      if (error) { setError(error.message); return }
      if (!rememberMe) {
        // Sign out when tab/window closes
        window.addEventListener('beforeunload', () => { void supabase.auth.signOut() }, { once: true })
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      setLoading(false)
      if (error) {
        setError(error.message)
      } else {
        setSuccess('Account created! You can now sign in.')
        setMode('login')
      }
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '20px',
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 380,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/yva-logo.png" alt="YVA" style={{ height: 48, marginBottom: 16 }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {mode === 'login' ? 'Sign in to YVA OS' : 'Create an account'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Internal operations platform</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Email</label>
            <input
              className="form-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@yvastaffing.net"
              required
              autoFocus
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Password</label>
            <input
              className="form-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {mode === 'login' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
              Remember me
            </label>
          )}

          {error && (
            <div style={{
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#f87171',
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.2)',
              borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#4ade80',
            }}>
              {success}
            </div>
          )}

          <button
            className="btn-primary"
            type="submit"
            disabled={loading}
            style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}
          >
            {loading ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
          {mode === 'login' ? (
            <>Don't have an account?{' '}
              <button className="btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => { setMode('signup'); setError(null); setSuccess(null) }}>
                Sign up
              </button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button className="btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => { setMode('login'); setError(null); setSuccess(null) }}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
