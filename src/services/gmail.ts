import { loadSettings, saveSettings } from './storage'
import { supabase } from '../lib/supabase'
import { attachmentBase64ForMime, attachmentBase64ToBlob, type EmailAttachment } from '../utils/pdf'
import { formatEmailList } from '../utils/email'

type GmailUserData = {
  gmailAccessToken?: string
  gmailRefreshToken?: string
  gmailTokenExpiry?: number
  gmailEmail?: string
}

// null removes a key from Supabase user metadata; undefined is dropped by
// JSON.stringify and leaves the stored value in place.
type GmailUserDataPatch = { [K in keyof GmailUserData]?: GmailUserData[K] | null }

async function getGmailUserData(): Promise<GmailUserData> {
  const { data: { user }, error } = await supabase.auth.getUser()
  // Reading a failed lookup as "not connected" turned a network blip into a
  // silent switch to the mail app.
  if (error) throw new Error(`Could not load your Gmail connection: ${error.message}`)
  return (user?.user_metadata || {}) as GmailUserData
}

async function saveGmailUserData(data: GmailUserDataPatch): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data })
  if (error) throw new Error(`Could not save your Gmail connection: ${error.message}`)
}

const AUTH_ENDPOINT  = 'https://accounts.google.com/o/oauth2/v2/auth'
const SEND_ENDPOINT  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo'
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const SCOPE = `${SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`
const NETLIFY_GMAIL_OAUTH_ENDPOINT = '/.netlify/functions/gmail-oauth'
const RECONNECT_HINT = 'Reconnect Gmail in Settings → Integrations.'

export type SendEmailResult = {
  // failed: Gmail could not send and the user chose not to open the mail app.
  mode: 'gmail' | 'mailto' | 'failed'
  attached: boolean
  fallbackReason?: string
}

/** The saved Google sign-in is unusable; only connecting Gmail again fixes it. */
export class GmailReconnectError extends Error {}

function errorMessage(err: unknown, fallback = 'Unknown error'): string {
  return err instanceof Error ? err.message : fallback
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
  const res = await fetch(NETLIFY_GMAIL_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'exchange',
      code,
      clientId,
      codeVerifier: verifier,
      redirectUri: redirect,
    }),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(`Token exchange failed: ${error?.error || 'Unknown server error'}`)
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

async function refreshAccessToken(userData: GmailUserData): Promise<string> {
  if (!userData.gmailRefreshToken) {
    throw new GmailReconnectError(`No Gmail refresh token is saved for your account. ${RECONNECT_HINT}`)
  }
  const { gmailClientId } = await loadSettings()
  if (!gmailClientId) {
    throw new GmailReconnectError('The Google OAuth Client ID is missing. Add it in Settings → Integrations and reconnect Gmail.')
  }
  let res: Response
  try {
    res = await fetch(NETLIFY_GMAIL_OAUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'refresh',
        clientId: gmailClientId,
        refreshToken: userData.gmailRefreshToken,
      }),
    })
  } catch {
    throw new Error('Could not reach the Gmail token service. Check your internet connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // The Netlify function passes Google's own error code through in details.
    const googleError = data?.details?.error
    if (googleError === 'invalid_grant') {
      // Revoked access, a password change, or the 7-day refresh tokens Google
      // issues while the OAuth app is still in "Testing".
      throw new GmailReconnectError(`Google says the saved Gmail sign-in has expired or been revoked. ${RECONNECT_HINT}`)
    }
    if (googleError === 'invalid_client' || googleError === 'unauthorized_client') {
      throw new Error('Google rejected the OAuth client. Check that GMAIL_CLIENT_SECRET on Netlify belongs to the Client ID in Settings → Integrations.')
    }
    throw new Error(`Gmail token refresh failed: ${data?.error || `HTTP ${res.status}`}`)
  }
  if (!data.access_token) throw new Error('Gmail token refresh returned no access token.')
  saveGmailUserData({
    gmailAccessToken: data.access_token,
    gmailTokenExpiry: Date.now() + (data.expires_in - 60) * 1000,
  }).catch(err => console.warn('Could not store the refreshed Gmail token:', err))
  return data.access_token as string
}

async function getAccessToken(userData: GmailUserData): Promise<string> {
  if (!userData.gmailAccessToken) throw new GmailReconnectError(`Gmail is not connected. ${RECONNECT_HINT}`)
  if (userData.gmailTokenExpiry && Date.now() > userData.gmailTokenExpiry) return refreshAccessToken(userData)
  return userData.gmailAccessToken
}

export async function isGmailConnected(): Promise<boolean> {
  const userData = await getGmailUserData()
  return !!(userData.gmailAccessToken && userData.gmailEmail)
}

export type GmailConnectionStatus =
  | { state: 'disconnected' }
  | { state: 'connected'; email: string }
  | { state: 'needs-reconnect' | 'error'; email?: string; reason: string }

/**
 * Asks Google whether the saved sign-in still works. isGmailConnected only
 * checks that tokens are stored, so it keeps saying "connected" after Google
 * has revoked them.
 */
