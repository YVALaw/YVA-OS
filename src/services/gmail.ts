import type { AppSettings } from '../data/types'
import { loadSettings, saveSettings } from './storage'
import { supabase } from '../lib/supabase'

type GmailUserData = {
  gmailAccessToken?: string
  gmailRefreshToken?: string
  gmailTokenExpiry?: number
  gmailEmail?: string
}

async function getGmailUserData(): Promise<GmailUserData> {
  const { data: { user } } = await supabase.auth.getUser()
  return (user?.user_metadata || {}) as GmailUserData
}

async function saveGmailUserData(data: GmailUserData): Promise<void> {
  await supabase.auth.updateUser({ data: data as Record<string, unknown> })
}

const AUTH_ENDPOINT  = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SEND_ENDPOINT  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email'

// ── PKCE helpers ──────────────────────────────────────────────
function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateVerifier(): Promise<string> {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return b64url(arr.buffer)
}

async function generateChallenge(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(buf)
}

// ── OAuth flow ────────────────────────────────────────────────
export async function initiateGmailAuth(clientId: string): Promise<void> {
  const verifier  = await generateVerifier()
  const challenge = await generateChallenge(verifier)
  const state     = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer)

  localStorage.setItem('gmail_pkce_verifier', verifier)
  localStorage.setItem('gmail_pkce_state',    state)

  const redirect = window.location.origin + '/oauth-callback'
  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          redirect,
    response_type:         'code',
    scope:                 SCOPE,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    access_type:           'offline',
    prompt:                'consent',
    state,
  })

  window.location.href = `${AUTH_ENDPOINT}?${params}`
}

export async function exchangeCode(code: string, clientId: string): Promise<string> {
  const verifier = localStorage.getItem('gmail_pkce_verifier')
  if (!verifier) throw new Error('PKCE verifier missing — please try connecting again.')

  const redirect = window.location.origin + '/oauth-callback'
  const res = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     clientId,
      code_verifier: verifier,
      grant_type:    'authorization_code',
      redirect_uri:  redirect,
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Token exchange failed: ${txt}`)
  }
  const data = await res.json()

  // Fetch connected email address
  const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const ui = await uiRes.json()

  const existing = await getGmailUserData()
  await saveGmailUserData({
    gmailAccessToken:  data.access_token,
    gmailRefreshToken: data.refresh_token || existing.gmailRefreshToken,
    gmailTokenExpiry:  Date.now() + (data.expires_in - 60) * 1000,
    gmailEmail:        ui.email as string,
  })
  // Also save clientId to shared settings
  const settings = await loadSettings()
  void saveSettings({ ...settings, gmailClientId: clientId })

  localStorage.removeItem('gmail_pkce_verifier')
  localStorage.removeItem('gmail_pkce_state')

  return ui.email as string
}

async function refreshToken(settings: AppSettings & GmailUserData): Promise<string> {
  if (!settings.gmailRefreshToken || !settings.gmailClientId) {
    throw new Error('Gmail not connected — no refresh token.')
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     settings.gmailClientId,
      refresh_token: settings.gmailRefreshToken,
      grant_type:    'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('Token refresh failed — please reconnect Gmail.')
  const data = await res.json()
  void saveGmailUserData({
    gmailAccessToken: data.access_token,
    gmailTokenExpiry: Date.now() + (data.expires_in - 60) * 1000,
  })
  return data.access_token as string
}

async function getValidToken(): Promise<string | null> {
  const userData = await getGmailUserData()
  if (!userData.gmailAccessToken) return null
  if (userData.gmailTokenExpiry && Date.now() > userData.gmailTokenExpiry) {
    try {
      const settings = await loadSettings()
      return await refreshToken({ ...settings, ...userData } as AppSettings)
    } catch { return null }
  }
  return userData.gmailAccessToken
}

export async function isGmailConnected(): Promise<boolean> {
  const userData = await getGmailUserData()
  return !!(userData.gmailAccessToken && userData.gmailEmail)
}

export async function disconnectGmail(): Promise<void> {
  await saveGmailUserData({
    gmailAccessToken:  undefined,
    gmailRefreshToken: undefined,
    gmailTokenExpiry:  undefined,
    gmailEmail:        undefined,
  })
}

// ── Sending ───────────────────────────────────────────────────
function buildRaw(to: string, subject: string, body: string, from: string): string {
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')
  // base64url encode
  return btoa(unescape(encodeURIComponent(msg)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function sendGmailMessage(to: string, subject: string, body: string): Promise<void> {
  const userData = await getGmailUserData()
  if (!userData.gmailEmail) throw new Error('Gmail not connected.')
  const token = await getValidToken()
  if (!token) throw new Error('Gmail session expired — please reconnect in Settings.')

  const res = await fetch(SEND_ENDPOINT, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ raw: buildRaw(to, subject, body, userData.gmailEmail) }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Gmail API error ${res.status}`)
  }
}

// ── Universal send (Gmail if connected, mailto: fallback) ─────
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (!to) return
  if (await isGmailConnected()) {
    try {
      await sendGmailMessage(to, subject, body)
      return
    } catch (err) {
      console.error('Gmail send failed, falling back to mailto:', err)
    }
  }
  // Mailto fallback
  window.location.href =
    `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
