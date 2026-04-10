const { createClient } = require('@supabase/supabase-js')

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const DEFAULT_TIMEZONE = process.env.TIMESHEET_REMINDER_TZ || 'America/New_York'
const TIMESHEET_REMINDER_ENABLED = true

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function getEnv(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function formatLocalParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  })
  const parts = formatter.formatToParts(date)
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: weekdayMap[map.weekday] ?? 0,
    date: `${map.year}-${map.month}-${map.day}`,
  }
}

function lastCompletedBillingWeek(now, timeZone) {
  const local = formatLocalParts(now, timeZone)
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const daysSinceMonday = (local.weekday + 6) % 7
  const thisMonday = new Date(localDate)
  thisMonday.setUTCDate(localDate.getUTCDate() - daysSinceMonday)
  const lastMonday = new Date(thisMonday)
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7)
  const lastSunday = new Date(thisMonday)
  lastSunday.setUTCDate(thisMonday.getUTCDate() - 1)
  return {
    start: lastMonday.toISOString().slice(0, 10),
    end: lastSunday.toISOString().slice(0, 10),
    local,
  }
}

function encodeMimeHeader(value) {
  if (!/[^\x20-\x7E]/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function buildRawEmail(to, subject, body, from) {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')
  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function refreshGmailToken(clientId, clientSecret, refreshToken) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Google token refresh failed')
  }
  return data.access_token
}

async function sendGmailReminder({ to, subject, body, fromEmail, clientId, clientSecret, refreshToken }) {
  const token = await refreshGmailToken(clientId, clientSecret, refreshToken)
  const raw = buildRawEmail(to, subject, body, fromEmail)
  const res = await fetch(GMAIL_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gmail API error ${res.status}`)
  }
}

async function loadContext() {
  const supabaseUrl = getEnv('SUPABASE_URL')
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
  const clientSecret = getEnv('GMAIL_CLIENT_SECRET')
  const reminderUserId = getEnv('TIMESHEET_REMINDER_USER_ID') || getEnv('TIMESHEET_IMPORT_USER_ID')

  if (!supabaseUrl || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  if (!clientSecret) throw new Error('GMAIL_CLIENT_SECRET is required')
  if (!reminderUserId) throw new Error('TIMESHEET_REMINDER_USER_ID or TIMESHEET_IMPORT_USER_ID is required')

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const [{ data: settingsRow, error: settingsError }, { data: userResult, error: userError }] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).single(),
    supabase.auth.admin.getUserById(reminderUserId),
  ])

  if (settingsError) throw new Error(settingsError.message)
  if (userError) throw new Error(userError.message)
  if (!settingsRow) throw new Error('Settings row id=1 not found')
  if (!userResult?.user) throw new Error('Reminder sender user not found')

  return {
    supabase,
    settings: settingsRow,
    reminderUser: userResult.user,
    clientSecret,
    reminderUserId,
  }
}

async function alreadyImportedForWeek(supabase, billingWeekStart, billingWeekEnd) {
  const { data, error } = await supabase
    .from('timesheet_import_batches')
    .select('id,status')
    .eq('billing_week_start', billingWeekStart)
    .eq('billing_week_end', billingWeekEnd)

  if (error) throw new Error(error.message)
  return (data || []).some(batch => String(batch.status || '').toLowerCase() !== 'error')
}

async function updateLastSentAt(supabase, timestamp) {
  const { error } = await supabase
    .from('settings')
    .update({ timesheet_reminder_last_sent_at: timestamp })
    .eq('id', 1)
  if (error) throw new Error(error.message)
}

async function sendReminder({ force = false } = {}) {
  if (!TIMESHEET_REMINDER_ENABLED) {
    return { skipped: true, reason: 'Timesheet reminder feature is disabled.' }
  }
  const context = await loadContext()
  const { supabase, settings, reminderUser, clientSecret } = context
  const timeZone = getEnv('TIMESHEET_REMINDER_TZ') || DEFAULT_TIMEZONE
  const now = new Date()
  const { start, end, local } = lastCompletedBillingWeek(now, timeZone)

  if (!settings.timesheet_reminder_enabled && !force) {
    return { skipped: true, reason: 'Timesheet reminder is disabled.' }
  }

  const reminderDay = Number(settings.timesheet_reminder_day ?? 1)
  const reminderHour = Number(settings.timesheet_reminder_hour ?? 9)
  const reminderMinute = Number(settings.timesheet_reminder_minute ?? 0)
  const reminderMinuteBucket = Math.max(0, Math.min(55, reminderMinute - (reminderMinute % 5)))
  const currentMinuteBucket = Math.max(0, Math.min(55, local.minute - (local.minute % 5)))
  const lastSentDate = typeof settings.timesheet_reminder_last_sent_at === 'string'
    ? settings.timesheet_reminder_last_sent_at.slice(0, 10)
    : ''

  if (!force) {
    if (local.weekday !== reminderDay || local.hour !== reminderHour || currentMinuteBucket !== reminderMinuteBucket) {
      return { skipped: true, reason: 'Current time does not match the configured reminder schedule.' }
    }
    if (lastSentDate === local.date) {
      return { skipped: true, reason: 'Reminder already sent today.' }
    }
  }

  const recipient = String(settings.timesheet_notify_email || settings.company_email || '').trim()
  if (!recipient) throw new Error('timesheet_notify_email or company_email is required')

  const gmailClientId = String(settings.gmail_client_id || '').trim()
  const senderEmail = String(reminderUser.user_metadata?.gmailEmail || '').trim()
  const refreshToken = String(reminderUser.user_metadata?.gmailRefreshToken || '').trim()

  if (!gmailClientId) throw new Error('settings.gmail_client_id is required')
  if (!senderEmail || !refreshToken) throw new Error('Connected Gmail session with refresh token is required on the reminder sender account')

  const subject = `Manual timesheet import reminder: ${start} to ${end}`
  const body = [
    `Reminder to draft invoices for the billing week ${start} to ${end}.`,
    '',
    'Next step:',
    '1. Review the completed billing week.',
    '2. Draft the invoices for that period.',
    '3. Review the draft invoices before sending.',
    '',
    force ? 'This was triggered as a test reminder.' : 'This reminder was sent automatically on your configured weekly schedule.',
  ].join('\n')

  await sendGmailReminder({
    to: recipient,
    subject,
    body,
    fromEmail: senderEmail,
    clientId: gmailClientId,
    clientSecret,
    refreshToken,
  })

  const sentAt = new Date().toISOString()
  await updateLastSentAt(supabase, sentAt)

  return {
    skipped: false,
    recipient,
    sentAt,
    billingWeekStart: start,
    billingWeekEnd: end,
    message: `Reminder email sent to ${recipient} for ${start} to ${end}.`,
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })

  if (event.httpMethod === 'GET' && event.queryStringParameters?.info === '1') {
    return json(200, {
      ok: true,
      schedule: '*/5 * * * *',
      timezone: getEnv('TIMESHEET_REMINDER_TZ') || DEFAULT_TIMEZONE,
      message: 'Timesheet reminder function is available.',
    })
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })

  let payload = {}
  if (event.httpMethod === 'POST') {
    try {
      payload = JSON.parse(event.body || '{}')
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }
  }

  try {
    const result = await sendReminder({ force: payload.action === 'test' })
    return json(200, { ok: true, ...result })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unexpected reminder failure' })
  }
}

exports.config = {
  schedule: '*/5 * * * *',
}
