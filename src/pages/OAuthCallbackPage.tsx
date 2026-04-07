import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exchangeCode } from '../services/gmail'
import { loadSettings } from '../services/storage'

export default function OAuthCallbackPage() {
  const navigate = useNavigate()
  const [msg, setMsg] = useState('Connecting Gmail…')
  const [ok,  setOk]  = useState<boolean | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    const error  = params.get('error')

    if (error) {
      setMsg(`Google returned an error: ${error}`)
      setOk(false)
      setTimeout(() => navigate('/settings'), 3000)
      return
    }
    if (!code) {
      setMsg('No authorization code received.')
      setOk(false)
      setTimeout(() => navigate('/settings'), 3000)
      return
    }

    void (async () => {
      const settings = await loadSettings()
      const clientId = settings.gmailClientId
      if (!clientId) {
        setMsg('Gmail Client ID not found in settings.')
        setOk(false)
        setTimeout(() => navigate('/settings'), 3000)
        return
      }
      try {
        const email = await exchangeCode(code, clientId)
        setMsg(`Connected as ${email}`)
        setOk(true)
        setTimeout(() => navigate('/settings'), 1500)
      } catch (err) {
        setMsg(`Connection failed: ${(err as Error).message}`)
        setOk(false)
        setTimeout(() => navigate('/settings'), 4000)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#020617', color: '#fff',
      flexDirection: 'column', gap: 16, fontFamily: 'Inter, sans-serif',
    }}>
      {ok === null && (
        <div style={{ width: 32, height: 32, border: '3px solid #f5b533', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      )}
      {ok === true  && <div style={{ fontSize: 36 }}>✓</div>}
      {ok === false && <div style={{ fontSize: 36 }}>✕</div>}
      <div style={{ fontSize: 16, color: ok === false ? '#f87171' : ok === true ? '#22c55e' : '#fff' }}>{msg}</div>
      <div style={{ fontSize: 12, color: '#475569' }}>Redirecting to Settings…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
