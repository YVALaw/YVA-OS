import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AppSettings, Client, Employee, Invoice, Project } from '../data/types'
import {
  loadInvoices, saveInvoices,
  loadInvoiceCounter, saveInvoiceCounter,
  loadSnapshot, loadSettings,
} from '../services/storage'
import { formatHourlyRate, formatMoney } from '../utils/money'
import { escapeHtml } from '../utils/html'
import InvoiceBuilder from '../components/InvoiceBuilder'
import { sendEmail, type SendEmailResult } from '../services/gmail'
import { htmlToPdfAttachment } from '../utils/pdf'
import { formatInvoiceHoursEntry, invoiceItemAmount, invoiceItemHours, parseInvoiceHours } from '../utils/invoiceHours'
import { formatTimeEntrySummaryHtml } from '../utils/timesheet'
import { formatEmailList } from '../utils/email'
import { payrollFromInvoiceItem } from '../utils/payroll'
import {
  Avatar,
  Drawer,
  FilterChips,
  ProtoIcon,
  StatusChip,
  ToggleGroup,
  colorFromString,
  daysFromToday,
  dueLabel,
  protoCurrency,
  protoDate,
  protoDateShort,
} from '../components/PrototypeKit'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'partial'

const STATUSES: { key: InvoiceStatus; label: string }[] = [
  { key: 'draft',   label: 'Draft' },
  { key: 'sent',    label: 'Sent' },
  { key: 'viewed',  label: 'Viewed' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid',    label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
]

function uid() { return crypto.randomUUID() }

function parseInvoiceSortValue(value?: string): number {
  if (!value) return 0
  const match = value.match(/(\d+)(?!.*\d)/)
  return match ? parseInt(match[1], 10) : 0
}

function compareInvoicesDesc(a: Invoice, b: Invoice): number {
  const byNumber = parseInvoiceSortValue(b.number) - parseInvoiceSortValue(a.number)
  if (byNumber !== 0) return byNumber

  if ((a.number || '') !== (b.number || '')) {
    return (b.number || '').localeCompare(a.number || '', undefined, { numeric: true, sensitivity: 'base' })
  }

  const aDate = a.createdAt || (a.date ? Date.parse(a.date) : 0) || 0
  const bDate = b.createdAt || (b.date ? Date.parse(b.date) : 0) || 0
  return bDate - aDate
}

function statusBadge(s?: string): string {
  switch ((s || '').toLowerCase()) {
    case 'paid':    return 'badge-green'
    case 'overdue': return 'badge-red'
    case 'sent':    return 'badge-blue'
    case 'viewed':  return 'badge-purple'
    case 'partial': return 'badge-orange'
    default:        return 'badge-gray'
  }
}

function projectPrefix(name?: string): string {
  if (!name) return 'INV'
  const compact = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 4)
    .map(part => part[0]?.toUpperCase() || '')
    .join('')
  return compact || name.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'INV'
}

