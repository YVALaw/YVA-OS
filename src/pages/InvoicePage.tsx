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
import { sendEmail } from '../services/gmail'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'partial'

const STATUSES: { key: InvoiceStatus; label: string }[] = [
  { key: 'draft',   label: 'Draft' },
  { key: 'sent',    label: 'Sent' },
  { key: 'viewed',  label: 'Viewed' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid',    label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
]

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

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

function dopLabel(usd: number, rate: number): string {
  if (!rate || rate <= 0) return ''
  return `RD$${(usd * rate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// ── Shared invoice HTML builder ─────────────────────────────
function buildInvoiceHTML(inv: Invoice, rate: number, settings: AppSettings, autoPrint = false): string {
  const dop = dopLabel(Number(inv.subtotal) || 0, rate)
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
      ${dop ? `<div class="dop">${dop}</div>` : ''}
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
      return '<tr><td style="white-space:nowrap"><strong>' + it.employeeName + '</strong>' + (it.position ? '<br><span style="font-size:10px;color:#888">' + it.position + '</span>' : '') + '</td>' + dayCells + '<td style="text-align:right;font-weight:700;white-space:nowrap">' + it.hoursTotal + 'h</td><td style="text-align:right;white-space:nowrap">$' + it.rate + '/hr</td><td style="text-align:right;font-weight:700;white-space:nowrap">$' + (it.hoursTotal * it.rate).toFixed(2) + '</td></tr>'
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
    </div>
    ${dop ? `<div class="dop">${dop}</div>` : ''}`
  } else {
    const bodyRows = (inv.items || []).map(it =>
      '<tr><td><strong>' + it.employeeName + '</strong>' + (it.position ? '<br><span style="font-size:11px;color:#888">' + it.position + '</span>' : '') + '</td><td style="text-align:right">' + it.hoursTotal + 'h</td><td style="text-align:right">$' + it.rate + '/hr</td><td style="text-align:right"><strong>$' + (it.hoursTotal * it.rate).toFixed(2) + '</strong></td></tr>'
    ).join('')
    itemsSection = `
    <table>
      <thead><tr><th>Team Member</th><th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${bodyRows}
        <tr class="total-row"><td colspan="3">Total Due</td><td style="text-align:right">${formatMoney(Number(inv.subtotal) || 0)}</td></tr>
      </tbody>
    </table>
    ${dop ? `<div class="dop">${dop}</div>` : ''}`
  }

  return `<!DOCTYPE html><html><head>
    <title>${inv.number}</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; color: #111; }
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
      .dop { font-size: 12px; color: #999; margin-top: 4px; }
      .notes-box { background: #f9f9f9; border-left: 3px solid #f5b533; padding: 12px 16px; margin-top: 24px; font-size: 13px; color: #444; white-space: pre-wrap; }
      .footer { margin-top: 40px; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
      @media print { body { margin: 20px; } }
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

function printInvoice(inv: Invoice, rate: number, settings: AppSettings) {
  const html = buildInvoiceHTML(inv, rate, settings, true)
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

// ── Share portal link ──────────────────────────────────────
function shareInvoice(inv: Invoice, dopRate: number) {
  const payload = { inv, dopRate: dopRate > 0 ? dopRate : undefined }
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
function emailInvoice(inv: Invoice, settings: AppSettings) {
  const to      = inv.clientEmail || ''
  const subject = `Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body    = applyInvoiceTemplate(settings.invoiceEmailTemplate || DEFAULT_INVOICE_EMAIL, inv, settings)
  sendEmail(to, subject, body)
}

