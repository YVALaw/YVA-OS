import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppSettings, Client, Invoice, Project } from '../data/types'
import {
  loadInvoices, saveInvoices,
  loadInvoiceCounter, saveInvoiceCounter,
  loadSnapshot, loadSettings,
} from '../services/storage'
import { formatMoney } from '../utils/money'
import InvoiceBuilder from '../components/InvoiceBuilder'
import { sendEmail, type SendEmailResult } from '../services/gmail'
import { htmlToPdfAttachment } from '../utils/pdf'
import { formatTimeEntrySummaryHtml } from '../utils/timesheet'

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

// ── Shared invoice HTML builder ─────────────────────────────
function buildInvoiceHTML(inv: Invoice, settings: AppSettings, autoPrint = false): string {
  const companyName    = settings.companyName    || 'YVA Staffing'
  const companyAddress = settings.companyAddress || 'Santo Domingo, Dominican Republic'
  const companyEmail   = settings.companyEmail   || 'Contact@yvastaffing.net'
  const companyPhone   = settings.companyPhone   || '+1 (717) 281-8676'

  function parseH(v: string): number {
    if (!v) return 0
    const s = v.trim().replace(',', '.')
    if (s.includes(':')) { const [h, m] = s.split(':'); return (parseInt(h)||0) + (parseInt(m)||0)/60 }
    return parseFloat(s) || 0
  }

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
          const h = parseH(it.daily?.[d] || '')
          return '<td style="text-align:center;font-size:11px;color:' + (h > 0 ? '#111' : '#ccc') + '">' + (h > 0 ? (h % 1 === 0 ? String(h) : h.toFixed(1)) : '—') + '</td>'
        }).join('')
        return '<tr><td style="white-space:nowrap"><strong>' + it.employeeName + '</strong>' + (it.position ? '<br><span style="font-size:10px;color:#888">' + it.position + '</span>' : '') + (it.timeEntries?.length ? '<div style="font-size:10px;color:#6b7280;line-height:1.45;margin-top:4px;white-space:pre-line">' + formatTimeEntrySummaryHtml(it.timeEntries) + '</div>' : '') + '</td>' + dayCells + '<td style="text-align:right;font-weight:700;white-space:nowrap">' + it.hoursTotal + 'h</td><td style="text-align:right;white-space:nowrap">$' + it.rate + '/hr</td><td style="text-align:right;font-weight:700;white-space:nowrap">$' + Number(it.billAmount ?? (it.hoursTotal * it.rate)).toFixed(2) + '</td></tr>'
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
      '<tr><td><strong>' + it.employeeName + '</strong>' + (it.position ? '<br><span style="font-size:11px;color:#888">' + it.position + '</span>' : '') + (it.timeEntries?.length ? '<div style="font-size:10px;color:#6b7280;line-height:1.45;margin-top:4px;white-space:pre-line">' + formatTimeEntrySummaryHtml(it.timeEntries) + '</div>' : '') + '</td><td style="text-align:right">' + it.hoursTotal + 'h</td><td style="text-align:right">$' + it.rate + '/hr</td><td style="text-align:right"><strong>$' + Number(it.billAmount ?? (it.hoursTotal * it.rate)).toFixed(2) + '</strong></td></tr>'
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
          <div><strong>${companyName}</strong></div>
          <div>${companyAddress}</div>
          <div>${companyEmail}</div>
          <div>${companyPhone}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="inv-title">INVOICE</div>
        <div class="inv-num">${inv.number}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px">
      <div class="section">
        <div class="label">Bill To</div>
        <div class="value">${inv.clientName || '—'}</div>
        ${inv.clientEmail ? `<div style="font-size:13px;color:#666">${inv.clientEmail}</div>` : ''}
        ${inv.clientAddress ? `<div style="font-size:13px;color:#666;white-space:pre-line">${inv.clientAddress}</div>` : ''}
      </div>
      <div class="section">
        <div class="label">Invoice Details</div>
        <div class="value">${inv.date || '—'}</div>
        ${inv.dueDate ? `<div style="font-size:13px;color:#c00"><strong>Due: ${inv.dueDate}</strong></div>` : ''}
        ${inv.billingStart ? `<div style="font-size:13px;color:#666">Period: ${inv.billingStart} – ${inv.billingEnd || ''}</div>` : ''}
        ${inv.projectName ? `<div style="font-size:13px;color:#666">Project: ${inv.projectName}</div>` : ''}
      </div>
    </div>
    ${itemsSection}
    ${inv.notes ? `<div class="notes-box">${inv.notes}</div>` : ''}
    <div class="footer">${companyName} · yvastaffing.net</div>
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
  return sendEmail(to, subject, body, { attachments: [attachment] })
}