// ── Shared invoice HTML builder ─────────────────────────────
function buildInvoiceHTML(inv: Invoice, settings: AppSettings, autoPrint = false): string {
  const companyName    = settings.companyName    || 'YVA Staffing'
  const companyAddress = settings.companyAddress || 'Santo Domingo, Dominican Republic'
  const companyEmail   = settings.companyEmail   || 'Contact@yvastaffing.net'
  const companyPhone   = settings.companyPhone   || '+1 (717) 281-8676'

  const dayAbbr = ['Su','Mo','Tu','We','Th','Fr','Sa']
  const hasDailyGrid = (inv.items || []).some(it => it.daily && Object.keys(it.daily).length > 0)
  const allDates: string[] = []
  if (hasDailyGrid && inv.billingStart && inv.billingEnd) {
    const cs = new Date(inv.billingStart + 'T12:00:00')
    const ce = new Date(inv.billingEnd   + 'T12:00:00')
    const cc = new Date(cs)
    while (cc <= ce && allDates.length < 31) { allDates.push(cc.toISOString().slice(0,10)); cc.setDate(cc.getDate()+1) }
  }

  let itemsSection = ''
  if ((inv.items || []).length === 0) {
    itemsSection = `
    <div class="section">
      <div class="label">Amount Due</div>
      <div style="font-size:28px;font-weight:900;color:#f5b533">${formatMoney(Number(inv.subtotal) || 0)}</div>
    </div>`
  } else if (allDates.length > 0) {
    const dateHeaders = allDates.map(d => {
      const dt = new Date(d + 'T12:00:00')
      return '<th style="text-align:center;font-size:9px;padding:6px 2px;min-width:26px">' + dayAbbr[dt.getDay()] + '<br>' + (dt.getMonth()+1) + '/' + dt.getDate() + '</th>'
    }).join('')
      const bodyRows = (inv.items || []).map(it => {
        const dayCells = allDates.map(d => {
          const h = parseInvoiceHours(it.daily?.[d] || '')
          return '<td style="text-align:center;font-size:11px;color:' + (h > 0 ? '#111' : '#ccc') + '">' + (h > 0 ? formatInvoiceHoursEntry(h) : '—') + '</td>'
        }).join('')
        return '<tr><td style="white-space:nowrap"><strong>' + escapeHtml(it.employeeName) + '</strong>' + (it.projectName ? '<br><span style="font-size:10px;color:#666">' + escapeHtml(it.projectName) + '</span>' : '') + (it.position ? '<br><span style="font-size:10px;color:#888">' + escapeHtml(it.position) + '</span>' : '') + (it.timeEntries?.length ? '<div style="font-size:10px;color:#6b7280;line-height:1.45;margin-top:4px;white-space:pre-line">' + formatTimeEntrySummaryHtml(it.timeEntries) + '</div>' : '') + '</td>' + dayCells + '<td style="text-align:right;font-weight:700;white-space:nowrap">' + formatInvoiceHoursEntry(invoiceItemHours(it)) + 'h</td><td style="text-align:right;white-space:nowrap">' + formatHourlyRate(it.rate) + '/hr</td><td style="text-align:right;font-weight:700;white-space:nowrap">$' + invoiceItemAmount(it).toFixed(2) + '</td></tr>'
      }).join('')
    const colSpan = allDates.length + 3
    itemsSection = `
    <div style="overflow-x:auto;margin-top:16px">
    <table style="font-size:12px;width:100%">
      <thead><tr><th style="min-width:140px">Team Member</th>${dateHeaders}<th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${bodyRows}
        <tr class="total-row"><td colspan="${colSpan}">Total Due</td><td style="text-align:right">${formatMoney(Number(inv.subtotal) || 0)}</td></tr>
      </tbody>
    </table>
    </div>`
  } else {
    const bodyRows = (inv.items || []).map(it =>
      '<tr><td><strong>' + escapeHtml(it.employeeName) + '</strong>' + (it.projectName ? '<br><span style="font-size:11px;color:#666">' + escapeHtml(it.projectName) + '</span>' : '') + (it.position ? '<br><span style="font-size:11px;color:#888">' + escapeHtml(it.position) + '</span>' : '') + (it.timeEntries?.length ? '<div style="font-size:10px;color:#6b7280;line-height:1.45;margin-top:4px;white-space:pre-line">' + formatTimeEntrySummaryHtml(it.timeEntries) + '</div>' : '') + '</td><td style="text-align:right">' + formatInvoiceHoursEntry(invoiceItemHours(it)) + 'h</td><td style="text-align:right">' + formatHourlyRate(it.rate) + '/hr</td><td style="text-align:right"><strong>$' + invoiceItemAmount(it).toFixed(2) + '</strong></td></tr>'
      ).join('')
    itemsSection = `
    <table>
      <thead><tr><th>Team Member</th><th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${bodyRows}
        <tr class="total-row"><td colspan="3">Total Due</td><td style="text-align:right">${formatMoney(Number(inv.subtotal) || 0)}</td></tr>
      </tbody>
    </table>`
  }

  return `<!DOCTYPE html><html><head>
    <title>${inv.number}</title>
    <style>
      @page { size: Letter; margin: 0.5in; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; width: 7.5in; min-height: 10in; margin: 0 auto; padding: 26px 30px 30px; color: #111; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
      .logo { height: 52px; }
      .from-info { font-size: 12px; color: #666; line-height: 1.6; margin-top: 8px; }
      .inv-title { font-size: 28px; font-weight: 900; color: #f5b533; }
      .inv-num { font-size: 14px; color: #666; margin-top: 4px; }
      .section { margin-bottom: 24px; }
      .label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #999; margin-bottom: 4px; }
      .value { font-size: 15px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #999; padding: 8px 10px; border-bottom: 2px solid #eee; }
      td { padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
      .total-row { font-size: 16px; font-weight: 800; }
      .total-row td { border-top: 2px solid #111; border-bottom: none; padding-top: 14px; }
      .notes-box { background: #f9f9f9; border-left: 3px solid #f5b533; padding: 12px 16px; margin-top: 24px; font-size: 13px; color: #444; white-space: pre-wrap; }
      .footer { margin-top: 40px; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
      @media print { body { margin: 0 auto; padding: 24px 28px 28px; } }
    </style>
    </head><body>
    <div class="header">
      <div>
        <img src="${window.location.origin}/yva-logo.png" class="logo" onerror="this.style.display='none'" />
        <div class="from-info">
          <div><strong>${escapeHtml(companyName)}</strong></div>
          <div>${escapeHtml(companyAddress)}</div>
          <div>${escapeHtml(companyEmail)}</div>
          <div>${escapeHtml(companyPhone)}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="inv-title">INVOICE</div>
        <div class="inv-num">${escapeHtml(inv.number)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px">
      <div class="section">
        <div class="label">Bill To</div>
        <div class="value">${escapeHtml(inv.clientName) || '—'}</div>
        ${inv.clientEmail ? `<div style="font-size:13px;color:#666">${escapeHtml(inv.clientEmail)}</div>` : ''}
        ${inv.clientAddress ? `<div style="font-size:13px;color:#666;white-space:pre-line">${escapeHtml(inv.clientAddress)}</div>` : ''}
      </div>
      <div class="section">
        <div class="label">Invoice Details</div>
        <div class="value">${inv.date || '—'}</div>
        ${inv.dueDate ? `<div style="font-size:13px;color:#c00"><strong>Due: ${inv.dueDate}</strong></div>` : ''}
        ${inv.billingStart ? `<div style="font-size:13px;color:#666">Period: ${inv.billingStart} – ${inv.billingEnd || ''}</div>` : ''}
        ${inv.projectName ? `<div style="font-size:13px;color:#666">Project: ${escapeHtml(inv.projectName)}</div>` : ''}
      </div>
    </div>
    ${itemsSection}
    ${inv.notes ? `<div class="notes-box">${escapeHtml(inv.notes)}</div>` : ''}
    <div class="footer">${escapeHtml(companyName)} · yvastaffing.net</div>
    ${autoPrint ? '<script>window.onload = function(){ window.print(); }</script>' : ''}
    </body></html>`
}

