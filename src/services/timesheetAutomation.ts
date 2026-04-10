import type {
  Employee,
  Invoice,
  InvoiceItem,
  InvoiceTimeEntry,
  Project,
  TimesheetBatchInvoice,
  TimesheetImportBatch,
  TimesheetImportRow,
  TimesheetMapping,
} from '../data/types'
import {
  createTimesheetImportBatch,
  deleteTimesheetImportBatch,
  findTimesheetImportBatchByDedupeKey,
  loadClients,
  loadEmployees,
  loadInvoices,
  loadProjects,
  loadSettings,
  loadTimesheetBatchInvoices,
  loadTimesheetMappings,
  saveInvoices,
  saveProjects,
  saveTimesheetBatchInvoices,
  saveTimesheetImportRows,
  saveTimesheetMappings,
  updateTimesheetImportBatch,
} from './storage'
import { supabase } from '../lib/supabase'
import { computePayrollBreakdown, computePremiumAdjustedAmount, employeePremiumConfig, normalizeClockInput } from '../utils/payroll'

type CSVRecord = Record<string, string>

export type TimesheetImportInput = {
  rawCsv: string
  billingWeekStart?: string
  billingWeekEnd?: string
  source?: string
  sourceFilename?: string
  rawPayload?: Record<string, unknown>
  userId?: string
  notifyEmail?: string
}

export type TimesheetImportResult = {
  batch: TimesheetImportBatch
  invoices: Invoice[]
  rows: TimesheetImportRow[]
  warnings: string[]
  reused: boolean
}

function uid() {
  return crypto.randomUUID()
}

function normalizeLookup(value?: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function simpleHash(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function detectDelimiter(text: string): ',' | ';' {
  const sample = text.split(/\r?\n/).find(line => line.trim()) || ''
  const commaCount = (sample.match(/,/g) || []).length
  const semicolonCount = (sample.match(/;/g) || []).length
  return semicolonCount > commaCount ? ';' : ','
}

function parseCsv(text: string): CSVRecord[] {
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let current: string[] = []
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

    if (ch !== '\r') {
      cell += ch
    }
  }

  current.push(cell)
  rows.push(current)

  const cleaned = rows.filter(row => row.some(value => value.trim() !== ''))
  if (cleaned.length === 0) return []

  const headers = cleaned.shift()!.map(header => header.trim())
  return cleaned.map(row => {
    const record: CSVRecord = {}
    headers.forEach((header, index) => {
      record[header] = (row[index] ?? '').trim()
    })
    return record
  })
}

function pickValue(row: CSVRecord, aliases: string[]): string {
  const lookup = new Map<string, string>()
  Object.entries(row).forEach(([key, value]) => lookup.set(normalizeLookup(key), value))
  for (const alias of aliases) {
    const value = lookup.get(normalizeLookup(alias))
    if (value != null && value.trim() !== '') return value.trim()
  }
  return ''
}

function parseDateValue(value: string): string {
  const trimmed = value.trim()
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
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return ''
}

function parseNumberValue(value: string): number | null {
  const cleaned = value.replace(/[^0-9.+-]/g, '').trim()
  if (!cleaned) return null
  const parsed = parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseMinutesFromClock(value?: string): number | null {
  const text = normalizeClockInput(value || '').trim().toUpperCase()
  if (!text) return null

  let match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/)
  if (match) {
    let hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2], 10)
    const meridian = match[3]
    if (meridian) {
      if (hours === 12) hours = 0
      if (meridian === 'PM') hours += 12
    }
    return hours * 60 + minutes
  }

  match = text.match(/^(\d{1,2})\s*(AM|PM)$/)
  if (match) {
    let hours = parseInt(match[1], 10)
    const meridian = match[2]
    if (hours === 12) hours = 0
    if (meridian === 'PM') hours += 12
    return hours * 60
  }

  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [hours, minutes] = text.split(':').map(v => parseInt(v, 10))
    return hours * 60 + minutes
  }

  return null
}

