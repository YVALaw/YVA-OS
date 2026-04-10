import { supabase } from '../lib/supabase'
import type {
  ActivityLogEntry, AppSettings, Candidate, DataSnapshot,
  Employee, Client, Expense, Invoice, InvoiceTemplate, Project, Task,
  TimesheetBatchInvoice, TimesheetImportBatch, TimesheetImportRow, TimesheetMapping,
} from '../data/types'

function formatSupabaseError(action: string, table: string, error: { message?: string; details?: string; hint?: string; code?: string }): Error {
  const parts = [error.message, error.details, error.hint].filter(Boolean)
  const suffix = error.code ? ` (code ${error.code})` : ''
  return new Error(`${action} ${table} failed${suffix}: ${parts.join(' | ') || 'Unknown Supabase error'}`)
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

/** snake_case DB row → camelCase TS object (top-level keys only; JSONB values untouched) */
function toCamel<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ])
  ) as T
}

/** camelCase TS object → snake_case DB row */
function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`),
      v,
    ])
  )
}

async function fetchAll<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*').order('created_at')
  if (error) throw formatSupabaseError('Load from', table, error)
  return (data || []).map(row => toCamel<T>(row as Record<string, unknown>))
}

/** Upsert all rows and delete rows whose IDs are no longer present */
async function syncAll<T extends { id: string }>(
  table: string,
  items: T[]
): Promise<void> {
  // Fetch existing IDs
  const { data: existing, error: existingError } = await supabase.from(table).select('id')
  if (existingError) throw formatSupabaseError('Load existing rows from', table, existingError)
  const existingIds: string[] = (existing || []).map((r: { id: string }) => r.id)
  const newIds = new Set(items.map(i => i.id))

  // Delete removed rows
  const toDelete = existingIds.filter(id => !newIds.has(id))
  if (toDelete.length > 0) {
    const { error } = await supabase.from(table).delete().in('id', toDelete)
    if (error) throw formatSupabaseError('Delete from', table, error)
  }

  // Upsert current rows
  if (items.length > 0) {
    const rows = items.map(i => {
      const row = toSnake(i as unknown as Record<string, unknown>)
      delete row['created_at']  // let DB manage this column
      // Convert empty strings to null for all values (numeric columns reject "")
      for (const key of Object.keys(row)) {
        if (row[key] === '') row[key] = null
      }
      return row
    })
    const { error } = await supabase.from(table).upsert(rows)
    if (error) throw formatSupabaseError('Save to', table, error)
  }
}

async function insertMany<T extends Record<string, unknown>>(table: string, items: T[]): Promise<void> {
  if (items.length === 0) return
  const rows = items.map(item => {
    const row = toSnake(item as Record<string, unknown>)
    delete row['created_at']
    for (const key of Object.keys(row)) {
      if (row[key] === '') row[key] = null
    }
    return row
  })
  const { error } = await supabase.from(table).insert(rows)
  if (error) throw formatSupabaseError('Insert into', table, error)
}

// ─── Employees ────────────────────────────────────────────────────────────────

export async function loadEmployees(): Promise<Employee[]> {
  return fetchAll<Employee>('employees')
}
export async function saveEmployees(employees: Employee[]): Promise<void> {
  invalidateSnapshotCache(); return syncAll('employees', employees)
}

// ─── Clients ──────────────────────────────────────────────────────────────────

export async function loadClients(): Promise<Client[]> {
  return fetchAll<Client>('clients')
}
export async function saveClients(clients: Client[]): Promise<void> {
  invalidateSnapshotCache(); return syncAll('clients', clients)
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function loadProjects(): Promise<Project[]> {
  return fetchAll<Project>('projects')
}
export async function saveProjects(projects: Project[]): Promise<void> {
  invalidateSnapshotCache(); return syncAll('projects', projects)
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function loadInvoices(): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw formatSupabaseError('Load from', 'invoices', error)
  return (data || []).map(row => toCamel<Invoice>(row as Record<string, unknown>))
}
export async function saveInvoices(invoices: Invoice[]): Promise<void> {
  invalidateSnapshotCache()
  const normalized = invoices.map(invoice => ({
    ...invoice,
    employeePayments: invoice.employeePayments ?? {},
  }))
  return syncAll('invoices', normalized)
}

// ─── Candidates ───────────────────────────────────────────────────────────────

export async function loadCandidates(): Promise<Candidate[]> {
  return fetchAll<Candidate>('candidates')
}
export async function saveCandidates(candidates: Candidate[]): Promise<void> {
  return syncAll('candidates', candidates)
}

// ─── Timesheet Automation ────────────────────────────────────────────────────

export async function loadTimesheetImportBatches(limit = 25): Promise<TimesheetImportBatch[]> {
  const { data, error } = await supabase
    .from('timesheet_import_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw formatSupabaseError('Load from', 'timesheet_import_batches', error)
  return (data || []).map(row => toCamel<TimesheetImportBatch>(row as Record<string, unknown>))
}

export async function loadTimesheetImportRows(batchId: string): Promise<TimesheetImportRow[]> {
  const { data, error } = await supabase
    .from('timesheet_import_rows')
    .select('*')
    .eq('batch_id', batchId)
    .order('row_index', { ascending: true })
  if (error) throw formatSupabaseError('Load from', 'timesheet_import_rows', error)
  return (data || []).map(row => toCamel<TimesheetImportRow>(row as Record<string, unknown>))
}

export async function loadTimesheetBatchInvoices(batchId: string): Promise<TimesheetBatchInvoice[]> {
  const { data, error } = await supabase
    .from('timesheet_batch_invoices')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })
  if (error) throw formatSupabaseError('Load from', 'timesheet_batch_invoices', error)
  return (data || []).map(row => toCamel<TimesheetBatchInvoice>(row as Record<string, unknown>))
}

export async function loadTimesheetMappings(): Promise<TimesheetMapping[]> {
  const { data, error } = await supabase
    .from('timesheet_mappings')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw formatSupabaseError('Load from', 'timesheet_mappings', error)
  return (data || []).map(row => toCamel<TimesheetMapping>(row as Record<string, unknown>))
}

export async function findTimesheetImportBatchByDedupeKey(dedupeKey: string): Promise<TimesheetImportBatch | null> {
  const { data, error } = await supabase
    .from('timesheet_import_batches')
    .select('*')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (error) throw formatSupabaseError('Load from', 'timesheet_import_batches', error)
  return data ? toCamel<TimesheetImportBatch>(data as Record<string, unknown>) : null
}

export async function createTimesheetImportBatch(batch: Omit<TimesheetImportBatch, 'id' | 'createdAt' | 'updatedAt'>): Promise<TimesheetImportBatch> {
  const { data, error } = await supabase
    .from('timesheet_import_batches')
    .insert(toSnake(batch as Record<string, unknown>))
    .select('*')
    .single()
  if (error) throw formatSupabaseError('Save to', 'timesheet_import_batches', error)
  return toCamel<TimesheetImportBatch>(data as Record<string, unknown>)
}

export async function updateTimesheetImportBatch(id: string, patch: Partial<TimesheetImportBatch>): Promise<void> {
  const { error } = await supabase
    .from('timesheet_import_batches')
    .update(toSnake(patch as Record<string, unknown>))
    .eq('id', id)
  if (error) throw formatSupabaseError('Save to', 'timesheet_import_batches', error)
}

export async function saveTimesheetImportRows(rows: TimesheetImportRow[]): Promise<void> {
  await insertMany('timesheet_import_rows', rows)
}

export async function saveTimesheetBatchInvoices(rows: TimesheetBatchInvoice[]): Promise<void> {
  await insertMany('timesheet_batch_invoices', rows)
}

export async function saveTimesheetMappings(mappings: TimesheetMapping[]): Promise<void> {
  if (mappings.length === 0) return
  const rows = mappings.map(mapping => {
    const row = toSnake(mapping as unknown as Record<string, unknown>)
    delete row['created_at']
    for (const key of Object.keys(row)) {
      if (row[key] === '') row[key] = null
    }
    return row
  })
  const { error } = await supabase
    .from('timesheet_mappings')
    .upsert(rows, { onConflict: 'user_id,source_kind,source_value' })
  if (error) throw formatSupabaseError('Save to', 'timesheet_mappings', error)
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function loadTasks(): Promise<Task[]> {
  return fetchAll<Task>('tasks')
}
export async function saveTasks(tasks: Task[]): Promise<void> {
  return syncAll('tasks', tasks)
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export async function loadExpenses(): Promise<Expense[]> {
  return fetchAll<Expense>('expenses')
}
export async function saveExpenses(expenses: Expense[]): Promise<void> {
  return syncAll('expenses', expenses)
}

export async function loadGeneralExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .is('project_id', null)
    .order('created_at')
  if (error) throw formatSupabaseError('Load from', 'expenses', error)
  return (data || []).map(row => toCamel<Expense>(row as Record<string, unknown>))
}
export async function saveGeneralExpenses(expenses: Expense[]): Promise<void> {
  const normalized = expenses.map(expense => ({
    ...expense,
    projectId: '',
  }))

  const { data: existing, error: existingError } = await supabase
    .from('expenses')
    .select('id')
    .is('project_id', null)

  if (existingError) throw formatSupabaseError('Load existing rows from', 'expenses', existingError)

  const existingIds: string[] = (existing || []).map((r: { id: string }) => r.id)
  const nextIds = new Set(normalized.map(expense => expense.id))
  const toDelete = existingIds.filter(id => !nextIds.has(id))

  if (toDelete.length > 0) {
    const { error } = await supabase.from('expenses').delete().in('id', toDelete)
    if (error) throw formatSupabaseError('Delete from', 'expenses', error)
  }

  if (normalized.length === 0) return

  const rows = normalized.map(expense => {
    const row = toSnake(expense as unknown as Record<string, unknown>)
    delete row['created_at']
    row['project_id'] = null
    for (const key of Object.keys(row)) {
      if (row[key] === '') row[key] = null
    }
    return row
  })

  const { error } = await supabase.from('expenses').upsert(rows)
  if (error) throw formatSupabaseError('Save to', 'expenses', error)
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export async function loadActivityLog(): Promise<ActivityLogEntry[]> {
  return fetchAll<ActivityLogEntry>('activity_log')
}
export async function saveActivityLog(entries: ActivityLogEntry[]): Promise<void> {
  return syncAll('activity_log', entries)
}

// ─── Invoice Templates ────────────────────────────────────────────────────────

export async function loadInvoiceTemplates(): Promise<InvoiceTemplate[]> {
  return fetchAll<InvoiceTemplate>('invoice_templates')
}
export async function saveInvoiceTemplates(templates: InvoiceTemplate[]): Promise<void> {
  return syncAll('invoice_templates', templates)
}

// ─── Counters ─────────────────────────────────────────────────────────────────

export async function loadInvoiceCounter(): Promise<number> {
  const { data, error } = await supabase.from('counters').select('value').eq('key', 'invoice').single()
  if (error) throw formatSupabaseError('Load from', 'counters', error)
  return (data as { value: number } | null)?.value ?? 1
}
export async function saveInvoiceCounter(n: number): Promise<void> {
  const { error } = await supabase.from('counters').update({ value: n }).eq('key', 'invoice')
  if (error) throw formatSupabaseError('Save to', 'counters', error)
}

export async function loadEmployeeCounter(): Promise<number> {
  const { data, error } = await supabase.from('counters').select('value').eq('key', 'employee').single()
  if (error) throw formatSupabaseError('Load from', 'counters', error)
  return (data as { value: number } | null)?.value ?? 1
}
export async function saveEmployeeCounter(n: number): Promise<void> {
  const { error } = await supabase.from('counters').update({ value: n }).eq('key', 'employee')
  if (error) throw formatSupabaseError('Save to', 'counters', error)
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  usdToDop: 0,
  companyName: 'YVA Staffing',
  companyEmail: '',
  emailSignature: '',
  timesheetAutomationEnabled: false,
  timesheetNotifyEmail: '',
  timesheetReminderEnabled: false,
  timesheetReminderDay: 1,
  timesheetReminderHour: 9,
  timesheetReminderMinute: 0,
}

export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
  if (error) throw formatSupabaseError('Load from', 'settings', error)
  if (!data) return DEFAULT_SETTINGS
  const row = data as Record<string, unknown>
  return {
    usdToDop:               (row.usd_to_dop as number) ?? 0,
    companyName:            (row.company_name as string) ?? 'YVA Staffing',
    companyEmail:           (row.company_email as string) ?? '',
    companyAddress:         (row.company_address as string | undefined),
    companyPhone:           (row.company_phone as string | undefined),
    emailSignature:         (row.email_signature as string) ?? '',
    reminderDay:            row.reminder_day != null ? (row.reminder_day as number) : undefined,
    reminderLastFired:      (row.reminder_last_fired as string | undefined),
    monthlyGoal:            row.monthly_goal != null ? (row.monthly_goal as number) : undefined,
    invoiceEmailTemplate:   (row.invoice_email_template as string | undefined),
    statementEmailTemplate: (row.statement_email_template as string | undefined),
    reminderEmailTemplate:  (row.reminder_email_template as string | undefined),
    gmailClientId:          (row.gmail_client_id as string | undefined),
    timesheetAutomationEnabled: (row.timesheet_automation_enabled as boolean | undefined) ?? false,
    timesheetNotifyEmail:    (row.timesheet_notify_email as string | undefined) ?? '',
    timesheetReminderEnabled: (row.timesheet_reminder_enabled as boolean | undefined) ?? false,
    timesheetReminderDay: row.timesheet_reminder_day != null ? (row.timesheet_reminder_day as number) : 1,
    timesheetReminderHour: row.timesheet_reminder_hour != null ? (row.timesheet_reminder_hour as number) : 9,
    timesheetReminderMinute: row.timesheet_reminder_minute != null ? (row.timesheet_reminder_minute as number) : 0,
    timesheetReminderLastSentAt: (row.timesheet_reminder_last_sent_at as string | undefined),
  }
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const { error } = await supabase.from('settings').update({
    usd_to_dop:               s.usdToDop,
    company_name:             s.companyName,
    company_email:            s.companyEmail,
    company_address:          s.companyAddress,
    company_phone:            s.companyPhone,
    email_signature:          s.emailSignature,
    reminder_day:             s.reminderDay ?? null,
    reminder_last_fired:      s.reminderLastFired ?? null,
    monthly_goal:             s.monthlyGoal ?? null,
    invoice_email_template:   s.invoiceEmailTemplate ?? null,
    statement_email_template: s.statementEmailTemplate ?? null,
    reminder_email_template:  s.reminderEmailTemplate ?? null,
    gmail_client_id:          s.gmailClientId ?? null,
    timesheet_automation_enabled: s.timesheetAutomationEnabled ?? false,
    timesheet_notify_email:    s.timesheetNotifyEmail ?? null,
    timesheet_reminder_enabled: s.timesheetReminderEnabled ?? false,
    timesheet_reminder_day:     s.timesheetReminderDay ?? 1,
    timesheet_reminder_hour:    s.timesheetReminderHour ?? 9,
    timesheet_reminder_minute:  s.timesheetReminderMinute ?? 0,
    timesheet_reminder_last_sent_at: s.timesheetReminderLastSentAt ?? null,
  }).eq('id', 1)
  if (error) throw formatSupabaseError('Save to', 'settings', error)
}

// ─── Snapshot cache ───────────────────────────────────────────────────────────

let _snapCache: { data: DataSnapshot; at: number } | null = null
const SNAP_TTL = 30_000 // 30 seconds

export function invalidateSnapshotCache() { _snapCache = null }

// ─── Snapshot (loads all core data in parallel) ───────────────────────────────

export async function loadSnapshot(): Promise<DataSnapshot> {
  if (_snapCache && Date.now() - _snapCache.at < SNAP_TTL) return _snapCache.data
  const [employees, projects, clients, invoices, invoiceCounter] = await Promise.all([
    loadEmployees(),
    loadProjects(),
    loadClients(),
    loadInvoices(),
    loadInvoiceCounter(),
  ])
  const data = { employees, projects, clients, invoices, invoiceCounter }
  _snapCache = { data, at: Date.now() }
  return data
}

/** @deprecated — use loadSnapshot() */
export function loadSnapshotFromLocalStorage(): DataSnapshot {
  return { employees: [], projects: [], clients: [], invoices: [], invoiceCounter: 1 }
}

// ─── User Roles ───────────────────────────────────────────────────────────────

export type UserRoleRow = { user_id: string; email: string; role: string }

export async function loadUserRoles(): Promise<UserRoleRow[]> {
  const { data, error } = await supabase.from('user_roles').select('*').order('email')
  if (error) throw formatSupabaseError('Load from', 'user_roles', error)
  return (data || []) as UserRoleRow[]
}

export async function upsertUserRole(userId: string, email: string, role: string): Promise<void> {
  const { error } = await supabase.from('user_roles').update({ role }).eq('user_id', userId)
  if (error) throw formatSupabaseError('Save to', 'user_roles', error)
}