// ── Payment reminder email ──────────────────────────────────
function reminderEmail(inv: Invoice, settings: AppSettings) {
  const to      = inv.clientEmail || ''
  const subject = `Payment Reminder — Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body    = applyInvoiceTemplate(settings.reminderEmailTemplate || DEFAULT_REMINDER_EMAIL, inv, settings)
  sendEmail(to, subject, body)
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
  const [statusModal, setStatusModal] = useState(false)
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

  function persist(next: Invoice[]) { setInvoices(next); void saveInvoices(next) }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function openBuilder(projectId?: string) { setBuilderProjectId(projectId); setBuilderOpen(true) }
  function openEditInvoice(inv: Invoice) { setEditingInvoice(inv); setBuilderProjectId(inv.projectId || undefined); setBuilderOpen(true) }
  async function closeBuilder(inv?: Invoice) {
    const fresh = await loadInvoices()
    setInvoices(fresh)
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
    persist([inv, ...invoices])
    void saveInvoiceCounter(counter + 1)
    setQuickModal(false)
    setQuickProjectId(undefined)
    if (inv.clientEmail) emailInvoice(inv, settings)
  }

  function toggleCollapse(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function openStatusEdit(inv: Invoice) {
    setEditId(inv.id)
    setNewStatus((inv.status as InvoiceStatus) || 'draft')
    setNewAmountPaid(inv.amountPaid != null ? String(inv.amountPaid) : '')
    setStatusModal(true)
  }
  function saveStatus() {
    if (!editId) return
    const amtPaid = newStatus === 'partial' ? (parseFloat(newAmountPaid) || 0) : undefined
    persist(invoices.map((inv) => {
      if (inv.id !== editId) return inv
      const histEntry = { status: newStatus, changedAt: Date.now() }
      return {
        ...inv, status: newStatus, amountPaid: amtPaid, updatedAt: Date.now(),
        statusHistory: [...(inv.statusHistory || []), histEntry],
      }
    }))
    setStatusModal(false)
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
      persist([dup, ...invoices])
      void saveInvoiceCounter(counter + 1)
    })
  }
  function doDelete(id: string) { persist(invoices.filter((inv) => inv.id !== id)); setConfirmDelete(null) }

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

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">{invoices.length} total · {formatMoney(totalBilled)}{settings.usdToDop > 0 ? ` · RD$${(totalBilled * settings.usdToDop).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}</p>
        </div>
        <div className="page-header-actions">
          <input className="form-input" style={{ width: 190 }} placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {invoices.some(i => ['overdue','sent','partial'].includes((i.status||'').toLowerCase()) && i.clientEmail) && (
            <button className="btn-ghost btn-sm" title="Send reminder to all clients with unpaid invoices" onClick={() => {
              const seen = new Set<string>()
              for (const inv of invoices.filter(i => ['overdue','sent','partial'].includes((i.status||'').toLowerCase()) && i.clientEmail)) {
                if (!seen.has(inv.clientEmail!)) { seen.add(inv.clientEmail!); reminderEmail(inv, settings) }
              }
              showToast(`Reminders sent to ${seen.size} client${seen.size !== 1 ? 's' : ''}`)
            }}>✉ Remind All</button>
          )}
          <button className="btn-ghost btn-sm" onClick={() => openQuickForProject(undefined)}>Quick Invoice</button>
          <button className="btn-primary" onClick={() => openBuilder()}>+ New Invoice</button>
        </div>
      </div>

      {/* PROJECT-GROUPED INVOICE LIST */}
      {groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontSize: 14 }}>
          {search ? 'No invoices match your search.' : 'No invoices yet. Click "+ New Invoice" to get started.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map(({ key, label, projectId: pId, invoices: groupInvs }) => {
            const groupTotal = groupInvs.reduce((s, i) => s + (Number(i.subtotal)||0), 0)
            const unpaid = groupInvs.filter(i => ['sent','overdue','partial'].includes((i.status||'').toLowerCase())).length
            const isOpen = expanded.has(key)
            return (
              <div key={key} className="invoice-group">
                <div className="invoice-group-header" onClick={() => toggleCollapse(key)}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', width: 12 }}>{isOpen ? '▼' : '▶'}</span>
                  <span className="invoice-group-name">{label}</span>
                  <span className="invoice-group-meta">
                    {groupInvs.length} invoice{groupInvs.length !== 1 ? 's' : ''} · {formatMoney(groupTotal)}
                    {settings.usdToDop > 0 ? ` · RD$${(groupTotal * settings.usdToDop).toLocaleString('en-US',{maximumFractionDigits:0})}` : ''}
                    {unpaid > 0 && <span style={{ marginLeft: 8, color: '#f87171', fontSize: 11 }}>● {unpaid} unpaid</span>}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <button className="btn-xs btn-ghost" onClick={() => openQuickForProject(pId || undefined)}>+ Quick</button>
                    <button className="btn-xs btn-ghost" onClick={() => openBuilder(pId || undefined)}>+ Invoice</button>
                  </div>
                </div>
                {isOpen && (
                  <div className="table-wrap" style={{ margin: '0 0 2px' }}>
                    <table className="data-table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>Number</th>
                          <th>Client</th>
                          <th>Date</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupInvs.map(inv => {
                          const overdue = inv.dueDate && new Date(inv.dueDate) < new Date() && !['paid'].includes((inv.status||'').toLowerCase())
                          return (
                            <tr key={inv.id}>
                              <td className="td-name" style={{ fontWeight: 700, fontSize: 13 }}>{inv.number}</td>
                              <td className="td-muted">{inv.clientName || '—'}</td>
                              <td className="td-muted">{inv.date || '—'}</td>
                              <td className="td-muted" style={{ color: overdue ? '#f87171' : undefined }}>{inv.dueDate || '—'}</td>
                              <td><span className={`badge ${statusBadge(inv.status)}`} style={{ fontSize: 10 }}>{inv.status || 'draft'}</span>
                                {inv.status === 'partial' && inv.amountPaid != null && (
                                  <span style={{ fontSize: 10, color: '#f97316', marginLeft: 4 }}>({formatMoney(inv.amountPaid)} paid)</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                {formatMoney(Number(inv.subtotal)||0)}
                                {settings.usdToDop > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{dopLabel(Number(inv.subtotal)||0, settings.usdToDop)}</div>}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                  {inv.clientEmail && <button className="btn-xs btn-ghost" title="Email invoice" onClick={() => { emailInvoice(inv, settings); showToast(`Invoice ${inv.number} emailed to ${inv.clientEmail}`) }}>✉</button>}
                                  {inv.clientEmail && ['overdue','sent','partial'].includes((inv.status||'').toLowerCase()) && (
                                    <button className="btn-xs btn-ghost" title="Payment reminder" onClick={() => { reminderEmail(inv, settings); showToast(`Payment reminder sent to ${inv.clientEmail}`) }}>⚠</button>
                                  )}
                                  <button className="btn-xs btn-ghost" title="Preview" onClick={() => setPreviewInv(inv)}>👁</button>
                                  <button className="btn-xs btn-ghost" title="PDF" onClick={() => printInvoice(inv, settings.usdToDop, settings)}>⎙</button>
                                  <button className="btn-xs btn-ghost" title="Share portal" onClick={() => shareInvoice(inv, settings.usdToDop)}>🔗</button>
                                  <button className="btn-xs btn-ghost" title="Duplicate" onClick={() => duplicateInvoice(inv)}>⧉</button>
                                  <button className="btn-xs btn-ghost" title="Edit invoice" onClick={() => openEditInvoice(inv)}>✏</button>
                                  <button className="btn-xs btn-ghost" title="Update status" onClick={() => openStatusEdit(inv)}>✎</button>
                                  <button className="btn-xs btn-danger" onClick={() => setConfirmDelete(inv.id)}>×</button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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

      {/* Status update */}
      {statusModal && (
        <div className="modal-overlay" onClick={() => setStatusModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Update Status</h2>
              <button className="modal-close btn-icon" onClick={() => setStatusModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={newStatus} onChange={(e) => setNewStatus(e.target.value as InvoiceStatus)}>
                  {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              {newStatus === 'partial' && (
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="form-label">Amount Paid ($)</label>
                  <input
                    className="form-input"
                    type="number"
                    placeholder="0.00"
                    value={newAmountPaid}
                    onChange={e => setNewAmountPaid(e.target.value)}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Enter how much has been received so far.
                  </div>
                </div>
              )}
              {(() => {
                const hist = invoices.find(i => i.id === editId)?.statusHistory || []
                if (hist.length === 0) return null
                return (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>Status History</div>
                    {[...hist].reverse().slice(0, 6).map((h, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, marginBottom: 5 }}>
                        <span className={`badge ${statusBadge(h.status)}`} style={{ fontSize: 10 }}>{h.status}</span>
                        <span style={{ color: 'var(--muted)' }}>{new Date(h.changedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setStatusModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveStatus}>Save</button>
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
              <button className="btn-primary" onClick={() => {
                const updated = invoices.map(i => i.id === sendConfirmInv.id
                  ? { ...i, status: 'sent' as const, statusHistory: [...(i.statusHistory||[]), { status: 'sent', changedAt: Date.now() }] }
                  : i)
                void saveInvoices(updated)
                setInvoices(updated)
                if (sendConfirmInv.clientEmail) {
                  emailInvoice(sendConfirmInv, settings)
                  showToast(`Invoice ${sendConfirmInv.number} sent to ${sendConfirmInv.clientEmail}`)
                } else {
                  showToast(`Invoice ${sendConfirmInv.number} marked as sent`)
                }
                setSendConfirmInv(null)
              }}>{sendConfirmInv.clientEmail ? 'Send Now' : 'Mark as Sent'}</button>
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
                <button className="btn-primary btn-sm" onClick={() => printInvoice(previewInv, settings.usdToDop, settings)}>⎙ Print / PDF</button>
                <button className="modal-close btn-icon" onClick={() => setPreviewInv(null)}>✕</button>
              </div>
            </div>
            <iframe
              srcDoc={buildInvoiceHTML(previewInv, settings.usdToDop, settings, false)}
              style={{ flex: 1, border: 'none', background: '#fff', minHeight: 500 }}
              title="Invoice Preview"
            />
          </div>
        </div>
      )}
    </div>
  )
}