export async function checkGmailConnection(): Promise<GmailConnectionStatus> {
  let userData: GmailUserData
  try {
    userData = await getGmailUserData()
  } catch (err) {
    return { state: 'error', reason: errorMessage(err) }
  }
  const email = userData.gmailEmail
  if (!userData.gmailAccessToken || !email) return { state: 'disconnected' }

  const inspect = (token: string) => fetch(TOKENINFO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }),
  })
  try {
    let res = await inspect(await getAccessToken(userData))
    // tokeninfo answers 400 for an expired or revoked access token.
    if (res.status === 400 || res.status === 401) res = await inspect(await refreshAccessToken(userData))
    const info = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { state: 'error', email, reason: `Google could not verify the Gmail sign-in (${info?.error_description || `HTTP ${res.status}`}).` }
    }
    if (!String(info.scope || '').split(' ').includes(SEND_SCOPE)) {
      return { state: 'needs-reconnect', email, reason: 'Permission to send email was not granted. Reconnect and allow YVA OS to send email on your behalf.' }
    }
    return { state: 'connected', email }
  } catch (err) {
    return { state: err instanceof GmailReconnectError ? 'needs-reconnect' : 'error', email, reason: errorMessage(err) }
  }
}

export async function disconnectGmail(): Promise<void> {
  await saveGmailUserData({
    gmailAccessToken:  null,
    gmailRefreshToken: null,
    gmailTokenExpiry:  null,
    gmailEmail:        null,
  })
}

// ── Sending ───────────────────────────────────────────────────
function buildRaw(to: string, subject: string, body: string, from: string, cc: string[] = []): string {
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc.length > 0 ? [`Cc: ${formatEmailList(cc)}`] : []),
    `Subject: ${encodeMimeHeader(subject)}`,
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

function encodeMimeHeader(value: string): string {
  if (!/[^\x20-\x7E]/.test(value)) return value
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`
}

function buildRawWithAttachments(
  to: string,
  subject: string,
  body: string,
  from: string,
  attachments: EmailAttachment[],
  cc: string[] = [],
): string {
  const boundary = `yva-os-${crypto.randomUUID()}`
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc.length > 0 ? [`Cc: ${formatEmailList(cc)}`] : []),
    `Subject: ${encodeMimeHeader(subject)}`,
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
  cc: string[] = [],
): Promise<void> {
  const userData = await getGmailUserData()
  if (!userData.gmailEmail) throw new GmailReconnectError(`Gmail is not connected. ${RECONNECT_HINT}`)

  const raw = attachments.length > 0
    ? buildRawWithAttachments(to, subject, body, userData.gmailEmail, attachments, cc)
    : buildRaw(to, subject, body, userData.gmailEmail, cc)

  const send = async (token: string) => {
    try {
      return await fetch(SEND_ENDPOINT, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ raw }),
      })
    } catch {
      throw new Error('Could not reach Gmail. Check your internet connection and try again.')
    }
  }

  let res = await send(await getAccessToken(userData))
  // The stored expiry is only an estimate: Google can revoke a token early and
  // a wrong clock on this computer skews it, so a 401 gets one forced refresh.
  if (res.status === 401) res = await send(await refreshAccessToken(userData))
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw gmailApiError(res.status, err?.error?.message)
  }
}

function gmailApiError(status: number, message?: string): Error {
  const detail = message || `HTTP ${status}`
  if (status === 401) {
    return new GmailReconnectError(`Google rejected the saved Gmail sign-in (${detail}). ${RECONNECT_HINT}`)
  }
  if (status === 403 && /insufficient/i.test(detail)) {
    return new GmailReconnectError(`Permission to send email was not granted (${detail}). ${RECONNECT_HINT}`)
  }
  if (/invalid (to|cc) header/i.test(detail)) {
    return new Error(`Gmail rejected a recipient address (${detail}). Check the email and CC addresses on file.`)
  }
  return new Error(`Gmail API error ${status}: ${detail}`)
}

function openInMailApp(to: string, subject: string, body: string, attachments: EmailAttachment[], cc: string[]) {
  for (const attachment of attachments) downloadAttachment(attachment)
  // Percent-encoded rather than URLSearchParams: mailto does not decode "+" as
  // a space, so form encoding fills the draft with plus signs.
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`]
  if (cc.length > 0) params.push(`cc=${encodeURIComponent(formatEmailList(cc))}`)
  window.location.href = `mailto:${to}?${params.join('&')}`
}

// ── Universal send (Gmail if connected, mailto: fallback) ─────
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options?: { attachments?: EmailAttachment[]; cc?: string[] },
): Promise<SendEmailResult> {
  if (!to) return { mode: 'mailto', attached: false }
  const attachments = options?.attachments || []
  const cc = options?.cc || []
  let fallbackReason: string
  try {
    if (await isGmailConnected()) {
      await sendGmailMessage(to, subject, body, attachments, cc)
      return { mode: 'gmail', attached: attachments.length > 0 }
    }
    // With no OAuth client set up, nobody here sends through Gmail, so the
    // mail app is the expected route rather than a fallback.
    if (!(await loadSettings()).gmailClientId) {
      openInMailApp(to, subject, body, attachments, cc)
      return { mode: 'mailto', attached: false }
    }
    fallbackReason = `Gmail is not connected for the account you are signed in with. Connect it in Settings → Integrations.`
  } catch (err) {
    console.error('Gmail send failed:', err)
    fallbackReason = errorMessage(err, 'Gmail send failed')
  }
  // Switching to the mail app on its own hid why Gmail failed and left the PDF
  // to be attached by hand, so the user decides with the reason in front of them.
  const useMailApp = window.confirm(
    `Gmail could not send this email.\n\n${fallbackReason}\n\n` +
    `Open it in your email app instead?${attachments.length > 0 ? ' The PDF will be downloaded so you can attach it.' : ''}`,
  )
  if (!useMailApp) return { mode: 'failed', attached: false, fallbackReason }
  openInMailApp(to, subject, body, attachments, cc)
  return { mode: 'mailto', attached: false, fallbackReason }
}