function hoursBetween(start?: string, end?: string): number {
  const startMinutes = parseMinutesFromClock(start)
  const endMinutes = parseMinutesFromClock(end)
  if (startMinutes == null || endMinutes == null) return 0
  let diff = endMinutes - startMinutes
  if (diff < 0) diff += 24 * 60
  return diff / 60
}

function hoursFromRow(row: CSVRecord): number {
  const explicit = pickValue(row, ['hours', 'hours worked', 'total hours', 'duration', 'time'])
  const numeric = parseNumberValue(explicit)
  if (numeric != null) return numeric

  const start = pickValue(row, ['start', 'start time', 'clock in', 'in', 'from'])
  const end = pickValue(row, ['end', 'end time', 'clock out', 'out', 'to'])
  return hoursBetween(start, end)
}

function formatHours(hours: number): string {
  const safe = Number.isFinite(hours) ? Math.max(0, hours) : 0
  const rounded = Math.round(safe * 100) / 100
  if (Number.isInteger(rounded)) return `${rounded}`
  return `${rounded}`.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

function projectPrefix(name: string): string {
  return name.split(/\s+/).map(word => word[0] || '').join('').toUpperCase().slice(0, 5)
}

function parseInvoiceSequence(value?: string): number {
  if (!value) return 0
  const match = value.match(/(\d+)(?!.*\d)/)
  return match ? parseInt(match[1], 10) : 0
}

function nextProjectInvoiceSeq(project: Project, allInvoices: Invoice[]): number {
  const maxExisting = allInvoices.reduce((max, invoice) => {
    const belongsToProject = invoice.projectId === project.id || invoice.projectName === project.name
    if (!belongsToProject) return max
    const seq = parseInvoiceSequence(invoice.number)
    return Number.isFinite(seq) ? Math.max(max, seq) : max
  }, 0)
  if (maxExisting > 0) return maxExisting + 1
  return Math.max(project.nextInvoiceSeq ?? 1, 1)
}

function addHours(valueA: number, valueB: number): number {
  return Math.round((valueA + valueB) * 100) / 100
}

function buildNormalizedMappingRows(
  userId: string,
  employeeName: string,
  employeeId: string,
  projectName: string,
  projectId: string,
): TimesheetMapping[] {
  return [
    {
      id: uid(),
      userId,
      sourceKind: 'employee',
      sourceValue: normalizeLookup(employeeName),
      employeeId,
      projectId: null,
    },
    {
      id: uid(),
      userId,
      sourceKind: 'project',
      sourceValue: normalizeLookup(projectName),
      employeeId: null,
      projectId,
    },
  ]
}

function findByNormalizedName<T extends { id: string; name: string }>(items: T[], value: string): T | undefined {
  const normalized = normalizeLookup(value)
  if (!normalized) return undefined
  return items.find(item => normalizeLookup(item.name) === normalized)
}

function findMapping<T extends { sourceKind: 'employee' | 'project'; sourceValue: string; employeeId?: string | null; projectId?: string | null }>(
  mappings: T[],
  kind: 'employee' | 'project',
  value: string,
): T | undefined {
  const normalized = normalizeLookup(value)
  return mappings.find(mapping => mapping.sourceKind === kind && normalizeLookup(mapping.sourceValue) === normalized)
}

function parseCsvRowToCandidate(row: CSVRecord, billingWeekStart: string): {
  rawEmployeeName: string
  rawProjectName: string
  rawClientName: string
  workDate: string
  startTime: string
  endTime: string
  hours: number
  rate: number | null
  amount: number | null
  notes: string
  matchReason?: string
} {
  const rawEmployeeName = pickValue(row, ['employee', 'employee name', 'name', 'worker', 'staff'])
  const rawProjectName = pickValue(row, ['project', 'project name', 'job', 'assignment'])
  const rawClientName = pickValue(row, ['client', 'client name', 'customer'])
  const workDate = parseDateValue(pickValue(row, ['date', 'work date', 'day', 'shift date'])) || billingWeekStart
  const startTime = normalizeClockInput(pickValue(row, ['start', 'start time', 'clock in', 'in', 'from']))
  const endTime = normalizeClockInput(pickValue(row, ['end', 'end time', 'clock out', 'out', 'to']))
  const hours = hoursFromRow(row)
  const rate = parseNumberValue(pickValue(row, ['rate', 'hourly rate', 'billing rate', 'pay rate']))
  const amount = parseNumberValue(pickValue(row, ['amount', 'total', 'total amount', 'extended amount']))
  const notes = pickValue(row, ['notes', 'note', 'description', 'task', 'activity'])
  return {
    rawEmployeeName,
    rawProjectName,
    rawClientName,
    workDate,
    startTime,
    endTime,
    hours,
    rate,
    amount,
    notes,
  }
}

function employeeAssignedProjects(employee: Employee, projects: Project[]): Project[] {
  return projects.filter(project => Array.isArray(project.employeeIds) && project.employeeIds.includes(employee.id))
}

function inferProjectFromEmployeeAssignment(
  employee: Employee,
  projects: Project[],
  clients: { id: string; name: string }[],
  rawClientName: string,
): Project | undefined {
  const assigned = employeeAssignedProjects(employee, projects)
  if (assigned.length === 1) return assigned[0]
  if (!rawClientName) return undefined
  const client = findByNormalizedName(clients, rawClientName)
  if (!client) return undefined
  const matchingAssigned = assigned.filter(project => project.clientId === client.id)
  if (matchingAssigned.length === 1) return matchingAssigned[0]
  return undefined
}

function summarizeInvoiceEntries(entries: InvoiceTimeEntry[]): Record<string, string> {
  const daily: Record<string, number> = {}
  for (const entry of entries) {
    daily[entry.date] = addHours(daily[entry.date] || 0, entry.hours)
  }
  return Object.fromEntries(
    Object.entries(daily).map(([date, hours]) => [date, formatHours(hours)])
  )
}

function buildInvoiceItems(
  buckets: Array<{
    employee: Employee
    timeEntries: InvoiceTimeEntry[]
    hours: number
    payroll: ReturnType<typeof computePayrollBreakdown>
    billAmount: number
    billingRate: number
  }>
): InvoiceItem[] {
  return buckets
    .map(bucket => {
      const timeEntries = bucket.timeEntries.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return `${a.startTime || ''}`.localeCompare(b.startTime || '', undefined, { numeric: true, sensitivity: 'base' })
      })
      const summarizedDaily = summarizeInvoiceEntries(timeEntries)
      const payroll = bucket.payroll
      return {
        employeeId: bucket.employee.id,
        employeeName: bucket.employee.name,
        position: bucket.employee.role || bucket.employee.employmentType || undefined,
        hoursTotal: bucket.hours,
        rate: bucket.billingRate,
        billAmount: bucket.billAmount,
        shiftStart: bucket.employee.defaultShiftStart || undefined,
        shiftEnd: bucket.employee.defaultShiftEnd || undefined,
        regularHours: payroll.regularHours,
        premiumHours: payroll.premiumHours,
        basePayRate: payroll.basePayRate,
        premiumPercent: payroll.premiumPercent,
        totalPay: payroll.totalPay,
        timeEntries,
        daily: summarizedDaily,
      } satisfies InvoiceItem
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}

export async function importTimesheetCsv(input: TimesheetImportInput): Promise<TimesheetImportResult> {
  const rawCsv = (input.rawCsv || '').trim()
  if (!rawCsv) throw new Error('Timesheet CSV is empty.')

  const [snapshot, existingMappings] = await Promise.all([
    loadInvoices().then(async invoices => ({
      invoices,
      employees: await loadEmployees(),
      projects: await loadProjects(),
      clients: await loadClients(),
      settings: await loadSettings(),
    })),
    loadTimesheetMappings(),
  ])

  const authUser = input.userId
    ? { id: input.userId }
    : (await supabase.auth.getUser()).data.user
  const userId = authUser?.id
  if (!userId) throw new Error('You must be signed in to import a timesheet batch.')
  const source = input.source || 'logwork'
  const billingWeekStart = input.billingWeekStart || ''
  const billingWeekEnd = input.billingWeekEnd || ''
  const sourceHash = simpleHash(rawCsv)
  const dedupeKey = `${source}:${billingWeekStart}:${billingWeekEnd}:${sourceHash}`

  const duplicate = await findTimesheetImportBatchByDedupeKey(dedupeKey)
  if (duplicate) {
    const batchInvoices = await loadTimesheetBatchInvoices(duplicate.id)
    if ((duplicate.invoiceCount || 0) === 0 && batchInvoices.length === 0) {
      await deleteTimesheetImportBatch(duplicate.id)
    } else {
      const invoiceIds = batchInvoices.map(record => record.invoiceId).filter(Boolean) as string[]
      const invoices = snapshot.invoices.filter(invoice => invoiceIds.includes(invoice.id))
      return {
        batch: duplicate,
        invoices,
        rows: [],
        warnings: ['This timesheet batch was already imported.'],
        reused: true,
      }
    }
  }

  const records = parseCsv(rawCsv)
  if (records.length === 0) throw new Error('The CSV did not contain any data rows.')

  const billingStart = billingWeekStart || parseDateValue(pickValue(records[0], ['week start', 'period start'])) || records[0].date || new Date().toISOString().slice(0, 10)
  const billingEnd = billingWeekEnd || parseDateValue(pickValue(records[0], ['week end', 'period end'])) || billingStart

  const employeeIndex = snapshot.employees.slice().sort((a, b) => a.name.localeCompare(b.name))
  const projectIndex = snapshot.projects.slice().sort((a, b) => a.name.localeCompare(b.name))
  const clientIndex = snapshot.clients.slice().sort((a, b) => a.name.localeCompare(b.name))

  const rows: TimesheetImportRow[] = []
  const warnings = new Set<string>()
  const matchedMappings: TimesheetMapping[] = []
  const grouped = new Map<string, {
    project: Project
    projectName: string
    employeeBuckets: Map<string, {
      employee: Employee
      rows: TimesheetImportRow[]
      timeEntries: InvoiceTimeEntry[]
      hours: number
      payroll: ReturnType<typeof computePayrollBreakdown>
      billAmount: number
      billingRate: number
      daily: Record<string, number>
    }>
  }>()
  const unresolvedGroups = new Map<string, {
    label: string
    client?: { id: string; name: string; email?: string; address?: string }
    employeeBuckets: Map<string, {
      employee: Employee
      rows: TimesheetImportRow[]
      timeEntries: InvoiceTimeEntry[]
      hours: number
      payroll: ReturnType<typeof computePayrollBreakdown>
      billAmount: number
      billingRate: number
      daily: Record<string, number>
    }>
  }>()

  records.forEach((rowRecord, index) => {
    const candidate = parseCsvRowToCandidate(rowRecord, billingStart)
    const matchedEmployeeMapping = findMapping(existingMappings, 'employee', candidate.rawEmployeeName)
    const matchedProjectMapping = findMapping(existingMappings, 'project', candidate.rawProjectName)
    const employee = matchedEmployeeMapping?.employeeId
      ? snapshot.employees.find(emp => emp.id === matchedEmployeeMapping.employeeId)
      : findByNormalizedName(employeeIndex, candidate.rawEmployeeName)
    const explicitProject = matchedProjectMapping?.projectId
      ? snapshot.projects.find(proj => proj.id === matchedProjectMapping.projectId)
      : findByNormalizedName(projectIndex, candidate.rawProjectName)
    const matchedClient = findByNormalizedName(clientIndex, candidate.rawClientName)
    const project = explicitProject || (employee
      ? inferProjectFromEmployeeAssignment(employee, snapshot.projects, snapshot.clients, candidate.rawClientName)
      : undefined)

    const matchReasons: string[] = []
    if (!employee) matchReasons.push(`Unmatched employee: ${candidate.rawEmployeeName || '(blank)'}`)
    if (!project) matchReasons.push(`Unmatched project: ${candidate.rawProjectName || '(blank)'}`)

    const storedRow: TimesheetImportRow = {
      id: uid(),
      userId,
      batchId: 'pending',
      rowIndex: index + 1,
      rawEmployeeName: candidate.rawEmployeeName || '',
      rawProjectName: candidate.rawProjectName || '(blank)',
      employeeId: employee?.id || null,
      projectId: project?.id || null,
      workDate: candidate.workDate,
      startTime: candidate.startTime || undefined,
      endTime: candidate.endTime || undefined,
      hours: candidate.hours,
      rate: candidate.rate,
      amount: candidate.amount,
      notes: candidate.notes || undefined,
      matchStatus: employee && project ? 'matched' : 'unmatched',
      matchReason: matchReasons.join(' | ') || undefined,
    }

    rows.push(storedRow)
    if (matchReasons.length) warnings.add(matchReasons.join(' | '))
    if (!employee) return

    const premiumConfig = employeePremiumConfig(employee)
    const shiftStart = employee.defaultShiftStart || ''
    const shiftEnd = employee.defaultShiftEnd || ''
    const rowHours = candidate.hours
    const payroll = computePayrollBreakdown(rowHours, employee, shiftStart, shiftEnd)

    if (!project) {
      const unresolvedKey = matchedClient?.id || normalizeLookup(candidate.rawClientName) || employee.id
      const unresolvedGroup = unresolvedGroups.get(unresolvedKey) || {
        label: matchedClient?.name || candidate.rawClientName || 'Unassigned project review',
        client: matchedClient
          ? {
              id: matchedClient.id,
              name: matchedClient.name,
              email: matchedClient.email,
              address: matchedClient.address,
            }
          : undefined,
        employeeBuckets: new Map(),
      }
      if (!unresolvedGroups.has(unresolvedKey)) unresolvedGroups.set(unresolvedKey, unresolvedGroup)

      const unresolvedBillingRate = Number(candidate.rate ?? matchedClient?.defaultRate ?? employee.payRate ?? 0) || 0
      const unresolvedBucket = unresolvedGroup.employeeBuckets.get(employee.id) || {
        employee,
        rows: [],
        timeEntries: [],
        hours: 0,
        payroll: computePayrollBreakdown(0, employee, shiftStart, shiftEnd),
        billAmount: 0,
        billingRate: unresolvedBillingRate,
        daily: {},
      }

      const unresolvedBill = computePremiumAdjustedAmount(
        rowHours,
        unresolvedBucket.billingRate,
        premiumConfig.percent,
        premiumConfig.enabled && Boolean(shiftStart && shiftEnd),
        shiftStart,
        shiftEnd,
        premiumConfig.startTime,
      )

      unresolvedBucket.rows.push(storedRow)
      unresolvedBucket.timeEntries.push({
        date: candidate.workDate,
        startTime: candidate.startTime || undefined,
        endTime: candidate.endTime || undefined,
        hours: rowHours,
        note: candidate.notes || undefined,
      })
      unresolvedBucket.hours = addHours(unresolvedBucket.hours, rowHours)
      unresolvedBucket.payroll = {
        totalHours: addHours(unresolvedBucket.payroll.totalHours, payroll.totalHours),
        regularHours: addHours(unresolvedBucket.payroll.regularHours, payroll.regularHours),
        premiumHours: addHours(unresolvedBucket.payroll.premiumHours, payroll.premiumHours),
        basePayRate: payroll.basePayRate,
        premiumPercent: payroll.premiumPercent,
        totalPay: addHours(unresolvedBucket.payroll.totalPay, payroll.totalPay),
      }
      unresolvedBucket.billAmount = addHours(unresolvedBucket.billAmount, unresolvedBill.totalAmount)
      unresolvedBucket.daily[candidate.workDate] = formatHours(addHours(Number(unresolvedBucket.daily[candidate.workDate] || 0), rowHours))
      unresolvedGroup.employeeBuckets.set(employee.id, unresolvedBucket)
      return
    }

    const rowsForGroup = grouped.get(project.id) || {
      project,
      projectName: project.name,
      employeeBuckets: new Map(),
    }
    if (!grouped.has(project.id)) grouped.set(project.id, rowsForGroup)

    const bucket = rowsForGroup.employeeBuckets.get(employee.id) || {
      employee,
      rows: [],
      timeEntries: [],
      hours: 0,
      payroll: computePayrollBreakdown(0, employee, shiftStart, shiftEnd),
      billAmount: 0,
      billingRate: Number(project.rate ?? employee.payRate ?? candidate.rate ?? 0) || 0,
      daily: {},
    }
    const bill = computePremiumAdjustedAmount(
      rowHours,
      bucket.billingRate,
      premiumConfig.percent,
      premiumConfig.enabled && Boolean(shiftStart && shiftEnd),
      shiftStart,
      shiftEnd,
      premiumConfig.startTime,
    )

    bucket.rows.push(storedRow)
    bucket.timeEntries.push({
      date: candidate.workDate,
      startTime: candidate.startTime || undefined,
      endTime: candidate.endTime || undefined,
      hours: rowHours,
      note: candidate.notes || undefined,
    })
    bucket.hours = addHours(bucket.hours, rowHours)
    bucket.payroll = {
      totalHours: addHours(bucket.payroll.totalHours, payroll.totalHours),
      regularHours: addHours(bucket.payroll.regularHours, payroll.regularHours),
      premiumHours: addHours(bucket.payroll.premiumHours, payroll.premiumHours),
      basePayRate: payroll.basePayRate,
      premiumPercent: payroll.premiumPercent,
      totalPay: addHours(bucket.payroll.totalPay, payroll.totalPay),
    }
    bucket.billAmount = addHours(bucket.billAmount, bill.totalAmount)
    bucket.daily[candidate.workDate] = formatHours(addHours(Number(bucket.daily[candidate.workDate] || 0), rowHours))
    rowsForGroup.employeeBuckets.set(employee.id, bucket)

    if (matchedEmployeeMapping || matchedProjectMapping) {
      matchedMappings.push(
        ...buildNormalizedMappingRows(userId, candidate.rawEmployeeName, employee.id, candidate.rawProjectName, project.id)
      )
    } else {
      matchedMappings.push(
        ...buildNormalizedMappingRows(userId, candidate.rawEmployeeName, employee.id, candidate.rawProjectName, project.id)
      )
    }
  })

  const batch = await createTimesheetImportBatch({
    userId,
    source,
    sourceFilename: input.sourceFilename,
    sourceHash,
    dedupeKey,
    billingWeekStart: billingStart,
    billingWeekEnd: billingEnd,
    rawCsv,
    rawPayload: input.rawPayload || {},
    status: 'received',
    rowCount: rows.length,
    projectCount: grouped.size,
    invoiceCount: 0,
    errorMessage: warnings.size ? Array.from(warnings).join(' | ') : undefined,
  })

  try {
    const persistedRows = rows.map(row => ({ ...row, batchId: batch.id }))
    await saveTimesheetImportRows(persistedRows)

    const createdInvoices: Invoice[] = []
    const batchInvoiceRows: TimesheetBatchInvoice[] = []
    const projectsToSave = snapshot.projects.map(project => ({ ...project }))
    const existingInvoices = snapshot.invoices.map(invoice => ({ ...invoice }))
    const usedProjectIds = new Set<string>()

    for (const [projectId, payload] of grouped.entries()) {
    const project = projectsToSave.find(item => item.id === projectId)
    if (!project) continue

    const client = project.clientId ? snapshot.clients.find(c => c.id === project.clientId) : undefined
    const seq = nextProjectInvoiceSeq(project, existingInvoices)
    const number = `${projectPrefix(project.name)}${String(seq).padStart(4, '0')}`
    const billingDate = billingEnd || billingStart || new Date().toISOString().slice(0, 10)
    const items = buildInvoiceItems(Array.from(payload.employeeBuckets.values()))

    const subtotal = items.reduce((sum, item) => sum + (Number(item.billAmount ?? item.hoursTotal * item.rate) || 0), 0)
    const invoice: Invoice = {
      id: uid(),
      number,
      date: billingDate,
      billingStart: billingStart,
      billingEnd: billingEnd,
      clientName: client?.name || '',
      clientEmail: client?.email || '',
      clientAddress: client?.address || '',
      projectId: project.id,
      projectName: project.name,
      status: 'draft',
      subtotal,
      notes: `Generated from ${source}${input.sourceFilename ? ` (${input.sourceFilename})` : ''}. Review before sending.`,
      items,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    createdInvoices.push(invoice)
    existingInvoices.push(invoice)
    usedProjectIds.add(project.id)
    project.nextInvoiceSeq = seq + 1
    batchInvoiceRows.push({
      id: uid(),
      userId,
      batchId: batch.id,
      projectId: project.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      invoiceStatus: invoice.status || 'draft',
    })
    }

    let unresolvedDraftCount = 0
    for (const payload of unresolvedGroups.values()) {
    const billingDate = billingEnd || billingStart || new Date().toISOString().slice(0, 10)
    const items = buildInvoiceItems(Array.from(payload.employeeBuckets.values()))
    const subtotal = items.reduce((sum, item) => sum + (Number(item.billAmount ?? item.hoursTotal * item.rate) || 0), 0)
    const invoice: Invoice = {
      id: uid(),
      number: `TMP-${String(unresolvedDraftCount + 1).padStart(3, '0')}`,
      date: billingDate,
      billingStart: billingStart,
      billingEnd: billingEnd,
      clientName: payload.client?.name || '',
      clientEmail: payload.client?.email || '',
      clientAddress: payload.client?.address || '',
      projectId: null,
      projectName: '',
      status: 'draft',
      subtotal,
      notes: `Generated from ${source}${input.sourceFilename ? ` (${input.sourceFilename})` : ''}. Project needs review before sending.`,
      items,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    unresolvedDraftCount += 1
    createdInvoices.push(invoice)
    existingInvoices.push(invoice)
    }

    if (createdInvoices.length > 0) {
      await saveInvoices(existingInvoices)
      await saveProjects(projectsToSave)
      if (batchInvoiceRows.length > 0) await saveTimesheetBatchInvoices(batchInvoiceRows)
      await saveTimesheetMappings(matchedMappings)
    }

    await updateTimesheetImportBatch(batch.id, {
      status: createdInvoices.length > 0 ? 'drafts_created' : 'parsed',
      rowCount: persistedRows.length,
      projectCount: usedProjectIds.size,
      invoiceCount: createdInvoices.length,
      errorMessage: warnings.size ? Array.from(warnings).join(' | ') : undefined,
    })

    return {
      batch: { ...batch, status: createdInvoices.length > 0 ? 'drafts_created' : 'parsed' },
      invoices: createdInvoices,
      rows: persistedRows,
      warnings: Array.from(warnings),
      reused: false,
    }
  } catch (error) {
    await updateTimesheetImportBatch(batch.id, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Unknown import error',
    })
    throw error
  }
}
