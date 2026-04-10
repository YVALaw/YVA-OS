const { createClient } = require('@supabase/supabase-js')
const { createHash, randomUUID } = require('crypto')

const DEFAULT_SUPABASE_URL = 'https://yfxaluoejsvodkzqgwxx.supabase.co'

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function uid() {
  return randomUUID()
}

function toNumber(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function normalizeLookup(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTime(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return raw
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2] || '0', 10)
  const suffix = (match[3] || '').toLowerCase()
  if (suffix === 'pm' && hours < 12) hours += 12
  if (suffix === 'am' && hours === 12) hours = 0
  hours = Math.min(Math.max(hours, 0), 23)
  const mins = Math.min(Math.max(minutes, 0), 59)
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value)
  const match = normalized.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  return hours * 60 + minutes
}

function overlapMinutes(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB))
}

function computePremiumHours(totalHours, shiftStart, shiftEnd, premiumStartTime) {
  const total = Math.max(0, totalHours || 0)
  const start = timeToMinutes(shiftStart)
  const end = timeToMinutes(shiftEnd)
  const premiumStart = timeToMinutes(premiumStartTime)
  if (total <= 0 || start == null || end == null || premiumStart == null) {
    return { regularHours: total, premiumHours: 0 }
  }

  let shiftEndMinutes = end
  if (shiftEndMinutes <= start) shiftEndMinutes += 24 * 60
  let premiumMinutes = 0
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const windowStart = premiumStart + dayOffset * 24 * 60
    const windowEnd = 24 * 60 + dayOffset * 24 * 60
    premiumMinutes += overlapMinutes(start, shiftEndMinutes, windowStart, windowEnd)
  }

  const rawShiftHours = Math.max(0, (shiftEndMinutes - start) / 60)
  const effectiveShiftHours = rawShiftHours > 0 ? rawShiftHours : total
  const premiumHours = Math.min(total, premiumMinutes / 60)
  if (effectiveShiftHours <= 0) return { regularHours: total, premiumHours: 0 }
  if (Math.abs(effectiveShiftHours - total) < 0.01) {
    return { regularHours: Math.max(0, total - premiumHours), premiumHours }
  }
  const scale = total / effectiveShiftHours
  const scaledPremiumHours = Math.min(total, premiumHours * scale)
  return {
    regularHours: Math.max(0, total - scaledPremiumHours),
    premiumHours: scaledPremiumHours,
  }
}

function computePayrollBreakdown(totalHours, employee, shiftStart, shiftEnd) {
  const safeHours = Math.max(0, totalHours || 0)
  const basePayRate = toNumber(employee?.pay_rate ?? employee?.payRate)
  const premiumEnabled = Boolean(employee?.premium_enabled ?? employee?.premiumEnabled)
  const premiumPercent = premiumEnabled ? toNumber(employee?.premium_percent ?? employee?.premiumPercent) : 0
  const premiumMultiplier = 1 + premiumPercent / 100
  const split = premiumEnabled
    ? computePremiumHours(safeHours, shiftStart, shiftEnd, employee?.premium_start_time || employee?.premiumStartTime || '21:00')
    : { regularHours: safeHours, premiumHours: 0 }

  return {
    totalHours: safeHours,
    regularHours: split.regularHours,
    premiumHours: split.premiumHours,
    basePayRate,
    premiumPercent,
    premiumMultiplier,
    totalPay: split.regularHours * basePayRate + split.premiumHours * basePayRate * premiumMultiplier,
  }
}

function computePremiumAdjustedAmount(totalHours, baseRate, premiumPercent, premiumEnabled, shiftStart, shiftEnd, premiumStartTime) {
  const safeHours = Math.max(0, totalHours || 0)
  const safeRate = Math.max(0, toNumber(baseRate))
  const safePercent = premiumEnabled ? Math.max(0, toNumber(premiumPercent)) : 0
  const premiumMultiplier = 1 + safePercent / 100
  const split = premiumEnabled
    ? computePremiumHours(safeHours, shiftStart, shiftEnd, premiumStartTime)
    : { regularHours: safeHours, premiumHours: 0 }
  return {
    totalHours: safeHours,
    regularHours: split.regularHours,
    premiumHours: split.premiumHours,
    baseRate: safeRate,
    premiumPercent: safePercent,
    premiumMultiplier,
    totalAmount: split.regularHours * safeRate + split.premiumHours * safeRate * premiumMultiplier,
  }
}

