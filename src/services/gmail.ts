import type { AppSettings } from '../data/types'
import { loadSettings, saveSettings } from './storage'
import { supabase } from '../lib/supabase'
import { attachmentBase64ForMime, attachmentBase64ToBlob, type EmailAttachment } from '../utils/pdf'

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

export type SendEmailResult = {
  mode: 'gmail' | 'mailto'
  attached: boolean
  fallbackReason?: string
}

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
  const params = {
    code,
    client_id:     clientId,
    code_verifier: verifier,
    grant_type:    'authorization_code',
    redirect_uri:  redirect,
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(params),
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
  // Persist the org-level OAuth client ID for future reconnects/refreshes.
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
  const params = {
    client_id:     settings.gmailClientId,
    refresh_token: settings.gmailRefreshToken,
    grant_type:    'refresh_token',
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(params),
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
  return utf8ToBase64Url(msg)
}

function utf8ToBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

function utf8ToBase64Url(value: string): string {
  return utf8ToBase64(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function buildRawWithAttachments(
  to: string,
  subject: string,
  body: string,
  from: string,
  attachments: EmailAttachment[],
): string {
  const boundary = `yva-os-${crypto.randomUUID()}`
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body.replace(/\r?\n/g, '\r\n'),
  ]

  for (const attachment of attachments) {
    parts.push(
      '',
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      attachmentBase64ForMime(attachment),
    )
  }

  parts.push('', `--${boundary}--`)

  return utf8ToBase64Url(parts.join('\r\n'))
}

function downloadAttachment(attachment: EmailAttachment) {
  const url = URL.createObjectURL(attachmentBase64ToBlob(attachment))
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function sendGmailMessage(
  to: string,
  subject: string,
  body: string,
  attachments: EmailAttachment[] = [],
): Promise<void> {
  const userData = await getGmailUserData()
  if (!userData.gmailEmail) throw new Error('Gmail not connected.')
  const token = await getValidToken()
  if (!token) throw new Error('Gmail session expired — please reconnect in Settings.')

  const raw = attachments.length > 0
    ? buildRawWithAttachments(to, subject, body, userData.gmailEmail, attachments)
    : buildRaw(to, subject, body, userData.gmailEmail)

  const res = await fetch(SEND_ENDPOINT, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Gmail API error ${res.status}`)
  }
}

// ── Universal send (Gmail if connected, mailto: fallback) ─────
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options?: { attachments?: EmailAttachment[] },
): Promise<SendEmailResult> {
  if (!to) return { mode: 'mailto', attached: false }
  const attachments = options?.attachments || []
  let fallbackReason: string | undefined
  if (await isGmailConnected()) {
    try {
      await sendGmailMessage(to, subject, body, attachments)
      return { mode: 'gmail', attached: attachments.length > 0 }
    } catch (err) {
      console.error('Gmail send failed, falling back to mailto:', err)
      fallbackReason = err instanceof Error ? err.message : 'Gmail send failed'
    }
  }
  if (attachments.length > 0) {
    for (const attachment of attachments) downloadAttachment(attachment)
  }
  // Mailto fallback
  window.location.href =
    `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return { mode: 'mailto', attached: false, fallbackReason }
}