function printInvoice(inv: Invoice, settings: AppSettings) {
  const html = buildInvoiceHTML(inv, settings, true)
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

// ── Share portal link ──────────────────────────────────────
function shareInvoice(inv: Invoice) {
  const payload = { inv }
  const b64 = btoa(encodeURIComponent(JSON.stringify(payload)))
  const url = `${window.location.origin}/portal#${b64}`
  navigator.clipboard.writeText(url).then(
    () => alert('Portal link copied to clipboard!'),
    () => prompt('Copy this link:', url),
  )
}

const DEFAULT_INVOICE_EMAIL = `Hi {clientName},\n\nPlease find attached invoice {invoiceNumber} for {amount}.\n\nBilling period: {period}\n{dueDate}\nPlease don't hesitate to reach out with any questions.\n\n{companyName}`
const DEFAULT_REMINDER_EMAIL = `Hi {clientName},\n\nThis is a friendly reminder that invoice {invoiceNumber} for {amount} is past due.\n\nOriginal due date: {dueDate}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n{companyName}`

function applyInvoiceTemplate(template: string, inv: Invoice, settings: AppSettings): string {
  const period = `${inv.billingStart || inv.date || '—'} – ${inv.billingEnd || ''}`
  return template
    .replace(/\{clientName\}/g,    inv.clientName || 'Client')
    .replace(/\{invoiceNumber\}/g, inv.number || '')
    .replace(/\{amount\}/g,        formatMoney(Number(inv.subtotal) || 0))
    .replace(/\{dueDate\}/g,       inv.dueDate ? `Due date: ${inv.dueDate}` : '')
    .replace(/\{period\}/g,        period)
    .replace(/\{companyName\}/g,   settings.emailSignature || settings.companyName || 'YVA Staffing')
}

// ── Email invoice ──────────────────────────────────────────
async function emailInvoice(inv: Invoice, settings: AppSettings): Promise<SendEmailResult> {
  const to      = inv.clientEmail || ''
  const subject = `Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body    = applyInvoiceTemplate(settings.invoiceEmailTemplate || DEFAULT_INVOICE_EMAIL, inv, settings)
  const attachment = await htmlToPdfAttachment(`${inv.number || 'invoice'}.pdf`, buildInvoiceHTML(inv, settings, false))
  return sendEmail(to, subject, body, { attachments: [attachment], cc: inv.clientCcEmails || [] })
}

// ── Payment reminder email ──────────────────────────────────
async function reminderEmail(inv: Invoice, settings: AppSettings): Promise<SendEmailResult> {
  const to      = inv.clientEmail || ''
  const subject = `Payment Reminder — Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body    = applyInvoiceTemplate(settings.reminderEmailTemplate || DEFAULT_REMINDER_EMAIL, inv, settings)
  const attachment = await htmlToPdfAttachment(`${inv.number || 'invoice'}.pdf`, buildInvoiceHTML(inv, settings, false))
  return sendEmail(to, subject, body, { attachments: [attachment], cc: inv.clientCcEmails || [] })
}

type QuickForm = {
  clientName: string; date: string; dueDate: string
  subtotal: string; notes: string; status: InvoiceStatus
}

type InvoiceFilter = 'all' | InvoiceStatus

const EMPTY_FORM: QuickForm = {
  clientName: '', date: new Date().toISOString().slice(0, 10),
  dueDate: '', subtotal: '', notes: '', status: 'draft',
}

export default function InvoicePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [invoices,    setInvoices]    = useState<Invoice[]>([])
  const [clients,     setClients]     = useState<Client[]>([])
  const [employees,   setEmployees]   = useState<Employee[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [settings,    setSettings]    = useState<AppSettings>({ usdToDop: 0 })
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderClientId, setBuilderClientId] = useState<string | undefined>()
  const [builderProjectId, setBuilderProjectId] = useState<string | undefined>()
  const [editingInvoice, setEditingInvoice] = useState<Invoice | undefined>()
  const [sendConfirmInv, setSendConfirmInv] = useState<Invoice | null>(null)
  const [quickModal, setQuickModal] = useState(false)
  const [quickProjectId, setQuickProjectId] = useState<string | undefined>()
  const [editId, setEditId] = useState<string | null>(null)
  const [statusMenuOpenId, setStatusMenuOpenId] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState<InvoiceStatus>('draft')
  const [newAmountPaid, setNewAmountPaid] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM)
  const initialParams = new URLSearchParams(location.search)
  const urlQ = initialParams.get('q') || ''
  const initialStatus = initialParams.get('status')
  const [search, setSearch] = useState(urlQ)
  const [statusFilter, setStatusFilter] = useState<InvoiceFilter>(
    initialStatus && STATUSES.some(status => status.key === initialStatus)
      ? initialStatus as InvoiceStatus
      : 'all',
  )
  const [view, setView] = useState<'projects' | 'flat'>('projects')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [openInvId, setOpenInvId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [previewInv, setPreviewInv] = useState<Invoice | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSnapshot().then(snap => {
      setInvoices(snap.invoices)
      setClients(snap.clients)
      setEmployees(snap.employees)
      setAllProjects(snap.projects)
      // If navigated here with ?q=, expand all project groups so the invoice is visible
      if (urlQ) {
        const keys = new Set<string>()
        for (const inv of snap.invoices) keys.add(inv.projectId || inv.projectName || '__unassigned__')
        setExpanded(keys)
      }
    })
    loadSettings().then(setSettings)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nextQuery = params.get('q') || ''
    const nextStatus = params.get('status')
    setSearch(nextQuery)
    setStatusFilter(
      nextStatus && STATUSES.some(status => status.key === nextStatus)
        ? nextStatus as InvoiceStatus
        : 'all',
    )
    if (params.get('new') === '1') {
      setBuilderClientId(params.get('client') || undefined)
      setBuilderOpen(true)
    }
  }, [location.search])

  useEffect(() => {
    if (!invoices.length) return
    const params = new URLSearchParams(location.search)
    const query = params.get('q') || ''
    const editParam = params.get('edit') || ''
    const previewParam = params.get('preview') || ''

    if (query) {
      const match = invoices.find(inv => (inv.number || '').toLowerCase() === query.toLowerCase())
      if (match) setOpenInvId(match.id)
    }
    if (editParam && !builderOpen) {
      const match = invoices.find(inv => inv.id === editParam)
      if (match) openEditInvoice(match)
    }
    if (previewParam && !previewInv) {
      const match = invoices.find(inv => inv.id === previewParam)
      if (match) setPreviewInv(match)
    }
  }, [builderOpen, invoices, location.search, previewInv])

  async function persist(next: Invoice[]): Promise<boolean> {
    try {
      await saveInvoices(next)
      const fresh = await loadInvoices()
      setInvoices(fresh)
      return true
    } catch (error) {
      console.error('persist invoices failed', error)
      showToast(error instanceof Error ? error.message : 'Invoice change failed to save to Supabase')
      return false
    }
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function describeEmailResult(result: SendEmailResult, noun: string, recipient: string): string {
    if (result.mode === 'gmail') return `${noun} sent to ${recipient} with PDF attached`
    const reason = result.fallbackReason ? ` Gmail fallback: ${result.fallbackReason}.` : ''
    return `${noun} draft opened for ${recipient}. PDF downloaded to attach manually.${reason}`
  }

  function invoiceRecipient(inv: Invoice): string {
    return inv.clientCcEmails?.length
      ? `${inv.clientEmail} (cc ${formatEmailList(inv.clientCcEmails)})`
      : inv.clientEmail || ''
  }

  async function handleInvoiceEmail(inv: Invoice, noun = `Invoice ${inv.number}`) {
    if (!inv.clientEmail) return
    const result = await emailInvoice(inv, settings)
    showToast(describeEmailResult(result, noun, invoiceRecipient(inv)))
  }

  async function handleReminderEmail(inv: Invoice) {
    if (!inv.clientEmail) return
    const result = await reminderEmail(inv, settings)
    showToast(describeEmailResult(result, `Reminder for ${inv.number}`, invoiceRecipient(inv)))
  }

  function clearInvoiceUrlParams(keys: string[]) {
    const params = new URLSearchParams(location.search)
    let changed = false
    for (const key of keys) {
      if (params.has(key)) {
        params.delete(key)
        changed = true
      }
    }
    if (changed) {
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: true })
    }
  }

  function closeInvoicePreview() {
    setPreviewInv(null)
    clearInvoiceUrlParams(['preview'])
  }

  function openBuilder(projectId?: string, clientId?: string) { setBuilderProjectId(projectId); setBuilderClientId(clientId); setBuilderOpen(true) }
  function openEditInvoice(inv: Invoice) { setEditingInvoice(inv); setBuilderProjectId(inv.projectId || undefined); setBuilderOpen(true) }
  function startEditInvoice(inv: Invoice) {
    setOpenInvId(null)
    setPreviewInv(null)
    clearInvoiceUrlParams(['preview', 'q'])
    openEditInvoice(inv)
  }
  async function closeBuilder(inv?: Invoice) {
    const fresh = await loadInvoices(true)
    setInvoices(inv && fresh.some(entry => entry.id === inv.id)
      ? fresh.map(entry => entry.id === inv.id ? { ...entry, ...inv } : entry)
      : fresh)
    if (inv) {
      const key = inv.projectId || inv.projectName || '__unassigned__'
      setExpanded(prev => {
        const next = new Set(prev)
        next.add(key)
        return next
      })
      showToast(`Invoice ${inv.number} saved`)
    }
    setBuilderOpen(false)
    setBuilderClientId(undefined)
    setBuilderProjectId(undefined)
    setEditingInvoice(undefined)
    clearInvoiceUrlParams(['edit', 'new'])
    if (inv && inv.status === 'draft') setSendConfirmInv(inv)
  }

  function openQuickForProject(projectId?: string) {
    const proj = allProjects.find(p => p.id === projectId)
    const client = proj ? clients.find(c => c.id === proj.clientId) : undefined
    setForm({
      ...EMPTY_FORM,
      date: new Date().toISOString().slice(0, 10),
      clientName: client?.name || '',
      status: 'draft',
    })
    setQuickProjectId(projectId)
    setQuickModal(true)
  }

  async function saveQuick() {
    if (!form.clientName.trim() || !form.subtotal) return
    const counter = await loadInvoiceCounter()
    const client = clients.find(c => c.name === form.clientName)
    const proj = allProjects.find(p => p.id === quickProjectId)
    const inv: Invoice = {
      id: uid(),
      number: `INV-${String(counter).padStart(3, '0')}`,
      date: form.date,
      dueDate: form.dueDate || undefined,
      clientName: form.clientName,
      clientEmail: client?.email,
      clientCcEmails: client?.ccEmails?.length ? client.ccEmails : undefined,
      projectId: proj?.id || null,
      projectName: proj?.name || undefined,
      subtotal: parseFloat(form.subtotal) || 0,
      notes: form.notes || undefined,
      status: 'sent',
      items: [],
      statusHistory: [{ status: 'sent', changedAt: Date.now() }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const ok = await persist([inv, ...invoices])
    if (!ok) return
    await saveInvoiceCounter(counter + 1)
    const key = inv.projectId || inv.projectName || '__unassigned__'
    setExpanded(prev => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    showToast(`Invoice ${inv.number} saved`)
    setQuickModal(false)
    setQuickProjectId(undefined)
    if (inv.clientEmail) {
      const result = await emailInvoice(inv, settings)
      showToast(describeEmailResult(result, `Invoice ${inv.number}`, invoiceRecipient(inv)))
    }
  }

  function toggleCollapse(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function openStatusEdit(inv: Invoice) {
    if (editId === inv.id) {
      setEditId(null)
      setStatusMenuOpenId(null)
      return
    }
    setEditId(inv.id)
    setStatusMenuOpenId(inv.id)
    setNewStatus((inv.status as InvoiceStatus) || 'draft')
    setNewAmountPaid(inv.amountPaid != null ? String(inv.amountPaid) : '')
  }
  async function applyStatusChange(targetId: string, status: InvoiceStatus, amountPaid?: string): Promise<boolean> {
    const nextInvoices = invoices.map((inv) => {
      if (inv.id !== targetId) return inv
      const histEntry = { status, changedAt: Date.now() }
      const subtotal = Number(inv.subtotal) || 0
      const amtPaid =
        status === 'paid'
          ? subtotal
          : status === 'partial'
            ? Math.min(subtotal, Math.max(0, parseFloat(amountPaid || '') || 0))
            : undefined
      return {
        ...inv, status, amountPaid: amtPaid, updatedAt: Date.now(),
        statusHistory: [...(inv.statusHistory || []), histEntry],
      }
    })
    const ok = await persist(nextInvoices)
    if (ok) {
      const updated = nextInvoices.find(inv => inv.id === targetId)
      if (updated) showToast(status === 'paid' ? `Payment recorded for ${updated.number}` : `Invoice ${updated.number} marked ${status}`)
    }
    setEditId(null)
    setStatusMenuOpenId(null)
    return ok
  }

  function handleInlineStatusSelect(inv: Invoice, nextStatus: InvoiceStatus) {
    setEditId(inv.id)
    setStatusMenuOpenId(null)
    setNewStatus(nextStatus)
    if (nextStatus !== 'partial') {
      void applyStatusChange(inv.id, nextStatus)
    }
  }

  function duplicateInvoice(inv: Invoice) {
    void loadInvoiceCounter().then(counter => {
      const dup: Invoice = {
        ...inv,
        id:        uid(),
        number:    `INV-${String(counter).padStart(3, '0')}`,
        status:    'draft',
        amountPaid: undefined,
        date:      new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      void persist([dup, ...invoices]).then(async ok => {
        if (!ok) return
        await saveInvoiceCounter(counter + 1)
        const key = dup.projectId || dup.projectName || '__unassigned__'
        setExpanded(prev => {
          const next = new Set(prev)
          next.add(key)
          return next
        })
        showToast(`Invoice ${dup.number} saved`)
      })
    })
  }
  function doDelete(id: string) { void persist(invoices.filter((inv) => inv.id !== id)); setConfirmDelete(null) }

  const filtered = invoices.filter((inv) => {
    const matchesSearch = `${inv.number} ${inv.clientName} ${inv.projectName}`.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || (inv.status || 'draft').toLowerCase() === statusFilter
    return matchesSearch && matchesStatus
  })

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; projectId: string | null; invoices: Invoice[] }>()
    for (const inv of filtered) {
      const key = inv.projectId || inv.projectName || '__unassigned__'
      if (!map.has(key)) {
        const proj = allProjects.find(p => p.id === inv.projectId || p.name === inv.projectName)
        map.set(key, { label: proj?.name || inv.projectName || 'Unassigned', projectId: proj?.id || null, invoices: [] })
      }
      map.get(key)!.invoices.push(inv)
    }

    for (const value of map.values()) {
      value.invoices.sort(compareInvoicesDesc)
    }

    return Array.from(map.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => {
        if (a.key === '__unassigned__') return 1
        if (b.key === '__unassigned__') return -1
        return a.label.localeCompare(b.label)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.map(i=>i.id+i.status).join(), allProjects.map(p=>p.id).join()])

  const totalBilled = invoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
  const unpaidCount = invoices.filter(i => ['sent', 'overdue', 'partial'].includes((i.status || '').toLowerCase())).length
  const draftCount = invoices.filter(i => (i.status || '').toLowerCase() === 'draft').length
  const overdueCount = invoices.filter(i => (i.status || '').toLowerCase() === 'overdue').length
  const outstandingBalance = invoices
    .filter(i => !['paid', 'draft'].includes((i.status || 'draft').toLowerCase()))
    .reduce((sum, inv) => sum + Math.max(0, (Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)), 0)
  const overdueBalance = invoices
    .filter(i => (i.status || '').toLowerCase() === 'overdue')
    .reduce((sum, inv) => sum + Math.max(0, (Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)), 0)
  const paidCount = invoices.filter(i => (i.status || '').toLowerCase() === 'paid').length
  const statusCounts: Record<InvoiceFilter, number> = {
    all: invoices.length,
    draft: draftCount,
    sent: invoices.filter(i => (i.status || '').toLowerCase() === 'sent').length,
    viewed: invoices.filter(i => (i.status || '').toLowerCase() === 'viewed').length,
    partial: invoices.filter(i => (i.status || '').toLowerCase() === 'partial').length,
    overdue: overdueCount,
    paid: paidCount,
  }
  const totalFiltered = filtered.reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
  const openInvoice = openInvId ? invoices.find(invoice => invoice.id === openInvId) || null : null
  const toggleSelected = (id: string) => {
    setSelectedIds(current => current.includes(id) ? current.filter(entry => entry !== id) : [...current, id])
  }

  function exportFilteredCsv() {
    const rows = [
      ['invoice_number', 'client', 'project', 'date', 'due_date', 'status', 'subtotal', 'amount_paid'],
      ...filtered.map(invoice => [
        invoice.number,
        invoice.clientName || '',
        invoice.projectName || '',
        invoice.date || '',
        invoice.dueDate || '',
        invoice.status || 'draft',
        String(Number(invoice.subtotal) || 0),
        String(Number(invoice.amountPaid) || 0),
      ]),
    ]
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function sendSelectedInvoices() {
    const selected = invoices.filter(invoice => selectedIds.includes(invoice.id) && invoice.clientEmail)
    for (const invoice of selected) await handleInvoiceEmail(invoice)
    if (!selected.length) showToast('No selected invoices with client email')
  }

  async function downloadSelectedInvoices() {
    const selected = invoices.filter(invoice => selectedIds.includes(invoice.id))
    if (!selected.length) {
      showToast('No invoices selected')
      return
    }
    selected.forEach(invoice => printInvoice(invoice, settings))
    showToast(`Opened ${selected.length} invoice PDF${selected.length === 1 ? '' : 's'}`)
  }

  async function deleteSelectedInvoices() {
    if (!selectedIds.length) return
    const ok = await persist(invoices.filter(invoice => !selectedIds.includes(invoice.id)))
    if (!ok) return
    showToast(`Deleted ${selectedIds.length} invoice${selectedIds.length === 1 ? '' : 's'}`)
    setSelectedIds([])
  }

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row">
          <div>
            <div className="proto-eyebrow" style={{ color: 'var(--gold)', marginBottom: 8 }}>Operate · Billing</div>
            <h1 className="page-title">Invoices</h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6, fontWeight: 500 }}>
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>{unpaidCount}</span> unpaid · {protoCurrency(outstandingBalance)} outstanding · {overdueCount} overdue
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="proto-btn" onClick={exportFilteredCsv}>
              <ProtoIcon name="download" size={13} />
              Export CSV
            </button>
            <button type="button" className="proto-btn" onClick={() => openQuickForProject(undefined)}>
              <ProtoIcon name="plus" size={13} />
              QUICK INVOICE
            </button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={() => openBuilder()}>
              <ProtoIcon name="plus" size={13} />
              NEW INVOICE
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <FilterChips
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ id: 'all', label: 'All', count: statusCounts.all }, ...STATUSES.map(status => ({
              id: status.key,
              label: status.label === 'Draft' ? 'Drafts' : status.label,
              count: statusCounts[status.key],
            }))]}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#11141d', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', minWidth: 240 }}>
              <ProtoIcon name="search" size={13} style={{ color: 'var(--muted)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter…"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12, padding: '4px 0' }}
              />
              {search ? (
                <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => setSearch('')}>
                  <ProtoIcon name="close" size={11} />
                </button>
              ) : null}
            </div>
            <ToggleGroup
              value={view}
              onChange={setView}
              options={[
                { id: 'projects', label: 'By Project' },
                { id: 'flat', label: 'List' },
              ]}
            />
          </div>
        </div>

        {selectedIds.length > 0 ? (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(34,211,238,0.16)', border: '1px solid var(--gold)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--goldl)' }}>{selectedIds.length} selected</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="proto-btn" onClick={() => { void sendSelectedInvoices() }}>
              <ProtoIcon name="send" size={12} />
              Send selected
            </button>
            <button type="button" className="proto-btn" onClick={() => { void downloadSelectedInvoices() }}>
              <ProtoIcon name="download" size={12} />
              Download PDFs
            </button>
            <button type="button" className="proto-btn proto-btn-danger" onClick={() => { void deleteSelectedInvoices() }}>
              <ProtoIcon name="trash" size={12} />
              Delete
            </button>
            <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => setSelectedIds([])}>
              <ProtoIcon name="close" size={12} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="proto-page-body">
        {view === 'projects' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groups.length === 0 ? (
              <div className="proto-empty">No invoices match this filter.</div>
            ) : groups.map(({ key, label, projectId: pId, invoices: groupInvs }) => {
              const isOpen = expanded.has(key)
              const groupProject = allProjects.find(project => project.id === pId || project.name === label)
              const client = clients.find(entry => entry.id === groupProject?.clientId) || clients.find(entry => entry.name === groupInvs[0]?.clientName)
              const groupTotal = groupInvs.reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
              const groupOutstanding = groupInvs
                .filter(invoice => (invoice.status || '').toLowerCase() !== 'paid')
                .reduce((sum, invoice) => sum + Math.max(0, (Number(invoice.subtotal) || 0) - (Number(invoice.amountPaid) || 0)), 0)
              return (
                <div key={key} className="card" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '12px 14px', borderBottom: isOpen ? '1px solid var(--border)' : 'none', display: 'grid', gridTemplateColumns: '20px 36px minmax(0, 1fr) auto auto auto', alignItems: 'center', gap: 14 }}>
                    <button type="button" className="proto-btn proto-btn-icon proto-btn-ghost" onClick={() => toggleCollapse(key)} style={{ width: 20, height: 20, padding: 0 }}>
                      <ProtoIcon name={isOpen ? 'chevronD' : 'chevronR'} size={12} />
                    </button>
                    <Avatar name={client?.name || groupInvs[0]?.clientName} color={colorFromString(client?.name || groupInvs[0]?.clientName || label)} size="md" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button type="button" className="proto-link-button" onClick={() => setOpenInvId(groupInvs[0]?.id || null)} style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.005em' }}>
                          {label}
                        </button>
                        <span className="proto-mono" style={{ fontSize: 10, padding: '2px 6px', background: '#181c28', color: 'var(--gold)', borderRadius: 3, fontWeight: 700 }}>{projectPrefix(label)}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                        {client?.company || client?.name || groupInvs[0]?.clientName || 'Unassigned'} · {groupInvs.length} invoice{groupInvs.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="proto-eyebrow">Outstanding</div>
                      <div className="proto-mono" style={{ fontSize: 14, fontWeight: 800, color: groupOutstanding > 0 ? '#f87171' : 'var(--dim)' }}>{protoCurrency(groupOutstanding)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="proto-eyebrow">Total</div>
                      <div className="proto-mono" style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{protoCurrency(groupTotal)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="proto-btn proto-btn-ghost" onClick={() => openQuickForProject(pId || undefined)}>+ Quick</button>
                      <button type="button" className="proto-btn proto-btn-ghost" onClick={() => openBuilder(pId || undefined)}>+ Invoice</button>
                    </div>
                  </div>
                  {isOpen ? (
                    <table className="proto-table proto-mono" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 36 }} />
                          <th>Invoice</th>
                          <th>Issued</th>
                          <th>Due</th>
                          <th>Hours</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th>Status</th>
                          <th style={{ width: 32 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {groupInvs.map(invoice => {
                          const hours = (invoice.items || []).reduce((sum, item) => sum + invoiceItemHours(item), 0)
                          return (
                            <tr key={invoice.id} onClick={() => setOpenInvId(invoice.id)}>
                              <td style={{ width: 36 }}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(invoice.id)}
                                  onChange={() => toggleSelected(invoice.id)}
                                  onClick={(event) => event.stopPropagation()}
                                  style={{ accentColor: 'var(--gold)' }}
                                />
                              </td>
                              <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{invoice.number}</td>
                              <td style={{ color: 'var(--muted)' }}>{protoDateShort(invoice.date)}</td>
                              <td style={{ color: daysFromToday(invoice.dueDate) < 0 && invoice.status !== 'paid' ? '#f87171' : 'var(--muted)' }}>{dueLabel(invoice.dueDate)}</td>
                              <td style={{ color: 'var(--muted)' }}>{hours > 0 ? `${hours}h` : '—'}</td>
                              <td style={{ color: 'var(--text)', textAlign: 'right', fontWeight: 700 }}>{protoCurrency(Number(invoice.subtotal) || 0)}</td>
                              <td>
                                {editId === invoice.id ? (
                                  <div className="invoice-status-edit" onClick={event => event.stopPropagation()}>
                                    <div className="invoice-status-menu">
                                      <button
                                        type="button"
                                        className="invoice-status-trigger invoice-status-button"
                                        onClick={() => setStatusMenuOpenId(current => current === invoice.id ? null : invoice.id)}
                                      >
                                        <StatusChip status={newStatus} />
                                        <ProtoIcon name="chevronD" size={11} />
                                      </button>
                                      {statusMenuOpenId === invoice.id ? (
                                        <div className="invoice-status-menu-list">
                                          {STATUSES.map(status => (
                                            <button
                                              key={status.key}
                                              type="button"
                                              className={`invoice-status-option${newStatus === status.key ? ' active' : ''}`}
                                              onClick={() => handleInlineStatusSelect(invoice, status.key)}
                                            >
                                              <StatusChip status={status.key} />
                                              <span>{status.label}</span>
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                    {newStatus === 'partial' ? (
                                      <>
                                        <input
                                          className="proto-input"
                                          type="number"
                                          placeholder="Amount paid"
                                          value={newAmountPaid}
                                          onChange={event => setNewAmountPaid(event.target.value)}
                                        />
                                        <div style={{ display: 'flex', gap: 6 }}>
                                          <button type="button" className="proto-btn proto-btn-ghost" onClick={() => { setEditId(null); setStatusMenuOpenId(null) }}>Cancel</button>
                                          <button type="button" className="proto-btn proto-btn-primary" onClick={() => void applyStatusChange(invoice.id, 'partial', newAmountPaid)}>Save</button>
                                        </div>
                                      </>
                                    ) : null}
                                  </div>
                                ) : (
                                  <button type="button" className="invoice-status-button" onClick={(event) => { event.stopPropagation(); openStatusEdit(invoice) }}>
                                    <StatusChip status={invoice.status} />
                                  </button>
                                )}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button type="button" className="proto-btn proto-btn-ghost" style={{ height: 28 }} onClick={(event) => { event.stopPropagation(); startEditInvoice(invoice) }}>Edit</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="proto-table proto-mono">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Project</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Hours</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(invoice => {
                  const hours = (invoice.items || []).reduce((sum, item) => sum + invoiceItemHours(item), 0)
                  return (
                    <tr key={invoice.id} onClick={() => setOpenInvId(invoice.id)}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(invoice.id)}
                          onChange={() => toggleSelected(invoice.id)}
                          onClick={(event) => event.stopPropagation()}
                          style={{ accentColor: 'var(--gold)' }}
                        />
                      </td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{invoice.number}</td>
                      <td style={{ color: 'var(--text)', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{invoice.clientName || '—'}</td>
                      <td style={{ color: 'var(--muted)', fontFamily: 'Inter, sans-serif' }}>{invoice.projectName || '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{protoDateShort(invoice.date)}</td>
                      <td style={{ color: daysFromToday(invoice.dueDate) < 0 && invoice.status !== 'paid' ? '#f87171' : 'var(--muted)' }}>{dueLabel(invoice.dueDate)}</td>
                      <td style={{ color: 'var(--muted)' }}>{hours > 0 ? `${hours}h` : '—'}</td>
                      <td style={{ color: 'var(--text)', textAlign: 'right', fontWeight: 700 }}>{protoCurrency(Number(invoice.subtotal) || 0)}</td>
                      <td><StatusChip status={invoice.status} /></td>
                      <td>
                        <button type="button" className="proto-btn proto-btn-ghost" style={{ height: 28 }} onClick={(event) => { event.stopPropagation(); startEditInvoice(invoice) }}>Edit</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 18, padding: '12px 16px', background: '#11141d', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }} className="proto-mono">
          <span style={{ color: 'var(--muted)' }}>Showing <span style={{ color: 'var(--text)', fontWeight: 700 }}>{filtered.length}</span> of {invoices.length} invoices</span>
          <span style={{ color: 'var(--muted)' }}>Total: <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{protoCurrency(totalFiltered)}</span></span>
        </div>
      </div>

      <Drawer open={Boolean(openInvoice)} onClose={() => setOpenInvId(null)} width={680}>
        {openInvoice ? (() => {
          const client = clients.find(entry => entry.name === openInvoice.clientName)
          const project = allProjects.find(entry => entry.id === openInvoice.projectId || entry.name === openInvoice.projectName)
          const lineItems = (openInvoice.items || []).map(item => {
            return {
              employeeId: item.employeeId,
              name: item.employeeName,
              role: item.position || '',
              color: colorFromString(item.employeeName),
              hours: invoiceItemHours(item),
              rate: item.rate,
              amount: invoiceItemAmount(item),
              paid: item.employeeId ? openInvoice.employeePayments?.[item.employeeId]?.status === 'paid' : false,
            }
          })
          const subtotal = Number(openInvoice.subtotal) || 0
          const outstanding = Math.max(0, subtotal - (Number(openInvoice.amountPaid) || 0))
          const employeePayroll = (openInvoice.items || []).reduce((sum, item) => {
            const employee = employees.find(entry =>
              (item.employeeId && entry.id === item.employeeId) ||
              entry.name.toLowerCase() === item.employeeName.toLowerCase(),
            )
            return sum + payrollFromInvoiceItem(item, employee).totalPay
          }, 0)
          const netEarnings = subtotal - employeePayroll
          const primaryAction = {
            label:
              openInvoice.status === 'draft'
                ? 'Send to client'
                : openInvoice.status === 'overdue'
                  ? 'Send reminder'
                  : openInvoice.status === 'paid'
                    ? 'Payment recorded'
                    : 'Record payment',
            icon: openInvoice.status === 'draft' ? 'send' : openInvoice.status === 'overdue' ? 'mail' : 'check',
            disabled: openInvoice.status === 'paid',
            onClick: () => {
              if (openInvoice.status === 'draft') {
                if (openInvoice.clientEmail) void handleInvoiceEmail(openInvoice)
              } else if (openInvoice.status === 'overdue') {
                if (openInvoice.clientEmail) void handleReminderEmail(openInvoice)
              } else if (openInvoice.status !== 'paid') {
                void applyStatusChange(openInvoice.id, 'paid')
              }
            },
          } as const
          return (
            <>
              <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="proto-mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--gold)', letterSpacing: '-0.01em' }}>{openInvoice.number}</span>
                    <StatusChip status={openInvoice.status} filled />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{client?.company || client?.name || openInvoice.clientName} · {project?.name || openInvoice.projectName || 'Unassigned'}</div>
                </div>
                <button type="button" className="proto-btn proto-btn-icon proto-btn-ghost" onClick={() => setOpenInvId(null)}>
                  <ProtoIcon name="close" size={14} />
                </button>
              </div>
              <div style={{ padding: 22, overflow: 'auto', flex: 1 }}>
                <div style={{ background: '#181c28', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 14 }}>
                  <div className="proto-eyebrow" style={{ marginBottom: 8 }}>Amount Due</div>
                  <div className="proto-mono" style={{ fontSize: 38, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {protoCurrency(outstanding)}<span style={{ fontSize: 14, color: 'var(--dim)', marginLeft: 8, fontWeight: 600 }}>USD</span>
                  </div>
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div className="proto-eyebrow" style={{ marginBottom: 4 }}>Employee Pay</div>
                      <div className="proto-mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--muted)' }}>{protoCurrency(employeePayroll)}</div>
                    </div>
                    <div>
                      <div className="proto-eyebrow" style={{ marginBottom: 4 }}>Net Earnings</div>
                      <div className="proto-mono" style={{ fontSize: 16, fontWeight: 800, color: netEarnings >= 0 ? '#22c55e' : '#f87171' }}>{protoCurrency(netEarnings)}</div>
                    </div>
                  </div>
                  {Number(openInvoice.amountPaid) > 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Of {protoCurrency(subtotal)} total · {protoCurrency(Number(openInvoice.amountPaid) || 0)} paid</div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <button type="button" className="proto-btn proto-btn-primary" style={{ flex: 1 }} onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
                      <ProtoIcon name={primaryAction.icon} size={13} />
                      {primaryAction.label}
                    </button>
                    <button type="button" className="proto-btn" onClick={() => startEditInvoice(openInvoice)}>
                      <ProtoIcon name="edit" size={13} />
                      Edit
                    </button>
                    <button type="button" className="proto-btn" onClick={() => setPreviewInv(openInvoice)}>
                      <ProtoIcon name="eye" size={13} />
                      Preview
                    </button>
                    <button type="button" className="proto-btn" onClick={() => printInvoice(openInvoice, settings)}>
                      <ProtoIcon name="download" size={13} />
                      PDF
                    </button>
                  </div>
                </div>

                <div className="proto-detail-grid" style={{ marginBottom: 14 }}>
                  {[
                    { label: 'Bill to', value: client?.company || client?.name || openInvoice.clientName || '—', sub: client?.email || openInvoice.clientEmail || '—' },
                    { label: 'Project', value: project?.name || openInvoice.projectName || 'Unassigned', sub: `${projectPrefix(project?.name || openInvoice.projectName)} · ${project?.rate ? formatHourlyRate(project.rate) : 'Rate TBD'}/hr` },
                    { label: 'Issued', value: protoDate(openInvoice.date), sub: openInvoice.date || 'No issue date' },
                    { label: 'Due', value: protoDate(openInvoice.dueDate), sub: dueLabel(openInvoice.dueDate) },
                  ].map(meta => (
                    <div key={meta.label} className="proto-detail-cell">
                      <div className="proto-eyebrow" style={{ marginBottom: 4 }}>{meta.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{meta.value}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{meta.sub}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <div className="proto-eyebrow">Line Items · {formatInvoiceHoursEntry(lineItems.reduce((sum, line) => sum + line.hours, 0))} billed · {lineItems.length} statements</div>
                    <span style={{ fontSize: 10.5, color: 'var(--dim)' }} className="proto-mono">Each line = 1 statement</span>
                  </div>
                  <div className="card" style={{ overflow: 'hidden' }}>
                    <table className="proto-table proto-mono" style={{ fontSize: 11.5 }}>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th style={{ textAlign: 'right' }}>Hrs</th>
                          <th style={{ textAlign: 'right' }}>Rate</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th>Statement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map(line => (
                          <tr key={`${line.employeeId || line.name}-${line.rate}`} onClick={() => line.employeeId ? navigate(`/employees/${line.employeeId}`) : undefined}>
                            <td style={{ fontFamily: 'Inter, sans-serif' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Avatar name={line.name} color={line.color} size="sm" />
                                <div>
                                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>{line.name}</div>
                                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{line.role}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>{line.hours}</td>
                            <td style={{ textAlign: 'right' }}>{formatHourlyRate(line.rate)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>{protoCurrency(line.amount)}</td>
                            <td><StatusChip status={line.paid ? 'paid' : 'draft'} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: '#181c28' }}>
                          <td colSpan={3} style={{ textAlign: 'right', color: 'var(--muted)', fontWeight: 700 }}>SUBTOTAL</td>
                          <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 800 }}>{protoCurrency(subtotal)}</td>
                          <td />
                        </tr>
                        <tr style={{ background: '#181c28', borderTop: '1px solid var(--border)' }}>
                          <td colSpan={3} style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 800 }}>TOTAL DUE</td>
                          <td style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 800, fontSize: 14 }}>{protoCurrency(outstanding)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div>
                  <div className="proto-eyebrow" style={{ marginBottom: 10 }}>Activity</div>
                  <div className="proto-activity-list">
                    {[
                      { text: `Invoice created · ${(openInvoice.items || []).length} employee statements generated`, when: protoDate(openInvoice.date), icon: 'plus', color: 'var(--gold)' },
                      ...(openInvoice.statusHistory || []).map(entry => ({ text: `Status changed to ${entry.status}`, when: new Date(entry.changedAt).toLocaleString(), icon: entry.status === 'paid' ? 'check' : entry.status === 'overdue' ? 'mail' : 'edit', color: entry.status === 'paid' ? '#10b981' : entry.status === 'overdue' ? '#f87171' : '#60a5fa' })),
                    ].map((entry, index) => (
                      <div key={`${entry.text}-${index}`} className="proto-activity-item">
                        <span className="proto-activity-icon" style={{ color: entry.color }}>
                          <ProtoIcon name={entry.icon as 'plus' | 'check' | 'mail' | 'edit'} size={11} />
                        </span>
                        <span style={{ fontSize: 12.5, color: 'var(--soft)' }}>{entry.text}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }} className="proto-mono">{entry.when}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )
        })() : null}
      </Drawer>

      {/* React Invoice Builder */}
      {builderOpen && (
        <div className="modal-overlay" onClick={() => closeBuilder()}>
          <div className="builder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="builder-modal-header">
              <span>{editingInvoice ? `Edit Invoice — ${editingInvoice.number}` : 'New Invoice'}</span>
              <button className="modal-close btn-icon" onClick={() => closeBuilder()}>✕</button>
            </div>
            <div className="builder-modal-body">
              <InvoiceBuilder onCreated={closeBuilder} onCancel={() => closeBuilder()} initialClientId={builderClientId} initialProjectId={builderProjectId} editInvoice={editingInvoice} />
            </div>
          </div>
        </div>
      )}

      {/* Quick Invoice Modal */}
      {quickModal && (
        <div className="modal-overlay" onClick={() => setQuickModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Quick Invoice <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>· auto-marked Sent + emailed</span></h2>
              <button className="modal-close btn-icon" onClick={() => setQuickModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Client *</label>
                  <select className="form-select" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })}>
                    <option value="">— Select client —</option>
                    {clients.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Invoice Date</label>
                  <input className="form-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input className="form-input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount ($) *</label>
                  <input className="form-input" type="number" placeholder="0.00" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: e.target.value })} />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional message to client..." />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setQuickModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveQuick} disabled={!form.clientName || !form.subtotal}>Create</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete invoice?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => doDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Send Confirmation Modal */}
      {sendConfirmInv && (
        <div className="modal-overlay" onClick={() => setSendConfirmInv(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Invoice Saved</h2>
              <button className="modal-close btn-icon" onClick={() => setSendConfirmInv(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--soft)', marginBottom: 8 }}>
                <strong>{sendConfirmInv.number}</strong> has been saved as a draft.
              </p>
              {sendConfirmInv.clientEmail ? (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Send to <strong>{sendConfirmInv.clientEmail}</strong>
                  {sendConfirmInv.clientCcEmails?.length ? <> with CC <strong>{formatEmailList(sendConfirmInv.clientCcEmails)}</strong></> : null} now?
                </p>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>No client email on file. Mark as sent manually when ready.</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setSendConfirmInv(null)}>Keep as Draft</button>
              <button className="btn-primary" onClick={() => { void (async () => {
                const updated = invoices.map(i => i.id === sendConfirmInv.id
                  ? { ...i, status: 'sent' as const, statusHistory: [...(i.statusHistory||[]), { status: 'sent', changedAt: Date.now() }] }
                  : i)
                const ok = await persist(updated)
                if (!ok) return
                if (sendConfirmInv.clientEmail) {
                  const result = await emailInvoice(sendConfirmInv, settings)
                  showToast(describeEmailResult(result, `Invoice ${sendConfirmInv.number}`, invoiceRecipient(sendConfirmInv)))
                } else {
                  showToast(`Invoice ${sendConfirmInv.number} marked as sent`)
                }
                setSendConfirmInv(null)
              })() }}>{sendConfirmInv.clientEmail ? 'Send Now' : 'Mark as Sent'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
          background: '#1e293b', border: '1px solid var(--border)',
          borderLeft: '3px solid #4ade80',
          color: 'var(--text)', fontSize: 13, fontWeight: 500,
          padding: '10px 16px', borderRadius: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,.4)',
          maxWidth: 360, animation: 'fadeIn .2s ease',
        }}>
          ✓ {toast}
        </div>
      )}

      {/* Invoice Preview Modal */}
      {previewInv && (
        <div className="modal-overlay" onClick={closeInvoicePreview}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '90vw', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ padding: '14px 20px' }}>
              <div>
                <h2 className="modal-title">Preview — {previewInv.number}</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{previewInv.clientName}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-ghost btn-sm" onClick={() => startEditInvoice(previewInv)}>Edit</button>
                <button className="btn-primary btn-sm" onClick={() => printInvoice(previewInv, settings)}>⎙ Print / PDF</button>
                <button className="modal-close btn-icon" onClick={closeInvoicePreview}>✕</button>
              </div>
            </div>
            <iframe
              srcDoc={buildInvoiceHTML(previewInv, settings, false)}
              style={{ flex: 1, border: 'none', background: '#fff', minHeight: 500 }}
              title="Invoice Preview"
            />
          </div>
        </div>
      )}
    </div>
  )
}
