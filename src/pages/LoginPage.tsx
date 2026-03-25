import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const LAST_EMAIL_KEY   = 'yva_last_email'
const ATTEMPTS_KEY     = 'yva_login_attempts'
const MAX_ATTEMPTS     = 5
const LOCKOUT_MS       = 15 * 60 * 1000 // 15 minutes

type AttemptsRecord = { count?: number; lockedUntil?: number }

function getAttempts(): AttemptsRecord {
  try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}') } catch { return {} }
}
function saveAttempts(r: AttemptsRecord) { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(r)) }
function clearAttempts() { localStorage.removeItem(ATTEMPTS_KEY) }

function getLockoutRemaining(): number {
  const r = getAttempts()
  if (!r.lockedUntil) return 0
  return Math.max(0, r.lockedUntil - Date.now())
}

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8)  score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { score, label: 'Weak',   color: '#f87171' }
  if (score <= 3) return { score, label: 'Fair',   color: '#f5b533' }
  return               { score, label: 'Strong', color: '#4ade80' }
}

export default function LoginPage() {
  const [mode, setMode]           = useState<'login' | 'signup'>('login')
  const [email, setEmail]         = useState(() => localStorage.getItem(LAST_EMAIL_KEY) || '')
  const [password, setPassword]   = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState<string | null>(null)
  const [lockRemaining, setLockRemaining] = useState(getLockoutRemaining())

  // Countdown timer while locked out
  useEffect(() => {
    if (lockRemaining <= 0) return
    const t = setInterval(() => {
      const rem = getLockoutRemaining()
      setLockRemaining(rem)
      if (rem <= 0) { clearAttempts(); clearInterval(t) }
    }, 1000)
    return () => clearInterval(t)
  }, [lockRemaining])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (mode === 'login' && getLockoutRemaining() > 0) return

    if (mode === 'signup') {
      if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setLoading(false)
      if (error) {
        const rec = getAttempts()
        const count = (rec.count || 0) + 1
        if (count >= MAX_ATTEMPTS) {
          saveAttempts({ count, lockedUntil: Date.now() + LOCKOUT_MS })
          setLockRemaining(LOCKOUT_MS)
          setError(`Too many failed attempts. Account locked for 15 minutes.`)
        } else {
          saveAttempts({ count })
          setError(`${error.message} (${MAX_ATTEMPTS - count} attempt${MAX_ATTEMPTS - count !== 1 ? 's' : ''} remaining)`)
        }
        return
      }
      clearAttempts()
      localStorage.setItem(LAST_EMAIL_KEY, email)
      if (!rememberMe) {
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

          {mode === 'signup' && password.length > 0 && (() => {
            const s = passwordStrength(password)
            return (
              <div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {[1,2,3,4,5].map(i => (
                    <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= s.score ? s.color : 'rgba(255,255,255,.1)', transition: 'background .2s' }} />
                  ))}
                </div>
                <div style={{ fontSize: 11, color: s.color }}>{s.label} password</div>
              </div>
            )
          })()}

          {mode === 'login' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
              Remember me
            </label>
          )}

          {lockRemaining > 0 && (
            <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#f87171' }}>
              Too many failed attempts. Try again in {Math.ceil(lockRemaining / 60000)}m {Math.ceil((lockRemaining % 60000) / 1000)}s.
            </div>
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
            disabled={loading || lockRemaining > 0}
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
