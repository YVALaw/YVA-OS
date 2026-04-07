const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  if (!clientSecret) return json(500, { error: 'Netlify env var GMAIL_CLIENT_SECRET is missing' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const action = payload?.action
  const clientId = payload?.clientId

  if (!clientId) return json(400, { error: 'clientId is required' })

  let params
  if (action === 'exchange') {
    if (!payload.code || !payload.codeVerifier || !payload.redirectUri) {
      return json(400, { error: 'code, codeVerifier, and redirectUri are required for exchange' })
    }
    params = {
      code: payload.code,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: payload.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: payload.redirectUri,
    }
  } else if (action === 'refresh') {
    if (!payload.refreshToken) {
      return json(400, { error: 'refreshToken is required for refresh' })
    }
    params = {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: payload.refreshToken,
      grant_type: 'refresh_token',
    }
  } else {
    return json(400, { error: 'Unsupported action' })
  }

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
    if (!res.ok) {
      return json(res.status, {
        error: data?.error_description || data?.error || 'Google token request failed',
        details: data,
      })
    }
    return json(200, data)
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : 'Unexpected token exchange failure',
    })
  }
}
