import { supabase } from '../lib/supabase'
import type {
  ActivityLogEntry, AppSettings, Candidate, DataSnapshot,
  Employee, Client, Expense, Invoice, InvoiceTemplate, Project, Task,
} from '../data/types'

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
  if (error) { console.error(`fetchAll(${table})`, error); return [] }
  return (data || []).map(row => toCamel<T>(row as Record<string, unknown>))
}

/** Upsert all rows and delete rows whose IDs are no longer present */
async function syncAll<T extends { id: string }>(
  table: string,
  items: T[]
): Promise<void> {
  // Fetch existing IDs
  const { data: existing } = await supabase.from(table).select('id')
  const existingIds: string[] = (existing || []).map((r: { id: string }) => r.id)
  const newIds = new Set(items.map(i => i.id))

  // Delete removed rows
  const toDelete = existingIds.filter(id => !newIds.has(id))
  if (toDelete.length > 0) {
    await supabase.from(table).delete().in('id', toDelete)
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
    if (error) console.error(`syncAll(${table})`, error)
  }
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
  if (error) { console.error('loadInvoices', error); return [] }
  return (data || []).map(row => toCamel<Invoice>(row as Record<string, unknown>))
}
export async function saveInvoices(invoices: Invoice[]): Promise<void> {
  invalidateSnapshotCache(); return syncAll('invoices', invoices)
}

// ─── Candidates ───────────────────────────────────────────────────────────────

export async function loadCandidates(): Promise<Candidate[]> {
  return fetchAll<Candidate>('candidates')
}
export async function saveCandidates(candidates: Candidate[]): Promise<void> {
  return syncAll('candidates', candidates)
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
  if (error) { console.error('loadGeneralExpenses', error); return [] }
  return (data || []).map(row => toCamel<Expense>(row as Record<string, unknown>))
}
export async function saveGeneralExpenses(expenses: Expense[]): Promise<void> {
  return syncAll('expenses', expenses)
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
  const { data } = await supabase.from('counters').select('value').eq('key', 'invoice').single()
  return (data as { value: number } | null)?.value ?? 1
}
export async function saveInvoiceCounter(n: number): Promise<void> {
  await supabase.from('counters').update({ value: n }).eq('key', 'invoice')
}

export async function loadEmployeeCounter(): Promise<number> {
  const { data } = await supabase.from('counters').select('value').eq('key', 'employee').single()
  return (data as { value: number } | null)?.value ?? 1
}
export async function saveEmployeeCounter(n: number): Promise<void> {
  await supabase.from('counters').update({ value: n }).eq('key', 'employee')
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  usdToDop: 0,
  companyName: 'YVA Staffing',
  companyEmail: '',
  emailSignature: '',
}

export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
  if (error || !data) return DEFAULT_SETTINGS
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
    gmailClientSecret:      (row.gmail_client_secret as string | undefined),
    gmailAccessToken:       (row.gmail_access_token as string | undefined),
    gmailRefreshToken:      (row.gmail_refresh_token as string | undefined),
    gmailTokenExpiry:       row.gmail_token_expiry != null ? (row.gmail_token_expiry as number) : undefined,
    gmailEmail:             (row.gmail_email as string | undefined),
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
    gmail_client_secret:      s.gmailClientSecret ?? null,
    gmail_access_token:       s.gmailAccessToken ?? null,
    gmail_refresh_token:      s.gmailRefreshToken ?? null,
    gmail_token_expiry:       s.gmailTokenExpiry ?? null,
    gmail_email:              s.gmailEmail ?? null,
  }).eq('id', 1)
  if (error) console.error('saveSettings', error)
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
  const { data } = await supabase.from('user_roles').select('*').order('email')
  return (data || []) as UserRoleRow[]
}

export async function upsertUserRole(userId: string, email: string, role: string): Promise<void> {
  await supabase.from('user_roles').update({ role }).eq('user_id', userId)
}
