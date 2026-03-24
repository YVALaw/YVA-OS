import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
    // On success, App.tsx auth listener will redirect automatically
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
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Sign in to YVA OS</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Internal operations platform</div>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

          {error && (
            <div style={{
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#f87171',
            }}>
              {error}
            </div>
          )}

          <button
            className="btn-primary"
            type="submit"
            disabled={loading}
            style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
