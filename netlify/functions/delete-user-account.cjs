const { createClient } = require('@supabase/supabase-js')

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function getEnv(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  try {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required' })
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
    if (!token) return json(401, { error: 'Missing bearer token' })

    const body = JSON.parse(event.body || '{}')
    const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!targetUserId) return json(400, { error: 'Missing userId' })

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: callerResult, error: callerError } = await supabase.auth.getUser(token)
    const caller = callerResult?.user
    if (callerError || !caller) return json(401, { error: 'Invalid session' })
    if (caller.id === targetUserId) return json(400, { error: 'You cannot delete your own signed-in account.' })

    const { data: roleRow, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .single()

    if (roleError || roleRow?.role !== 'ceo') {
      return json(403, { error: 'Only the CEO can delete user accounts.' })
    }

    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(targetUserId)
    if (authDeleteError) return json(500, { error: authDeleteError.message })

    const { error: roleDeleteError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', targetUserId)

    if (roleDeleteError) return json(500, { error: roleDeleteError.message })

    return json(200, { ok: true })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Failed to delete user account' })
  }
}
