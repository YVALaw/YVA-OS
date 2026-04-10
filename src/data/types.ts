export type Attachment = {
  id: string
  name: string
  mimeType: string
  size: number
  dataUrl: string
  storageUrl?: string   // Supabase Storage public URL (set when uploaded via Storage)
  storagePath?: string  // Supabase Storage path used for deletion
  uploadedAt: number
}

export type Employee = {
  id: string
  name: string
  employeeNumber?: string
  email?: string
  phone?: string
  payRate?: string | number
  defaultShiftStart?: string
  defaultShiftEnd?: string
  premiumEnabled?: boolean
  premiumStartTime?: string
  premiumPercent?: string | number
  role?: string
  employmentType?: string
  location?: string
  timezone?: string
  startYear?: number | string
  status?: string
  notes?: string
  photoUrl?: string
  attachments?: Attachment[]
}

export type Client = {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  address?: string
  timezone?: string
  defaultRate?: string | number
  paymentTerms?: string
  tags?: string
  notes?: string
  status?: string
  contractEnd?: string
  photoUrl?: string
  links?: { label: string; url: string }[]
}

export type Project = {
  id: string
  name: string
  rate?: string | number
  budget?: number
  clientId?: string | null
  employeeIds?: string[]
  nextInvoiceSeq?: number
  status?: string
  billingModel?: string
  startDate?: string
  endDate?: string
  description?: string
  projectNeeds?: string
  notes?: string
  links?: { label: string; url: string }[]
}

export type Expense = {
  id: string
  projectId: string
  description: string
  amount: number
  date: string
  category?: string
  recurring?: boolean
  createdAt: number
}

export type InvoiceItem = {
  employeeId?: string
  employeeName: string
  position?: string
  hoursTotal: number
  rate: number
  billAmount?: number
  shiftStart?: string
  shiftEnd?: string
  regularHours?: number
  premiumHours?: number
  basePayRate?: number
  premiumPercent?: number
  totalPay?: number
  timeEntries?: InvoiceTimeEntry[]
  daily?: Record<string, string>
}

export type InvoiceTimeEntry = {
  date: string
  startTime?: string
  endTime?: string
  hours: number
  note?: string
}

export type EmployeePaymentRecord = {
  status: 'paid' | 'pending'
  paidDate?: string
  amount?: number
  notes?: string
}

export type Invoice = {
  id: string
  number: string
  date?: string
  dueDate?: string
  clientName?: string
  clientEmail?: string
  clientAddress?: string
  billingStart?: string
  billingEnd?: string
  projectId?: string | null
  projectName?: string
  status?: string
  subtotal?: number
  amountPaid?: number
  notes?: string
  items?: InvoiceItem[]
  statusHistory?: { status: string; changedAt: number }[]
  employeePayments?: Record<string, EmployeePaymentRecord>
  createdAt?: number
  updatedAt?: number
}

export type ActivityLogEntry = {
  id: string
  clientId: string
  note: string
  createdAt: number
}

export type InvoiceTemplate = {
  id: string
  name: string
  clientId?: string
  projectId?: string
  billingStart?: string
  billingEnd?: string
  notes?: string
  rows: {
    employeeId?: string
    employeeName: string
    position: string
    rate: string
    hoursManual: string
    shiftStart?: string
    shiftEnd?: string
    daily: Record<string, string>
  }[]
  createdAt: number
}

export type DataSnapshot = {
  employees: Employee[]
  projects: Project[]
  clients: Client[]
  invoices: Invoice[]
  invoiceCounter: number
}

export type CandidateStage =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'

export type Candidate = {
  id: string
  name: string
  email?: string
  phone?: string
  role?: string
  source?: string
  stage: CandidateStage
  notes?: string
  resumeUrl?: string
  linkedinUrl?: string
  appliedAt?: string
  updatedAt?: number
  attachments?: Attachment[]
}

export type AppSettings = {
  usdToDop: number
  companyEmail?: string
  companyName?: string
  companyAddress?: string
  companyPhone?: string
  emailSignature?: string
  reminderDay?: number  // 0=Sun … 6=Sat, undefined=off
  reminderLastFired?: string  // ISO date string YYYY-MM-DD
  monthlyGoal?: number
  invoiceEmailTemplate?: string
  statementEmailTemplate?: string
  reminderEmailTemplate?: string
  // Gmail OAuth integration
  gmailClientId?: string
  timesheetAutomationEnabled?: boolean
  timesheetNotifyEmail?: string
  timesheetReminderEnabled?: boolean
  timesheetReminderDay?: number
  timesheetReminderHour?: number
  timesheetReminderMinute?: number
  timesheetReminderLastSentAt?: string
}

export type TimesheetImportStatus = 'received' | 'parsed' | 'drafts_created' | 'ready' | 'error' | 'processed'

export type TimesheetImportBatch = {
  id: string
  userId?: string
  source: string
  sourceFilename?: string
  sourceHash: string
  dedupeKey: string
  billingWeekStart: string
  billingWeekEnd: string
  rawCsv: string
  rawPayload?: Record<string, unknown>
  status: TimesheetImportStatus | string
  rowCount: number
  projectCount: number
  invoiceCount: number
  errorMessage?: string
  createdAt?: number | string
  updatedAt?: number | string
}

export type TimesheetImportRow = {
  id: string
  userId?: string
  batchId: string
  rowIndex: number
  rawEmployeeName: string
  rawProjectName: string
  employeeId?: string | null
  projectId?: string | null
  workDate: string
  startTime?: string
  endTime?: string
  hours: number
  rate?: number | null
  amount?: number | null
  notes?: string
  matchStatus: 'matched' | 'unmatched' | 'manual' | 'error' | string
  matchReason?: string
  createdAt?: number | string
}

export type TimesheetMapping = {
  id: string
  userId?: string
  sourceKind: 'employee' | 'project'
  sourceValue: string
  employeeId?: string | null
  projectId?: string | null
  createdAt?: number | string
}

export type TimesheetBatchInvoice = {
  id: string
  userId?: string
  batchId: string
  projectId: string
  invoiceId?: string | null
  invoiceNumber?: string
  invoiceStatus: string
  createdAt?: number | string
}

export type TaskStatus = 'todo' | 'in-progress' | 'done'

export type Task = {
  id: string
  projectId: string
  title: string
  description?: string
  status: TaskStatus
  assigneeName?: string
  dueDate?: string
  createdAt?: number
}