function parseCsv(text) {
  const sampleLine = text.split(/\r?\n/).find(line => line.trim()) || ''
  const delimiter = (sampleLine.match(/;/g) || []).length > (sampleLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let current = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      current.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n') {
      current.push(cell)
      rows.push(current)
      current = []
      cell = ''
      continue
    }
    if (ch !== '\r') cell += ch
  }

  current.push(cell)
  rows.push(current)

  const cleaned = rows.filter(row => row.some(value => String(value || '').trim() !== ''))
  if (cleaned.length === 0) return []
  const headers = cleaned.shift().map(header => String(header || '').trim())
  return cleaned.map(row => {
    const record = {}
    headers.forEach((header, index) => {
      record[header] = String(row[index] ?? '').trim()
    })
    return record
  })
}

function pickValue(row, aliases) {
  const lookup = new Map()
  Object.entries(row).forEach(([key, value]) => lookup.set(normalizeLookup(key), value))
  for (const alias of aliases) {
    const value = lookup.get(normalizeLookup(alias))
    if (value != null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

function parseDateValue(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const slash = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (slash) {
    const a = parseInt(slash[1], 10)
    const b = parseInt(slash[2], 10)
    const yearNum = parseInt(slash[3], 10)
    const year = yearNum < 100 ? 2000 + yearNum : yearNum
    const month = a > 12 ? b : a
    const day = a > 12 ? a : b
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function parseNumberValue(value) {
  const cleaned = String(value || '').replace(/[^0-9.+-]/g, '').trim()
  if (!cleaned) return null
  const parsed = parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseHoursValue(row) {
  const explicit = pickValue(row, ['hours', 'hours worked', 'total hours', 'duration', 'time'])
  const numeric = parseNumberValue(explicit)
  if (numeric != null) return numeric

  const start = normalizeTime(pickValue(row, ['start', 'start time', 'clock in', 'in', 'from']))
  const end = normalizeTime(pickValue(row, ['end', 'end time', 'clock out', 'out', 'to']))
  const startMinutes = timeToMinutes(start)
  const endMinutes = timeToMinutes(end)
  if (startMinutes == null || endMinutes == null) return 0
  let diff = endMinutes - startMinutes
  if (diff < 0) diff += 24 * 60
  return diff / 60
}

function projectPrefix(name) {
  return String(name || '')
    .split(/\s+/)
    .map(word => word[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 5)
}

function parseInvoiceSequence(value) {
  if (!value) return 0
  const match = String(value).match(/(\d+)(?!.*\d)/)
  return match ? parseInt(match[1], 10) : 0
}

function nextProjectInvoiceSeq(project, allInvoices) {
  const maxExisting = allInvoices.reduce((max, invoice) => {
    const belongsToProject = invoice.project_id === project.id || invoice.project_name === project.name
    if (!belongsToProject) return max
    const seq = parseInvoiceSequence(invoice.number)
    return Number.isFinite(seq) ? Math.max(max, seq) : max
  }, 0)
  if (maxExisting > 0) return maxExisting + 1
  return Math.max(project.next_invoice_seq ?? 1, 1)
}

function formatHours(hours) {
  const safe = Number.isFinite(hours) ? Math.max(0, hours) : 0
  const rounded = Math.round(safe * 100) / 100
  if (Number.isInteger(rounded)) return `${rounded}`
  return `${rounded}`.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

function buildRowsSummary(entries) {
  const daily = {}
  for (const entry of entries) {
    daily[entry.date] = (daily[entry.date] || 0) + entry.hours
  }
  return Object.fromEntries(Object.entries(daily).map(([date, hours]) => [date, formatHours(hours)]))
}

function computeWeekDefaults() {
  const today = new Date()
  const currentDay = today.getDay()
  const daysSinceMonday = (currentDay + 6) % 7
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() - daysSinceMonday)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday)
  lastSunday.setDate(thisMonday.getDate() - 1)
  return {
    start: lastMonday.toISOString().slice(0, 10),
    end: lastSunday.toISOString().slice(0, 10),
  }
}

function buildNotification(batch, invoices, warnings, settings) {
  const emailTo = batch.notify_email || settings.timesheet_notify_email || settings.company_email || ''
  const subject = `Draft invoices ready: ${batch.billing_week_start} to ${batch.billing_week_end}`
  const body = [
    `The Logwork import ${batch.source_filename || batch.source} completed successfully.`,
    '',
    `Draft invoices created: ${invoices.length}`,
    `Timesheet rows processed: ${batch.row_count}`,
    warnings.length ? `Warnings: ${warnings.join(' | ')}` : '',
    '',
    'Open the Invoices screen in the app to review the drafts before sending.',
  ].filter(Boolean).join('\n')
  return { emailTo, subject, body }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod === 'GET') {
    return json(200, {
      ok: true,
      endpoint: '/.netlify/functions/timesheet-import',
      requiredEnv: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TIMESHEET_IMPORT_USER_ID'],
      defaultBillingWeek: computeWeekDefaults(),
    })
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const importUserId = process.env.TIMESHEET_IMPORT_USER_ID

  if (!serviceKey) return json(500, { error: 'Netlify env var SUPABASE_SERVICE_ROLE_KEY is missing' })
  if (!importUserId) return json(500, { error: 'Netlify env var TIMESHEET_IMPORT_USER_ID is missing' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const rawCsv = String(payload.rawCsv || '').trim()
  if (!rawCsv) return json(400, { error: 'rawCsv is required' })

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const source = String(payload.source || 'logwork')
  const sourceFilename = String(payload.sourceFilename || '')
  const billingWeekStart = String(payload.billingWeekStart || computeWeekDefaults().start)
  const billingWeekEnd = String(payload.billingWeekEnd || computeWeekDefaults().end)
  const sourceHash = createHash('sha1').update(rawCsv).digest('hex').slice(0, 16)
  const dedupeKey = `${source}:${billingWeekStart}:${billingWeekEnd}:${sourceHash}`
  const rawPayload = payload.rawPayload && typeof payload.rawPayload === 'object' ? payload.rawPayload : {}

  const settingsRes = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
  if (settingsRes.error) return json(500, { error: settingsRes.error.message || 'Failed to load settings' })
  const settings = settingsRes.data || {}
  if (settings.timesheet_automation_enabled === false) {
    return json(403, { error: 'Timesheet automation is disabled in Settings.' })
  }

  const existingBatchRes = await supabase
    .from('timesheet_import_batches')
    .select('*')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (existingBatchRes.error) return json(500, { error: existingBatchRes.error.message || 'Failed to check import history' })
  if (existingBatchRes.data) {
    const batchInvoicesRes = await supabase
      .from('timesheet_batch_invoices')
      .select('*')
      .eq('batch_id', existingBatchRes.data.id)
      .order('created_at', { ascending: true })
    if (batchInvoicesRes.error) return json(500, { error: batchInvoicesRes.error.message || 'Failed to load existing batch invoices' })
    const invoiceIds = (batchInvoicesRes.data || []).map(row => row.invoice_id).filter(Boolean)
    let invoices = []
    if (invoiceIds.length > 0) {
      const invRes = await supabase.from('invoices').select('*').in('id', invoiceIds)
      if (invRes.error) return json(500, { error: invRes.error.message || 'Failed to load existing invoices' })
      invoices = invRes.data || []
    }
    return json(200, {
      ok: true,
      reused: true,
      batch: existingBatchRes.data,
      invoices,
      rows: [],
      warnings: ['This timesheet batch was already imported.'],
      notification: buildNotification(existingBatchRes.data, invoices, ['This timesheet batch was already imported.'], settings),
    })
  }

  const employeesRes = await supabase.from('employees').select('*')
  const projectsRes = await supabase.from('projects').select('*')
  const clientsRes = await supabase.from('clients').select('*')
  const invoicesRes = await supabase.from('invoices').select('*').order('created_at', { ascending: false })
  const mappingsRes = await supabase.from('timesheet_mappings').select('*').order('created_at', { ascending: true })

  for (const result of [employeesRes, projectsRes, clientsRes, invoicesRes, mappingsRes]) {
    if (result.error) return json(500, { error: result.error.message || 'Failed to load app data' })
  }

  const employees = employeesRes.data || []
  const projects = projectsRes.data || []
  const clients = clientsRes.data || []
  const invoices = invoicesRes.data || []
  const mappings = mappingsRes.data || []
  const records = parseCsv(rawCsv)

  if (records.length === 0) return json(400, { error: 'The CSV did not contain any data rows.' })

  const batchInsert = {
    id: uid(),
    user_id: importUserId,
    source,
    source_filename: sourceFilename || null,
    source_hash: sourceHash,
    dedupe_key: dedupeKey,
    billing_week_start: billingWeekStart,
    billing_week_end: billingWeekEnd,
    raw_csv: rawCsv,
    raw_payload: rawPayload,
    status: 'received',
    row_count: 0,
    project_count: 0,
    invoice_count: 0,
    error_message: null,
  }

  const batchRes = await supabase.from('timesheet_import_batches').insert(batchInsert).select('*').single()
  if (batchRes.error) return json(500, { error: batchRes.error.message || 'Failed to create batch' })
  const batch = batchRes.data

  const warnings = new Set()
  const rowInserts = []
  const mappingRows = []
  const grouped = new Map()

  function findEmployee(name) {
    const normalized = normalizeLookup(name)
    if (!normalized) return null
    const mapping = mappings.find(row => row.source_kind === 'employee' && normalizeLookup(row.source_value) === normalized)
    if (mapping) return employees.find(emp => emp.id === mapping.employee_id) || null
    return employees.find(emp => normalizeLookup(emp.name) === normalized) || null
  }

  function findProject(name) {
    const normalized = normalizeLookup(name)
    if (!normalized) return null
    const mapping = mappings.find(row => row.source_kind === 'project' && normalizeLookup(row.source_value) === normalized)
    if (mapping) return projects.find(proj => proj.id === mapping.project_id) || null
    return projects.find(proj => normalizeLookup(proj.name) === normalized) || null
  }

  records.forEach((record, index) => {
    const rawEmployeeName = pickValue(record, ['employee', 'employee name', 'name', 'worker', 'staff'])
    const rawProjectName = pickValue(record, ['project', 'project name', 'job', 'client', 'assignment'])
    const workDate = parseDateValue(pickValue(record, ['date', 'work date', 'day', 'shift date'])) || billingWeekStart
    const startTime = normalizeTime(pickValue(record, ['start', 'start time', 'clock in', 'in', 'from']))
    const endTime = normalizeTime(pickValue(record, ['end', 'end time', 'clock out', 'out', 'to']))
    const hours = parseHoursValue(record)
    const rowRate = parseNumberValue(pickValue(record, ['rate', 'hourly rate', 'billing rate', 'pay rate']))
    const notes = pickValue(record, ['notes', 'note', 'description', 'task', 'activity'])

    const employee = findEmployee(rawEmployeeName)
    const project = findProject(rawProjectName)
    const rowInsert = {
      id: uid(),
      user_id: importUserId,
      batch_id: batch.id,
      row_index: index + 1,
      raw_employee_name: rawEmployeeName || '',
      raw_project_name: rawProjectName || '',
      employee_id: employee ? employee.id : null,
      project_id: project ? project.id : null,
      work_date: workDate,
      start_time: startTime || null,
      end_time: endTime || null,
      hours,
      rate: rowRate,
      amount: null,
      notes: notes || null,
      match_status: employee && project ? 'matched' : 'unmatched',
      match_reason: employee && project ? null : [
        !employee ? `Unmatched employee: ${rawEmployeeName || '(blank)'}` : null,
        !project ? `Unmatched project: ${rawProjectName || '(blank)'}` : null,
      ].filter(Boolean).join(' | ') || null,
    }
    rowInserts.push(rowInsert)
    if (rowInsert.match_reason) warnings.add(rowInsert.match_reason)

    if (!employee || !project) return

    const premiumEnabled = Boolean(employee.premium_enabled ?? employee.premiumEnabled)
    const premiumPercent = toNumber(employee.premium_percent ?? employee.premiumPercent)
    const premiumStartTime = normalizeTime(employee.premium_start_time || employee.premiumStartTime || '21:00') || '21:00'
    const effectiveShiftStart = startTime || normalizeTime(employee.default_shift_start || employee.defaultShiftStart)
    const effectiveShiftEnd = endTime || normalizeTime(employee.default_shift_end || employee.defaultShiftEnd)
    const billingRate = toNumber(project.rate || rowRate || employee.pay_rate || employee.payRate)
    const payrollBreakdown = computePayrollBreakdown(hours, employee, effectiveShiftStart, effectiveShiftEnd)
    const billBreakdown = computePremiumAdjustedAmount(
      hours,
      billingRate,
      premiumPercent,
      premiumEnabled && Boolean(effectiveShiftStart && effectiveShiftEnd),
      effectiveShiftStart,
      effectiveShiftEnd,
      premiumStartTime,
    )

    const key = project.id
    if (!grouped.has(key)) {
      grouped.set(key, {
        project,
        employeeBuckets: new Map(),
      })
    }
    const group = grouped.get(key)
    if (!group.employeeBuckets.has(employee.id)) {
      group.employeeBuckets.set(employee.id, {
        employee,
        hours: 0,
        billAmount: 0,
        payrollAmount: 0,
        daily: {},
        entries: [],
        billingRate,
        payrollBreakdown,
        billBreakdown,
      })
    }
    const bucket = group.employeeBuckets.get(employee.id)
    bucket.hours += hours
    bucket.billAmount += billBreakdown.totalAmount
    bucket.payrollAmount += payrollBreakdown.totalPay
    bucket.daily[workDate] = (bucket.daily[workDate] || 0) + hours
    bucket.entries.push({
      date: workDate,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      hours,
      note: notes || undefined,
    })
    bucket.billingRate = billingRate
    bucket.payrollBreakdown = {
      ...bucket.payrollBreakdown,
      totalHours: bucket.payrollBreakdown.totalHours + payrollBreakdown.totalHours,
      regularHours: bucket.payrollBreakdown.regularHours + payrollBreakdown.regularHours,
      premiumHours: bucket.payrollBreakdown.premiumHours + payrollBreakdown.premiumHours,
      totalPay: bucket.payrollAmount,
    }
    bucket.billBreakdown = {
      ...bucket.billBreakdown,
      totalHours: bucket.billBreakdown.totalHours + billBreakdown.totalHours,
      regularHours: bucket.billBreakdown.regularHours + billBreakdown.regularHours,
      premiumHours: bucket.billBreakdown.premiumHours + billBreakdown.premiumHours,
      totalAmount: bucket.billAmount,
    }

    mappingRows.push({
      id: uid(),
      user_id: importUserId,
      source_kind: 'employee',
      source_value: normalizeLookup(rawEmployeeName),
      employee_id: employee.id,
      project_id: null,
    })
    mappingRows.push({
      id: uid(),
      user_id: importUserId,
      source_kind: 'project',
      source_value: normalizeLookup(rawProjectName),
      employee_id: null,
      project_id: project.id,
    })
  })

  if (rowInserts.length > 0) {
    const rowRes = await supabase.from('timesheet_import_rows').insert(rowInserts)
    if (rowRes.error) return json(500, { error: rowRes.error.message || 'Failed to store timesheet rows', details: rowRes.error })
  }

  const createdInvoices = []
  const batchInvoiceRows = []
  const updatedProjects = []
  const existingInvoices = invoices.slice()

  for (const [projectId, group] of grouped.entries()) {
    const project = group.project
    const client = project.client_id ? clients.find(c => c.id === project.client_id) : null
    const seq = nextProjectInvoiceSeq(project, existingInvoices)
    const invoiceNumber = `${projectPrefix(project.name)}${String(seq).padStart(4, '0')}`
    const invoiceDate = billingWeekEnd || billingWeekStart || new Date().toISOString().slice(0, 10)
    const items = Array.from(group.employeeBuckets.values()).map(bucket => ({
      employeeId: bucket.employee.id,
      employeeName: bucket.employee.name,
      position: bucket.employee.role || bucket.employee.employmentType || undefined,
      hoursTotal: Number(bucket.hours.toFixed(2)),
      rate: Number(bucket.billingRate || 0),
      billAmount: Number(bucket.billAmount.toFixed(2)),
      shiftStart: normalizeTime(bucket.entries[0]?.startTime || bucket.employee.default_shift_start || bucket.employee.defaultShiftStart) || undefined,
      shiftEnd: normalizeTime(bucket.entries[0]?.endTime || bucket.employee.default_shift_end || bucket.employee.defaultShiftEnd) || undefined,
      regularHours: Number(bucket.payrollBreakdown.regularHours.toFixed(2)),
      premiumHours: Number(bucket.payrollBreakdown.premiumHours.toFixed(2)),
      basePayRate: Number(bucket.payrollBreakdown.basePayRate),
      premiumPercent: Number(bucket.payrollBreakdown.premiumPercent),
      totalPay: Number(bucket.payrollAmount.toFixed(2)),
      timeEntries: bucket.entries,
      daily: buildRowsSummary(bucket.entries),
    }))

    const subtotal = items.reduce((sum, item) => sum + Number(item.billAmount || 0), 0)
    const invoice = {
      id: uid(),
      number: invoiceNumber,
      date: invoiceDate,
      billing_start: billingWeekStart,
      billing_end: billingWeekEnd,
      client_name: client ? client.name : '',
      client_email: client ? client.email || '' : '',
      client_address: client ? client.address || '' : '',
      project_id: project.id,
      project_name: project.name,
      status: 'draft',
      subtotal: Number(subtotal.toFixed(2)),
      notes: `Generated from ${source}${sourceFilename ? ` (${sourceFilename})` : ''}. Review before sending.`,
      items,
      employee_payments: {},
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    createdInvoices.push(invoice)
    existingInvoices.push(invoice)
    updatedProjects.push({ ...project, next_invoice_seq: seq + 1 })
    batchInvoiceRows.push({
      id: uid(),
      user_id: importUserId,
      batch_id: batch.id,
      project_id: project.id,
      invoice_id: invoice.id,
      invoice_number: invoice.number,
      invoice_status: invoice.status,
    })
  }

  if (createdInvoices.length > 0) {
    const invoiceRes = await supabase.from('invoices').insert(createdInvoices)
    if (invoiceRes.error) return json(500, { error: invoiceRes.error.message || 'Failed to save draft invoices', details: invoiceRes.error })
    if (updatedProjects.length > 0) {
      const projectRes = await supabase.from('projects').upsert(updatedProjects)
      if (projectRes.error) return json(500, { error: projectRes.error.message || 'Failed to update project counters', details: projectRes.error })
    }
    const batchInvoiceRes = await supabase.from('timesheet_batch_invoices').insert(batchInvoiceRows)
    if (batchInvoiceRes.error) return json(500, { error: batchInvoiceRes.error.message || 'Failed to save batch invoice links', details: batchInvoiceRes.error })
    const mappingRes = await supabase.from('timesheet_mappings').upsert(mappingRows, { onConflict: 'user_id,source_kind,source_value' })
    if (mappingRes.error) return json(500, { error: mappingRes.error.message || 'Failed to save timesheet mappings', details: mappingRes.error })
  }

  const batchUpdate = await supabase
    .from('timesheet_import_batches')
    .update({
      status: createdInvoices.length > 0 ? 'drafts_created' : 'parsed',
      row_count: rowInserts.length,
      project_count: grouped.size,
      invoice_count: createdInvoices.length,
      error_message: warnings.size ? Array.from(warnings).join(' | ') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batch.id)
  if (batchUpdate.error) return json(500, { error: batchUpdate.error.message || 'Failed to update batch summary', details: batchUpdate.error })

  const notification = buildNotification(
    {
      ...batch,
      row_count: rowInserts.length,
      invoice_count: createdInvoices.length,
      source_filename: sourceFilename || source,
      notify_email: settings.timesheet_notify_email || settings.company_email || '',
      billing_week_start: billingWeekStart,
      billing_week_end: billingWeekEnd,
    },
    createdInvoices,
    Array.from(warnings),
    settings,
  )

  return json(200, {
    ok: true,
    reused: false,
    batch: {
      ...batch,
      row_count: rowInserts.length,
      project_count: grouped.size,
      invoice_count: createdInvoices.length,
      status: createdInvoices.length > 0 ? 'drafts_created' : 'parsed',
    },
    invoices: createdInvoices,
    rows: rowInserts,
    warnings: Array.from(warnings),
    notification,
  })
}