// ── Payment reminder email ──────────────────────────────────
async function reminderEmail(inv: Invoice, settings: AppSettings): Promise<SendEmailResult> {
  const to      = inv.clientEmail || ''
  const subject = `Payment Reminder — Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body    = applyInvoiceTemplate(settings.reminderEmailTemplate || DEFAULT_REMINDER_EMAIL, inv, settings)
  const attachment = await htmlToPdfAttachment(`${inv.number || 'invoice'}.pdf`, buildInvoiceHTML(inv, settings, false))
  return sendEmail(to, subject, body, { attachments: [attachment] })
}

type QuickForm = {
  clientName: string; date: string; dueDate: string
  subtotal: string; notes: string; status: InvoiceStatus
}
const EMPTY_FORM: QuickForm = {
  clientName: '', date: new Date().toISOString().slice(0, 10),
  dueDate: '', subtotal: '', notes: '', status: 'draft',
}

export default function InvoicePage() {
  const location = useLocation()
  const [invoices,    setInvoices]    = useState<Invoice[]>([])
  const [clients,     setClients]     = useState<Client[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [settings,    setSettings]    = useState<AppSettings>({ usdToDop: 0 })
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderProjectId, setBuilderProjectId] = useState<string | undefined>()
  const [editingInvoice, setEditingInvoice] = useState<Invoice | undefined>()
  const [sendConfirmInv, setSendConfirmInv] = useState<Invoice | null>(null)
  const [quickModal, setQuickModal] = useState(false)
  const [quickProjectId, setQuickProjectId] = useState<string | undefined>()
  const [editId, setEditId] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState<InvoiceStatus>('draft')
  const [newAmountPaid, setNewAmountPaid] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM)
  const urlQ = new URLSearchParams(location.search).get('q') || ''
  const [search, setSearch] = useState(urlQ)
  const [toast, setToast] = useState<string | null>(null)
  const [previewInv, setPreviewInv] = useState<Invoice | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSnapshot().then(snap => {
      setInvoices(snap.invoices)
      setClients(snap.clients)
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

  async function handleInvoiceEmail(inv: Invoice, noun = `Invoice ${inv.number}`) {
    if (!inv.clientEmail) return
    const result = await emailInvoice(inv, settings)
    showToast(describeEmailResult(result, noun, inv.clientEmail))
  }

  async function handleReminderEmail(inv: Invoice) {
    if (!inv.clientEmail) return
    const result = await reminderEmail(inv, settings)
    showToast(describeEmailResult(result, `Reminder for ${inv.number}`, inv.clientEmail))
  }

  function openBuilder(projectId?: string) { setBuilderProjectId(projectId); setBuilderOpen(true) }
  function openEditInvoice(inv: Invoice) { setEditingInvoice(inv); setBuilderProjectId(inv.projectId || undefined); setBuilderOpen(true) }
  async function closeBuilder(inv?: Invoice) {
    const fresh = await loadInvoices()
    setInvoices(fresh)
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
    setBuilderProjectId(undefined)
    setEditingInvoice(undefined)
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
      showToast(describeEmailResult(result, `Invoice ${inv.number}`, inv.clientEmail))
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
      return
    }
    setEditId(inv.id)
    setNewStatus((inv.status as InvoiceStatus) || 'draft')
    setNewAmountPaid(inv.amountPaid != null ? String(inv.amountPaid) : '')
  }
  function applyStatusChange(targetId: string, status: InvoiceStatus, amountPaid?: string) {
    const amtPaid = status === 'partial' ? (parseFloat(amountPaid || '') || 0) : undefined
    void persist(invoices.map((inv) => {
      if (inv.id !== targetId) return inv
      const histEntry = { status, changedAt: Date.now() }
      return {
        ...inv, status, amountPaid: amtPaid, updatedAt: Date.now(),
        statusHistory: [...(inv.statusHistory || []), histEntry],
      }
    }))
    setEditId(null)
  }

  function handleInlineStatusSelect(inv: Invoice, nextStatus: InvoiceStatus) {
    setEditId(inv.id)
    setNewStatus(nextStatus)
    if (nextStatus !== 'partial') {
      applyStatusChange(inv.id, nextStatus)
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

  const filtered = invoices.filter((inv) =>
    `${inv.number} ${inv.clientName} ${inv.projectName}`.toLowerCase().includes(search.toLowerCase()),
  )

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

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">{invoices.length} total · {formatMoney(totalBilled)}</p>
        </div>
        <div className="page-header-actions">
          {invoices.some(i => ['overdue','sent','partial'].includes((i.status||'').toLowerCase()) && i.clientEmail) && (
            <button className="btn-ghost btn-sm" title="Send reminder to all clients with unpaid invoices" onClick={() => { void (async () => {
              const seen = new Set<string>()
              let gmailSent = 0
              let fallbackCount = 0
              for (const inv of invoices.filter(i => ['overdue','sent','partial'].includes((i.status||'').toLowerCase()) && i.clientEmail)) {
                if (!seen.has(inv.clientEmail!)) {
                  seen.add(inv.clientEmail!)
                  const result = await reminderEmail(inv, settings)
                  if (result.mode === 'gmail') gmailSent += 1
                  else fallbackCount += 1
                }
              }
              if (fallbackCount > 0) {
                showToast(`Reminders sent to ${gmailSent} client${gmailSent !== 1 ? 's' : ''}; ${fallbackCount} opened as drafts with PDF download`)
              } else {
                showToast(`Reminders sent to ${gmailSent} client${gmailSent !== 1 ? 's' : ''}`)
              }
            })() }}>✉ Remind All</button>
          )}
          <button className="btn-ghost btn-sm" onClick={() => openQuickForProject(undefined)}>Quick Invoice</button>
          <button className="btn-primary" onClick={() => openBuilder()}>+ New Invoice</button>
        </div>
      </div>

      <div className="filter-bar">
        <input className="form-input filter-input-sm" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="pill-meta">{draftCount} draft</span>
        <span className="pill-meta">{unpaidCount} unpaid</span>
        <span className="toolbar-spacer pill-meta">{groups.length} project group{groups.length !== 1 ? 's' : ''}</span>
      </div>

      {/* PROJECT-GROUPED INVOICE LIST */}
      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{search ? 'No invoices match your search.' : 'No invoices yet.'}</div>
          <div className="empty-state-copy">{search ? 'Try a different client, project, or invoice number.' : 'Create your first invoice to start tracking billing, reminders, and project totals here.'}</div>
        </div>
      ) : (
        <div className="invoice-groups">
          {groups.map(({ key, label, projectId: pId, invoices: groupInvs }) => {
            const groupTotal = groupInvs.reduce((s, i) => s + (Number(i.subtotal)||0), 0)
            const unpaid = groupInvs.filter(i => ['sent','overdue','partial'].includes((i.status||'').toLowerCase())).length
            const isOpen = expanded.has(key)
            return (
              <div key={key} className="invoice-group">
                <div className="invoice-group-header" onClick={() => toggleCollapse(key)}>
                  <div className="invoice-group-summary">
                    <span style={{ fontSize: 12, color: 'var(--muted)', width: 12 }}>{isOpen ? '▼' : '▶'}</span>
                    <span className="invoice-group-name">{label}</span>
                    <span className="invoice-group-meta">
                      {groupInvs.length} invoice{groupInvs.length !== 1 ? 's' : ''} · {formatMoney(groupTotal)}
                    </span>
                    {unpaid > 0 && <span className="pill-meta" style={{ color: '#f87171' }}>{unpaid} unpaid</span>}
                  </div>
                  <div className="invoice-group-actions" onClick={e => e.stopPropagation()}>
                    <button className="btn-xs btn-ghost" onClick={() => openQuickForProject(pId || undefined)}>+ Quick</button>
                    <button className="btn-xs btn-ghost" onClick={() => openBuilder(pId || undefined)}>+ Invoice</button>
                  </div>
                </div>
                {isOpen && (
                  <div className="invoice-rows">
                    {groupInvs.map(inv => {
                      const overdue = inv.dueDate && new Date(inv.dueDate) < new Date() && !['paid'].includes((inv.status||'').toLowerCase())
                      const hours = (inv.items || []).reduce((sum, item) => sum + (Number(item.hoursTotal) || 0), 0)
                      return (
                        <div key={inv.id} className="invoice-row">
                          <div className="invoice-row-main">
                            <div className="invoice-row-number">{inv.number}</div>
                            <div className="invoice-row-client">{inv.clientName || '—'}</div>
                            <div className="invoice-row-sub">{inv.projectName || 'Unassigned project'}{hours > 0 ? ` · ${hours.toFixed(1)}h` : ''}</div>
                          </div>
                          <div className="invoice-row-meta">
                            <div className="invoice-row-date"><strong>Issued</strong> {inv.date || '—'}</div>
                            <div className={`invoice-row-due${overdue ? ' overdue' : ''}`}><strong>Due</strong> {inv.dueDate || '—'}</div>
                          </div>
                          <div className="invoice-row-amount">
                            {editId === inv.id ? (
                              <div onClick={e => e.stopPropagation()} style={{ display: 'grid', gap: 6, justifyItems: 'end', width: '100%' }}>
                                <select
                                  className="form-select"
                                  style={{ minWidth: 118, fontSize: 12, padding: '4px 8px' }}
                                  value={newStatus}
                                  onChange={(e) => handleInlineStatusSelect(inv, e.target.value as InvoiceStatus)}
                                >
                                  {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                                </select>
                                {newStatus === 'partial' && (
                                  <>
                                    <input
                                      className="form-input"
                                      type="number"
                                      placeholder="Amount paid"
                                      style={{ width: 118, fontSize: 12, padding: '5px 8px' }}
                                      value={newAmountPaid}
                                      onChange={e => setNewAmountPaid(e.target.value)}
                                    />
                                    <div style={{ display: 'flex', gap: 6 }}>
                                      <button className="btn-xs btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                                      <button className="btn-xs btn-primary" onClick={() => applyStatusChange(inv.id, 'partial', newAmountPaid)}>Save</button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : (
                              <button
                                className={`badge ${statusBadge(inv.status)}`}
                                style={{ fontSize: 10, border: 0, cursor: 'pointer' }}
                                title="Change status"
                                onClick={() => openStatusEdit(inv)}
                              >
                                {inv.status || 'draft'}
                              </button>
                            )}
                            <div className="invoice-row-total">{formatMoney(Number(inv.subtotal)||0)}</div>
                            {inv.status === 'partial' && inv.amountPaid != null && (
                              <div className="invoice-row-paid-note">{formatMoney(inv.amountPaid)} paid so far</div>
                            )}
                          </div>
                          <div className="invoice-row-actions">
                            {inv.clientEmail && <button className="btn-xs btn-ghost" title="Email invoice" onClick={() => { void handleInvoiceEmail(inv) }}>✉</button>}
                            {inv.clientEmail && ['overdue','sent','partial'].includes((inv.status||'').toLowerCase()) && (
                              <button className="btn-xs btn-ghost" title="Payment reminder" onClick={() => { void handleReminderEmail(inv) }}>⚠</button>
                            )}
                            <button className="btn-xs btn-ghost" title="Preview" onClick={() => setPreviewInv(inv)}>👁</button>
                            <button className="btn-xs btn-ghost" title="PDF" onClick={() => printInvoice(inv, settings)}>⎙</button>
                            <button className="btn-xs btn-ghost" title="Share portal" onClick={() => shareInvoice(inv)}>🔗</button>
                            <button className="btn-xs btn-ghost" title="Duplicate" onClick={() => duplicateInvoice(inv)}>⧉</button>
                            <button className="btn-xs btn-ghost" title="Edit invoice" onClick={() => openEditInvoice(inv)}>✏</button>
                            <button className="btn-xs btn-danger" onClick={() => setConfirmDelete(inv.id)}>×</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* React Invoice Builder */}
      {builderOpen && (
        <div className="modal-overlay" onClick={() => closeBuilder()}>
          <div className="builder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="builder-modal-header">
              <span>{editingInvoice ? `Edit Invoice — ${editingInvoice.number}` : 'New Invoice'}</span>
              <button className="modal-close btn-icon" onClick={() => closeBuilder()}>✕</button>
            </div>
            <div className="builder-modal-body">
              <InvoiceBuilder onCreated={closeBuilder} onCancel={() => closeBuilder()} initialProjectId={builderProjectId} editInvoice={editingInvoice} />
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
                  Send to <strong>{sendConfirmInv.clientEmail}</strong> now?
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
                  showToast(describeEmailResult(result, `Invoice ${sendConfirmInv.number}`, sendConfirmInv.clientEmail))
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
        <div className="modal-overlay" onClick={() => setPreviewInv(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '90vw', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ padding: '14px 20px' }}>
              <div>
                <h2 className="modal-title">Preview — {previewInv.number}</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{previewInv.clientName}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-primary btn-sm" onClick={() => printInvoice(previewInv, settings)}>⎙ Print / PDF</button>
                <button className="modal-close btn-icon" onClick={() => setPreviewInv(null)}>✕</button>
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
