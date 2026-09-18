import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Attachment, Client, Employee, Invoice, Project } from '../data/types'
import {
  loadSnapshot, saveEmployees, saveInvoices, saveProjects,
  loadEmployeeCounter, saveEmployeeCounter, loadSettings,
} from '../services/storage'
import { sendEmail, type SendEmailResult } from '../services/gmail'
import { formatMoney, fmtHoursHM } from '../utils/money'
import { formatInvoiceHoursEntry, parseInvoiceHours } from '../utils/invoiceHours'
import { useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { htmlToPdfAttachment } from '../utils/pdf'
import { computePayrollBreakdown, distinctPayRates, employeePremiumConfig, formatPayRateLabel, itemBelongsToEmployee, normalizeClockInput, payrollFromInvoiceItem } from '../utils/payroll'
import { formatEmailList, parseEmailList } from '../utils/email'
import { Avatar, FilterChips, KanbanColumn, KanbanItem, ProtoIcon, SearchField, StatusChip, ToggleGroup, colorFromString, protoCurrency, useKanbanDnd } from '../components/PrototypeKit'

function uid() { return crypto.randomUUID() }

async function generateEmployeeNumber(): Promise<string> {
  const year = String(new Date().getFullYear()).slice(-2)
  const counter = await loadEmployeeCounter()
  void saveEmployeeCounter(counter + 1)
  return `YVA${year}${String(counter).padStart(3, '0')}`
}

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function statusBadge(s?: string) {
  switch ((s || '').toLowerCase()) {
    case 'inactive': return 'badge-red'
    case 'on hold': return 'badge-yellow'
    case 'onboarding': return 'badge-blue'
    case 'trial': return 'badge-purple'
    default: return 'badge-green'
  }
}
function statusColor(s?: string): string {
  switch ((s || '').toLowerCase()) {
    case 'inactive': return '#ef4444'
    case 'on hold': return '#f5b533'
    case 'onboarding': return '#3b82f6'
    case 'trial': return '#a855f7'
    default: return '#22c55e'
  }
}

function projectAccent(status?: string): string {
  switch ((status || '').toLowerCase()) {
    case 'active': return '#22c55e'
    case 'hiring': return '#fb923c'
    case 'review': return '#a855f7'
    case 'on-hold': return '#22d3ee'
    case 'completed': return '#6b7280'
    default: return '#3b82f6'
  }
}

const STATUS_OPTIONS = ['Active', 'Onboarding', 'Trial', 'On hold', 'Inactive']
const TYPE_OPTIONS   = ['', 'Full-time', 'Part-time', 'Project-based']

type FormData = {
  name: string; email: string; ccEmails: string; phone: string; payRate: string
  defaultShiftStart: string; defaultShiftEnd: string
  premiumEnabled: boolean; premiumStartTime: string; premiumPercent: string
  role: string; employmentType: string; location: string
  timezone: string; startYear: string; status: string; notes: string
}
const EMPTY: FormData = {
  name: '', email: '', ccEmails: '', phone: '', payRate: '', defaultShiftStart: '', defaultShiftEnd: '', premiumEnabled: false, premiumStartTime: '21:00', premiumPercent: '15', role: '', employmentType: '',
  location: '', timezone: '', startYear: '', status: 'Active', notes: '',
}

function getEmployeeInvoices(emp: Employee, invoices: Invoice[], from?: string, to?: string) {
  return invoices.filter(inv => {
    const hasEmp = (inv.items || []).some(it => itemBelongsToEmployee(it, emp))
    if (!hasEmp) return false
    if (!from && !to) return true
    const d = inv.date || inv.billingEnd || inv.billingStart
    if (!d) return true
    if (from && d < from) return false
    if (to   && d > to)   return false
    return true
  }).sort(compareInvoicesDesc)
}

function getCurrentMonthBounds(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function invoiceOverlapsRange(inv: Invoice, from: string, to: string): boolean {
  const start = inv.billingStart || inv.date || inv.billingEnd || ''
  const end = inv.billingEnd || inv.date || inv.billingStart || ''
  if (!start && !end) return false
  return end >= from && start <= to
}

function compareInvoicesDesc(a: Invoice, b: Invoice): number {
  const aNum = parseInvoiceNumber(a.number)
  const bNum = parseInvoiceNumber(b.number)
  if (aNum !== bNum) return bNum - aNum
  const aDate = a.createdAt || (a.date ? Date.parse(a.date) : 0) || 0
  const bDate = b.createdAt || (b.date ? Date.parse(b.date) : 0) || 0
  return bDate - aDate
}

function parseInvoiceNumber(value?: string): number {
  if (!value) return 0
  const match = value.match(/(\d+)(?!.*\d)/)
  return match ? parseInt(match[1], 10) : 0
}

function getEmployeeInvoiceItems(emp: Employee, inv: Invoice) {
  return (inv.items || []).filter(it => itemBelongsToEmployee(it, emp))
}

function summarizeEmployeeInvoices(emp: Employee, invoices: Invoice[]) {
  return invoices.reduce((summary, inv) => {
    for (const item of getEmployeeInvoiceItems(emp, inv)) {
      const payroll = payrollFromInvoiceItem(item, emp)
      summary.hours += payroll.totalHours
      summary.regularHours += payroll.regularHours
      summary.premiumHours += payroll.premiumHours
      summary.totalPay += payroll.totalPay
    }
    return summary
  }, { hours: 0, regularHours: 0, premiumHours: 0, totalPay: 0 })
}

function buildPayslipHTML(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string, settings: Awaited<ReturnType<typeof loadSettings>>) {
  // Rates come from the invoice items themselves: the same employee can be paid
  // a different rate per project, and rates change over time.
  const payRateLabel = formatPayRateLabel(distinctPayRates(empInvoices.flatMap(inv => getEmployeeInvoiceItems(emp, inv)), emp))
  const premiumConfig = employeePremiumConfig(emp)
  const dopRate = settings.usdToDop || 0

  const summary = summarizeEmployeeInvoices(emp, empInvoices)
  const totalHours = summary.hours
  const totalUSD = summary.totalPay
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0

  const DA = ['Su','Mo','Tu','We','Th','Fr','Sa']
  const sections = empInvoices.map(inv => {
    const items = getEmployeeInvoiceItems(emp, inv)
    const invoiceSummary = items.reduce((acc, item) => {
      const payroll = payrollFromInvoiceItem(item, emp)
      acc.hrs += payroll.totalHours
      acc.regular += payroll.regularHours
      acc.premium += payroll.premiumHours
      acc.earned += payroll.totalPay
      return acc
    }, { hrs: 0, regular: 0, premium: 0, earned: 0 })
    const hrs = invoiceSummary.hrs
    const earned = invoiceSummary.earned
    const invPeriod = inv.billingStart ? inv.billingStart+(inv.billingEnd?' – '+inv.billingEnd:'') : (inv.date||'—')
    const daily = items[0]?.daily
    let allDates: string[] = []
    if (daily) {
      if (inv.billingStart && inv.billingEnd) {
        const cur = new Date(inv.billingStart+'T12:00:00')
        const end = new Date(inv.billingEnd+'T12:00:00')
        while (cur <= end) { allDates.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1) }
      } else {
        allDates = Object.keys(daily).filter(d=>parseInvoiceHours(daily[d])>0).sort()
      }
    }
    const label = '<div style="font-size:11px;margin-bottom:6px"><strong style="font-size:13px">'+inv.number+'</strong>&nbsp;&middot;&nbsp;'+(inv.projectName||'—')+'&nbsp;&middot;&nbsp;<span style="color:#999">'+invPeriod+'</span></div>'
    if (allDates.length > 0 && daily) {
      const dateHeaders = allDates.map(d=>{const dt=new Date(d+'T12:00:00');return '<th style="text-align:center;font-size:9px;padding:5px 3px;min-width:22px;color:#999;border-bottom:2px solid #eee;white-space:nowrap">'+DA[dt.getDay()]+'<br>'+(dt.getMonth()+1)+'/'+dt.getDate()+'</th>'}).join('')
      const dayCells = allDates.map(d=>{const h=parseInvoiceHours(daily[d]||'');return '<td style="text-align:center;padding:7px 4px;font-size:12px;color:'+(h>0?'#111':'#ccc')+'">'+(h>0?formatInvoiceHoursEntry(h):'—')+'</td>'}).join('')
      return label+'<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr>'+dateHeaders+'<th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">HOURS</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">RATE</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">EARNED</th></tr></thead><tbody><tr>'+dayCells+'<td style="text-align:right;font-weight:700;padding:8px 6px">'+hrs.toFixed(1)+'h</td><td style="text-align:right;color:#999;padding:8px 6px">'+formatPayRateLabel(distinctPayRates(items, emp))+'</td><td style="text-align:right;font-weight:700;color:#f5b533;padding:8px 6px">'+(earned>0?'$'+earned.toFixed(2):'—')+'</td></tr></tbody></table>' + (invoiceSummary.premium > 0 ? '<div style="font-size:11px;color:#666;margin-top:-10px;margin-bottom:14px">Premium split: '+invoiceSummary.regular.toFixed(2)+'h regular + '+invoiceSummary.premium.toFixed(2)+'h at +'+premiumConfig.percent+'%</div>' : '')
    } else {
      return label+'<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr><th style="font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">HOURS</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">RATE</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">EARNED</th></tr></thead><tbody><tr><td style="font-weight:700;padding:8px 6px">'+hrs.toFixed(1)+'h</td><td style="text-align:right;color:#999;padding:8px 6px">'+formatPayRateLabel(distinctPayRates(items, emp))+'</td><td style="text-align:right;font-weight:700;color:#f5b533;padding:8px 6px">'+(earned>0?'$'+earned.toFixed(2):'—')+'</td></tr></tbody></table>' + (invoiceSummary.premium > 0 ? '<div style="font-size:11px;color:#666;margin-top:-10px;margin-bottom:14px">Premium split: '+invoiceSummary.regular.toFixed(2)+'h regular + '+invoiceSummary.premium.toFixed(2)+'h at +'+premiumConfig.percent+'%</div>' : '')
    }
  }).join('<hr style="border:none;border-top:1px solid #eee;margin:0 0 16px">')

  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  return `<!DOCTYPE html><html><head>
  <title>Statement — ${emp.name}</title>
  <style>
    @page{size:Letter;margin:.5in}
    html,body{margin:0;padding:0;background:#fff}
    body{font-family:Arial,sans-serif;color:#111}
    .statement-page{width:8.5in;min-height:11in;margin:0 auto;padding:.6in;box-sizing:border-box;background:#fff}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid #f5b533;padding-bottom:16px}
    .logo{height:48px}
    h2{margin:0;font-size:22px;color:#f5b533}
    .meta{font-size:12px;color:#999;margin-top:4px}
    .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
    .kpi{background:#f9f9f9;border-radius:8px;padding:14px;text-align:center}
    .kpi-v{font-size:20px;font-weight:800;color:#111}
    .kpi-l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999;padding:8px 8px;border-bottom:2px solid #eee}
    td{padding:8px;border-bottom:1px solid #eee}
    .footer{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;text-align:center}
    @media print{body{margin:0}.statement-page{margin:0}}
  </style></head><body><div class="statement-page" data-pdf-page>
  <div class="header">
    <img src="${window.location.origin}/yva-logo.png" class="logo" onerror="this.style.display='none'" />
    <div style="text-align:right">
      <h2>EARNINGS STATEMENT</h2>
      <div class="meta">${emp.name}${emp.employeeNumber ? ` · ${emp.employeeNumber}` : ''}</div>
      <div class="meta">Period: ${period}</div>
      <div class="meta">Generated: ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="kpi-v">${empInvoices.length}</div><div class="kpi-l">Invoices</div></div>
    <div class="kpi"><div class="kpi-v">${totalHours.toFixed(1)}h</div><div class="kpi-l">Total Hours</div></div>
    <div class="kpi"><div class="kpi-v">${payRateLabel}</div><div class="kpi-l">Base Pay Rate</div></div>
    ${summary.premiumHours > 0 ? `<div class="kpi"><div class="kpi-v">${summary.premiumHours.toFixed(1)}h</div><div class="kpi-l">Premium Hours (+${premiumConfig.percent}%)</div></div>` : ''}
    <div class="kpi"><div class="kpi-v">$${totalUSD.toFixed(2)}</div><div class="kpi-l">Total Earned (USD)</div></div>
    ${totalDOP>0?`<div class="kpi"><div class="kpi-v">RD$${totalDOP.toLocaleString('en-US',{maximumFractionDigits:0})}</div><div class="kpi-l">Total Earned (DOP @ ${dopRate})</div></div>`:''}
  </div>
  ${sections?sections+'<div style="text-align:right;font-weight:800;font-size:13px;padding:10px 0;border-top:2px solid #111;margin-top:4px">Total &nbsp;&nbsp; '+totalHours.toFixed(1)+'h &nbsp;&nbsp; $'+totalUSD.toFixed(2)+'</div>' + (summary.premiumHours > 0 ? '<div style="text-align:right;font-size:11px;color:#666">Regular: '+summary.regularHours.toFixed(2)+'h · Premium: '+summary.premiumHours.toFixed(2)+'h at +'+premiumConfig.percent+'%</div>' : ''):'<p style="color:#999;text-align:center;padding:24px">No invoice data for this period.</p>'}
  <div class="footer">YVA Staffing · Bilingual Virtual Professionals · yvastaffing.net</div>
  </div></body></html>`
}

async function printPayslip(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(buildPayslipHTML(emp, empInvoices, dateFrom, dateTo, settings).replace('</body></html>', '<script>window.onload=function(){window.print()}</script></body></html>'))
  win.document.close()
}

async function emailStatement(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const dopRate = settings.usdToDop || 0
  const summary = summarizeEmployeeInvoices(emp, empInvoices)
  const totalHours = summary.hours
  const totalUSD = summary.totalPay
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0
  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  const companyName = settings.companyName || 'YVA Staffing'

  const subject = `Your Earnings Statement — ${period} — ${companyName}`

  let bodyText: string
  if (settings.statementEmailTemplate) {
    bodyText = settings.statementEmailTemplate
      .replace(/\{employeeName\}/g, emp.name)
      .replace(/\{period\}/g, period)
      .replace(/\{companyName\}/g, companyName)
  } else {
    bodyText =
      `Hi ${emp.name},\n\nHere is your earnings summary for the period ${period}:\n\n` +
      `  Total Hours: ${totalHours.toFixed(1)}h\n` +
      `  Total Earned: $${totalUSD.toFixed(2)} USD` +
      (totalDOP > 0 ? ` / RD$${totalDOP.toLocaleString('en-US',{maximumFractionDigits:0})} DOP\n` : '\n') +
      `  Invoices: ${empInvoices.length}\n\n` +
      `Please reach out if you have any questions.\n\n${settings.emailSignature || companyName}`
  }
  const attachment = await htmlToPdfAttachment(
    `${(emp.name || 'employee').replace(/\s+/g, '-').toLowerCase()}-statement.pdf`,
    buildPayslipHTML(emp, empInvoices, dateFrom, dateTo, settings),
  )
  return sendEmail(emp.email || '', subject, bodyText, { attachments: [attachment], cc: emp.ccEmails || [] })
}

function getEmployeePaymentRecord(inv: Invoice, emp: Employee) {
  return inv.employeePayments?.[emp.id] || inv.employeePayments?.[emp.name]
}

function EmployeeStatementsPanel({ emp, invoices, onInvoicesChange }: {
  emp: Employee
  invoices: Invoice[]
  onInvoicesChange: (updated: Invoice[]) => void
}) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewInvoices, setPreviewInvoices] = useState<Invoice[]>([])

  const empInvoices = getEmployeeInvoices(emp, invoices, dateFrom || undefined, dateTo || undefined)
  // Pay rate can differ per project, so the statement reports the rates that
  // were actually applied over the period rather than the employee default.
  const statementRates = distinctPayRates(empInvoices.flatMap(inv => getEmployeeInvoiceItems(emp, inv)), emp)
  const payRateLabel = formatPayRateLabel(statementRates)
  const premiumConfig = employeePremiumConfig(emp)
  const summary = summarizeEmployeeInvoices(emp, empInvoices)
  const totalHours = summary.hours
  const totalEarned = summary.totalPay

  const paidCount   = empInvoices.filter(inv => getEmployeePaymentRecord(inv, emp)?.status === 'paid').length
  const pendingCount = empInvoices.length - paidCount
  const totalPaid   = empInvoices.reduce((s, inv) => {
    if (getEmployeePaymentRecord(inv, emp)?.status !== 'paid') return s
    return s + getEmployeeInvoiceItems(emp, inv).reduce((itemTotal, item) => itemTotal + payrollFromInvoiceItem(item, emp).totalPay, 0)
  }, 0)

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3500)
  }

  function describeEmailResult(result: SendEmailResult, recipient: string) {
    if (result.mode === 'gmail') return `Statement sent to ${recipient} with PDF attached`
    const reason = result.fallbackReason ? ` Gmail fallback: ${result.fallbackReason}.` : ''
    return `Statement draft opened for ${recipient}. PDF downloaded to attach manually.${reason}`
  }

  function statementRecipient(): string {
    return emp.ccEmails?.length ? `${emp.email} (cc ${formatEmailList(emp.ccEmails)})` : emp.email || ''
  }

  function getEmpPayment(inv: Invoice) {
    return getEmployeePaymentRecord(inv, emp)
  }

  async function markPaid(inv: Invoice) {
    const payAmount = getEmployeeInvoiceItems(emp, inv).reduce((sum, item) => sum + payrollFromInvoiceItem(item, emp).totalPay, 0)
    const existingPayments = { ...(inv.employeePayments || {}) }
    if (emp.name in existingPayments && emp.id !== emp.name) delete existingPayments[emp.name]
    const updated = invoices.map(i => i.id === inv.id ? {
      ...i,
      employeePayments: {
        ...(i.id === inv.id ? existingPayments : i.employeePayments || {}),
        [emp.id]: { status: 'paid' as const, paidDate: new Date().toISOString().slice(0,10), amount: payAmount }
      }
    } : i)
    onInvoicesChange(updated)
    await saveInvoices(updated)
    showToast(`Marked ${inv.number} as paid`)
  }

  async function markPending(inv: Invoice) {
    const existingPayments = { ...(inv.employeePayments || {}) }
    if (emp.name in existingPayments && emp.id !== emp.name) delete existingPayments[emp.name]
    const updated = invoices.map(i => i.id === inv.id ? {
      ...i,
      employeePayments: {
        ...(i.id === inv.id ? existingPayments : i.employeePayments || {}),
        [emp.id]: { status: 'pending' as const }
      }
    } : i)
    onInvoicesChange(updated)
    await saveInvoices(updated)
    showToast(`Marked ${inv.number} as pending`)
  }

  async function handleStatementEmail(targetInvoices: Invoice[]) {
    if (!emp.email || targetInvoices.length === 0) return
    const result = await emailStatement(emp, targetInvoices, dateFrom, dateTo)
    showToast(describeEmailResult(result, statementRecipient()))
  }

  async function openStatementPreview(targetInvoices: Invoice[], title: string) {
    if (targetInvoices.length === 0) return
    const settings = await loadSettings()
    setPreviewInvoices(targetInvoices)
    setPreviewTitle(title)
    setPreviewHtml(buildPayslipHTML(emp, targetInvoices, dateFrom, dateTo, settings))
  }

  const byProject = new Map<string, { hours: number; earned: number }>()
  for (const inv of empInvoices) {
    const items = getEmployeeInvoiceItems(emp, inv)
    const projName = inv.projectName || 'No project'
    const pp = byProject.get(projName) || { hours: 0, earned: 0 }
    for (const it of items) {
      const payroll = payrollFromInvoiceItem(it, emp)
      pp.hours  += payroll.totalHours
      pp.earned += payroll.totalPay
    }
    byProject.set(projName, pp)
  }
  const projectTotals = Array.from(byProject.entries()).map(([name, pp]) => ({ name, ...pp }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Date range filter + action buttons */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">From</label>
          <input className="form-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">To</label>
          <input className="form-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {(dateFrom || dateTo) && (
          <button className="btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo('') }}>Clear</button>
        )}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="btn-ghost btn-sm" onClick={() => { void openStatementPreview(empInvoices, 'Statement') }} disabled={empInvoices.length === 0}>
            Preview
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => { void handleStatementEmail(empInvoices) }}
            disabled={empInvoices.length === 0 || !emp.email}
            title={!emp.email ? 'No email address on file — add one in the employee profile' : ''}
          >
            ✉ Email Statement
          </button>
          <button className="btn-ghost btn-sm" onClick={() => printPayslip(emp, empInvoices, dateFrom, dateTo)} disabled={empInvoices.length === 0}>
            ⎙ PDF Payslip
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="kpi-grid">
        <div className="settings-stat-card">
          <div className="settings-stat-count">{empInvoices.length}</div>
          <div className="settings-stat-label">Invoices</div>
        </div>
        <div className="settings-stat-card">
          <div className="settings-stat-count">{fmtHoursHM(totalHours)}</div>
          <div className="settings-stat-label">Total Hours</div>
        </div>
        <div className="settings-stat-card">
          <div className="settings-stat-count" style={{ fontSize: 15 }}>{payRateLabel}</div>
          <div className="settings-stat-label">Base Rate</div>
        </div>
        <div className="settings-stat-card">
          <div className="settings-stat-count" style={{ fontSize: 15 }}>{summary.premiumHours > 0 ? fmtHoursHM(summary.premiumHours) : '—'}</div>
          <div className="settings-stat-label">{summary.premiumHours > 0 ? `Premium Hrs (+${premiumConfig.percent}%)` : 'Premium Hrs'}</div>
        </div>
        <div className="settings-stat-card">
          <div className="settings-stat-count" style={{ fontSize: 15 }}>{formatMoney(totalEarned)}</div>
          <div className="settings-stat-label">Total Earned</div>
        </div>
        <div className="settings-stat-card" style={{ borderColor: paidCount > 0 ? 'var(--gold)' : undefined }}>
          <div className="settings-stat-count" style={{ fontSize: 15, color: paidCount > 0 ? 'var(--gold)' : undefined }}>{formatMoney(totalPaid)}</div>
          <div className="settings-stat-label">{paidCount} Paid</div>
        </div>
        <div className="settings-stat-card" style={{ borderColor: pendingCount > 0 ? 'var(--muted)' : undefined }}>
          <div className="settings-stat-count" style={{ fontSize: 15, color: pendingCount > 0 ? 'var(--muted)' : undefined }}>{pendingCount}</div>
          <div className="settings-stat-label">Pending</div>
        </div>
      </div>

      {empInvoices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: 13 }}>
          No invoices found for this period.
        </div>
      ) : (
        <>
          <div>
            {empInvoices.map(inv => {
              const items = getEmployeeInvoiceItems(emp, inv)
              const invoiceSummary = items.reduce((acc, item) => {
                const payroll = payrollFromInvoiceItem(item, emp)
                acc.hrs += payroll.totalHours
                acc.regular += payroll.regularHours
                acc.premium += payroll.premiumHours
                acc.earned += payroll.totalPay
                return acc
              }, { hrs: 0, regular: 0, premium: 0, earned: 0 })
              const hrs = invoiceSummary.hrs
              const invPeriod = inv.billingStart
                ? `${inv.billingStart}${inv.billingEnd ? ' – ' + inv.billingEnd : ''}`
                : (inv.date || '—')
              const daily = items[0]?.daily
              const DA = ['Su','Mo','Tu','We','Th','Fr','Sa']
              let allDates: string[] = []
              if (daily) {
                if (inv.billingStart && inv.billingEnd) {
                  const cur = new Date(inv.billingStart + 'T12:00:00')
                  const end = new Date(inv.billingEnd + 'T12:00:00')
                  while (cur <= end) { allDates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1) }
                } else {
                  allDates = Object.keys(daily).filter(d => parseInvoiceHours(daily[d]) > 0).sort()
                }
              }
              const payment = getEmpPayment(inv)
              const isPaid = payment?.status === 'paid'
              return (
                <div key={inv.id} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ background: 'var(--surf2)', padding: '7px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{inv.number}</strong>
                    <span style={{ color: 'var(--muted)' }}>·</span>
                    {inv.projectName || '—'}
                    <span style={{ color: 'var(--muted)' }}>·</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>{invPeriod}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(invoiceSummary.earned)}</span>
                      {isPaid ? (
                        <>
                          <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
                            ✓ Paid {payment?.paidDate ? new Date(payment.paidDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                          </span>
                          <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => { void openStatementPreview([inv], inv.number) }}>Preview</button>
                          <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => { void handleStatementEmail([inv]) }}>Email</button>
                          <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => markPending(inv)}>Undo</button>
                        </>
                      ) : (
                        <>
                          <button className="btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 10px', borderColor: 'var(--gold)', color: 'var(--gold)' }}
                            onClick={() => { void markPaid(inv) }}>
                            Mark as Paid
                          </button>
                          <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => { void openStatementPreview([inv], inv.number) }}>Preview</button>
                          <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => { void handleStatementEmail([inv]) }}>Email</button>
                        </>
                      )}
                    </span>
                  </div>
                  {invoiceSummary.premium > 0 && (
                    <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                      Premium split: {fmtHoursHM(invoiceSummary.regular)} regular + {fmtHoursHM(invoiceSummary.premium)} at +{premiumConfig.percent}% after {premiumConfig.startTime}
                    </div>
                  )}
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {allDates.map(d => {
                            const dt = new Date(d + 'T12:00:00')
                            return (
                              <th key={d} style={{ textAlign: 'center', fontSize: 9, minWidth: 24, whiteSpace: 'nowrap', padding: '5px 3px' }}>
                                {DA[dt.getDay()]}<br /><span style={{ color: 'var(--muted)' }}>{dt.getMonth()+1}/{dt.getDate()}</span>
                              </th>
                            )
                          })}
                          <th style={{ textAlign: 'right' }}>Hours</th>
                          <th style={{ textAlign: 'right' }}>Rate</th>
                          <th style={{ textAlign: 'right' }}>Earned</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {allDates.map(d => {
                            const h = daily ? parseInvoiceHours(daily[d] || '') : 0
                            return (
                              <td key={d} style={{ textAlign: 'center', fontSize: 12, color: h > 0 ? undefined : 'var(--muted)', padding: '7px 3px' }}>
                                {h > 0 ? formatInvoiceHoursEntry(h) : '—'}
                              </td>
                            )
                          })}
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtHoursHM(hrs)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{formatPayRateLabel(distinctPayRates(items, emp))}</td>
                          <td style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(invoiceSummary.earned)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
            <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 13, padding: '8px 4px', borderTop: '2px solid var(--border)', marginTop: 4 }}>
              Total &nbsp; {fmtHoursHM(totalHours)} &nbsp;&nbsp; {formatMoney(totalEarned)}
            </div>
          </div>

          {projectTotals.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>Totals by Project</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Project</th><th>Hours</th><th>Total Pay</th></tr></thead>
                  <tbody>
                    {projectTotals.map(pt => (
                      <tr key={pt.name}>
                        <td className="td-name">{pt.name}</td>
                        <td className="td-muted">{fmtHoursHM(pt.hours)}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(pt.earned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {previewHtml && (
        <div className="modal-overlay" onClick={() => setPreviewHtml(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '90vw', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ padding: '14px 20px' }}>
              <div>
                <h2 className="modal-title">Preview — {previewTitle}</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{emp.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-primary btn-sm" onClick={() => printPayslip(emp, previewInvoices, dateFrom, dateTo)}>Print / PDF</button>
                <button className="modal-close btn-icon" onClick={() => setPreviewHtml(null)}>✕</button>
              </div>
            </div>
            <iframe srcDoc={previewHtml} style={{ flex: 1, border: 'none', background: '#fff', minHeight: 500 }} title="Statement Preview" />
          </div>
        </div>
      )}

      {/* Mark as Paid modal */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
          background: '#1e293b', border: '1px solid var(--border)',
          borderLeft: '3px solid #4ade80',
          color: 'var(--text)', fontSize: 13, fontWeight: 500,
          padding: '10px 16px', borderRadius: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,.4)',
          maxWidth: 360,
        }}>
          ✓ {toast}
        </div>
      )}
    </div>
  )
}

export default function EmployeesPage() {
  const navigate = useNavigate()
  const { role } = useRole()
  const showPayRates = can.viewPayRates(role)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  useEffect(() => {
    loadSnapshot().then(snap => {
      setEmployees(snap.employees)
      setInvoices(snap.invoices)
      setProjects(snap.projects)
      setClients(snap.clients)
    })
  }, [])
  const [modal, setModal]       = useState<null | 'add' | 'edit' | 'statements'>(null)
  const [form, setForm]         = useState<FormData>(EMPTY)
  const [editId, setEditId]     = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedEmp, setSelectedEmp]   = useState<Employee | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [view, setView] = useState<'cards' | 'projects' | 'capacity' | 'table'>('projects')

  function persist(next: Employee[]) {
    setEmployees(next)
    void saveEmployees(next).catch((err) => {
      console.error('saveEmployees failed', err)
      alert(err instanceof Error ? err.message : 'Could not save team changes to Supabase.')
    })
  }

  function openAdd() { setForm({ ...EMPTY }); setAttachments([]); setEditId(null); setModal('add') }
  function openEdit(e: Employee) {
    setForm({
      name: e.name, email: e.email ?? '', ccEmails: formatEmailList(e.ccEmails), phone: e.phone ?? '',
      payRate: e.payRate != null ? String(e.payRate) : '',
      defaultShiftStart: e.defaultShiftStart || '',
      defaultShiftEnd: e.defaultShiftEnd || '',
      premiumEnabled: Boolean(e.premiumEnabled),
      premiumStartTime: e.premiumStartTime || '21:00',
      premiumPercent: e.premiumPercent != null ? String(e.premiumPercent) : '15',
      role: (e as { role?: string }).role ?? '',
      employmentType: (e as { employmentType?: string }).employmentType ?? '',
      location: (e as { location?: string }).location ?? '',
      timezone: e.timezone ?? '',
      startYear: e.startYear != null ? String(e.startYear) : '',
      status: e.status ?? 'Active',
      notes: (e as { notes?: string }).notes ?? '',
    })
    setAttachments(e.attachments || [])
    setEditId(e.id); setModal('edit')
  }

  function handleFileUpload(file: File) {
    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) { alert('File too large (max 5 MB). For videos, paste a link in Resume URL instead.'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const att: Attachment = {
        id: uid(), name: file.name, mimeType: file.type,
        size: file.size, dataUrl: ev.target?.result as string, uploadedAt: Date.now(),
      }
      setAttachments(prev => [...prev, att])
    }
    reader.readAsDataURL(file)
  }
  function openStatements(e: Employee) { setSelectedEmp(e); setModal('statements') }

  async function saveForm() {
    if (!form.name.trim()) return
    const cc = parseEmailList(form.ccEmails)
    if (cc.invalid.length > 0) {
      alert(`Invalid CC email${cc.invalid.length === 1 ? '' : 's'}: ${cc.invalid.join(', ')}`)
      return
    }
    const employeeData = {
      ...form,
      ccEmails: cc.emails.length ? cc.emails : undefined,
    }
    if (modal === 'add') {
      const empNum = await generateEmployeeNumber()
      persist([...employees, { ...employeeData, id: uid(), employeeNumber: empNum, attachments } as Employee])
    } else if (editId) {
      persist(employees.map((e) => e.id === editId ? { ...e, ...employeeData, attachments } : e))
    }
    setModal(null)
  }
  function doDelete(id: string) { persist(employees.filter((e) => e.id !== id)); setConfirmDelete(null) }

  const filtered = employees.filter((e) => {
    const matchSearch = `${e.name} ${e.email ?? ''} ${(e as {role?:string}).role ?? ''}`.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus || (e.status || 'Active') === filterStatus
    return matchSearch && matchStatus
  })

  const activeMemberCount = filtered.filter((employee) => (employee.status || 'Active').toLowerCase() === 'active').length
  const onboardingCount = filtered.filter((employee) => ['onboarding', 'trial'].includes((employee.status || '').toLowerCase())).length
  const assignedMemberCount = filtered.filter((employee) => projects.some((project) => (project.employeeIds || []).includes(employee.id))).length
  const unassignedMemberCount = filtered.length - assignedMemberCount
  const editSheetOpen = modal === 'add' || modal === 'edit'
  const filterCounts = useMemo(() => ({
    all: employees.length,
    active: employees.filter(employee => (employee.status || '').toLowerCase() === 'active').length,
    trial: employees.filter(employee => (employee.status || '').toLowerCase() === 'trial').length,
    onboarding: employees.filter(employee => (employee.status || '').toLowerCase() === 'onboarding').length,
    'on hold': employees.filter(employee => (employee.status || '').toLowerCase() === 'on hold').length,
  }), [employees])
  const currentMonth = useMemo(() => getCurrentMonthBounds(), [])
  const normalizedEmployees = useMemo(() => filtered.map(employee => {
    const empInvoices = invoices.filter(inv =>
      invoiceOverlapsRange(inv, currentMonth.from, currentMonth.to) &&
      (inv.items || []).some(item =>
        itemBelongsToEmployee(item, employee),
      ),
    )
    const summary = summarizeEmployeeInvoices(employee, empInvoices)
    const assignedProjects = projects.filter(project => (project.employeeIds || []).includes(employee.id))
    return {
      ...employee,
      color: colorFromString(employee.name),
      roleLabel: (employee as { role?: string }).role || 'No role',
      typeLabel: (employee as { employmentType?: string }).employmentType || 'Unspecified',
      locationLabel: (employee as { location?: string }).location || 'Remote',
      hoursMtd: summary.hours,
      earned: summary.totalPay,
      projectsList: assignedProjects,
      projectNames: assignedProjects.map(project => project.name),
      projectIdsList: assignedProjects.map(project => project.id),
    }
  }), [currentMonth.from, currentMonth.to, filtered, invoices, projects])
  const totalHoursLogged = Math.round(normalizedEmployees.reduce((sum, employee) => sum + employee.hoursMtd, 0))
  const totalPayrollMtd = normalizedEmployees.reduce((sum, employee) => sum + employee.earned, 0)
  const projectColumns = useMemo(() => ([
    {
      id: '__unassigned',
      label: 'Unassigned',
      accent: '#6b7280',
      clientName: '',
      rate: 0,
      stage: '',
      items: normalizedEmployees.filter(employee => employee.projectIdsList.length === 0),
      isPseudo: true,
    },
    ...projects
      .filter(project => (project.status || '').toLowerCase() !== 'completed')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(project => ({
        id: project.id,
        label: project.name,
        accent: projectAccent(project.status),
        clientName: clients.find(client => client.id === project.clientId)?.company || clients.find(client => client.id === project.clientId)?.name || '',
        rate: Number(project.rate) || 0,
        stage: project.status || '',
        items: normalizedEmployees.filter(employee => employee.projectIdsList.includes(project.id)),
        isPseudo: false,
      })),
  ]), [clients, normalizedEmployees, projects])
  const dnd = useKanbanDnd(normalizedEmployees, (updater) => {
    const next = typeof updater === 'function' ? updater(normalizedEmployees) : updater
    const employeeIdToProjects = new Map(next.map(employee => [employee.id, employee.projectIdsList]))
    const updatedProjects = projects.map(project => ({
      ...project,
      employeeIds: (project.employeeIds || []).filter(id => {
        const assigned = employeeIdToProjects.get(id)
        return assigned ? assigned.includes(project.id) : false
      }).concat(
        next.filter(employee => employee.projectIdsList.includes(project.id)).map(employee => employee.id).filter((value, index, array) => array.indexOf(value) === index)
      ),
    }))
    setProjects(updatedProjects)
    void saveProjects(updatedProjects)
  }, (employee, newColumnId, sourceColumnId) => {
    let nextProjectIds = [...employee.projectIdsList]
    if (sourceColumnId && sourceColumnId !== '__unassigned') nextProjectIds = nextProjectIds.filter(id => id !== sourceColumnId)
    if (newColumnId === '__unassigned') nextProjectIds = []
    if (newColumnId !== '__unassigned' && !nextProjectIds.includes(newColumnId)) nextProjectIds.push(newColumnId)
    return { ...employee, projectIdsList: nextProjectIds }
  })

  function exportTeamCsv() {
    const rows = [
      ['Name', 'Employee Number', 'Role', 'Status', 'Location', 'Rate', 'Hours MTD', 'Earned MTD', 'Projects'],
      ...normalizedEmployees.map(employee => [
        employee.name,
        employee.employeeNumber || '',
        employee.roleLabel,
        employee.status || '',
        employee.locationLabel,
        showPayRates ? String(employee.payRate || '') : '',
        String(employee.hoursMtd || 0),
        showPayRates ? String(employee.earned || 0) : '',
        employee.projectNames.join(' | '),
      ]),
    ]
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `team-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function renderEmployeeCard(employee: typeof normalizedEmployees[number], key?: string) {
    const utilization = Math.min(120, Math.round(((employee.hoursMtd || 0) / 160) * 100))
    return (
      <div key={key || employee.id} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }} onClick={() => navigate('/employees/' + employee.id)}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Avatar name={employee.name} color={employee.color} size="lg" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <StatusChip status={(employee.status || 'active').toLowerCase()} filled />
              <span className="proto-mono" style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 700 }}>{employee.employeeNumber || '—'}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.005em' }}>{employee.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{employee.roleLabel} · {employee.typeLabel}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
            <span>{employee.locationLabel}</span>
            <span style={{ color: 'var(--dim)' }}>·</span>
            <span>{employee.projectIdsList.length} project{employee.projectIdsList.length === 1 ? '' : 's'}</span>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="proto-eyebrow">Utilization</span>
              <span className="proto-mono" style={{ fontSize: 10.5, fontWeight: 700, color: utilization > 100 ? '#fb923c' : 'var(--text-soft)' }}>{Math.round(employee.hoursMtd)}h · {utilization}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--surf2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, utilization)}%`, height: '100%', background: utilization > 100 ? '#fb923c' : 'var(--gold)' }} />
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border)', background: 'var(--surf2)' }}>
          <div style={{ padding: 10, borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div className="proto-eyebrow">Rate</div>
            <div className="proto-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{showPayRates && employee.payRate ? protoCurrency(Number(employee.payRate)) + '/h' : '—'}</div>
          </div>
          <div style={{ padding: 10, textAlign: 'center' }}>
            <div className="proto-eyebrow">Earned</div>
            <div className="proto-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', marginTop: 2 }}>{showPayRates ? protoCurrency(employee.earned) : '—'}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row">
          <div>
            <div className="proto-eyebrow" style={{ color: 'var(--gold)', marginBottom: 8 }}>People · Team</div>
            <h1 className="page-title">Team</h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6, fontWeight: 500 }}>
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>{employees.length}</span> employees · {activeMemberCount} active · {totalHoursLogged.toLocaleString()} hours logged this month
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="proto-btn" onClick={exportTeamCsv}>
              <ProtoIcon name="download" size={13} />
              Export
            </button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={openAdd}>
              <ProtoIcon name="plus" size={13} />
              ADD EMPLOYEE
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <FilterChips
            value={filterStatus || 'all'}
            onChange={(value) => setFilterStatus(value === 'all' ? '' : value)}
            options={[
              { id: 'all', label: 'All', count: filterCounts.all },
              { id: 'active', label: 'Active', count: filterCounts.active },
              { id: 'trial', label: 'Trial', count: filterCounts.trial },
              { id: 'onboarding', label: 'Onboarding', count: filterCounts.onboarding },
              { id: 'on hold', label: 'On hold', count: filterCounts['on hold'] },
            ]}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SearchField value={search} onChange={setSearch} placeholder="Search team…" minWidth={220} />
            <ToggleGroup
              value={view}
              onChange={setView}
              options={[
                { id: 'cards', label: 'Cards' },
                { id: 'projects', label: 'By Project' },
                { id: 'capacity', label: 'Capacity' },
                { id: 'table', label: 'Table' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="proto-page-body">
        {view === 'cards' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {normalizedEmployees.map(employee => renderEmployeeCard(employee))}
          </div>
        )}

        {view === 'projects' && (
          <div className="kanban" style={{ ['--kanban-cols' as never]: projectColumns.length }}>
            {projectColumns.map(column => {
              const totalHours = column.items.reduce((sum, employee) => sum + employee.hoursMtd, 0)
              const totalEarned = column.items.reduce((sum, employee) => sum + employee.earned, 0)
              return (
                <KanbanColumn
                  key={column.id}
                  column={{ id: column.id, label: column.label, items: column.items }}
                  dnd={dnd}
                  accent={column.accent}
                  headerRight={!column.isPseudo ? (
                    <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => navigate(`/projects/${column.id}`)} title="Open project">
                      <ProtoIcon name="arrowR" size={11} />
                    </button>
                  ) : undefined}
                >
                  {!column.isPseudo ? (
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{column.clientName || column.stage || 'Project'}</span>
                      <span className="proto-mono" style={{ color: 'var(--gold)' }}>{showPayRates && column.rate > 0 ? `${protoCurrency(column.rate)}/h` : '—'}</span>
                    </div>
                  ) : null}
                  {column.items.map(employee => (
                    <KanbanItem key={`${employee.id}-${column.id}`} item={employee} dnd={dnd} sourceColumnId={column.id} accent={employee.color} onClick={() => navigate(`/employees/${employee.id}`)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={employee.name} color={employee.color} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.name}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{employee.roleLabel}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)', marginTop: 8 }}>
                        <span className="proto-mono" style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{showPayRates && employee.payRate ? `${protoCurrency(Number(employee.payRate))}/h` : '—'}</span>
                        <span className="proto-mono" style={{ fontSize: 10, color: 'var(--text)', fontWeight: 700 }}>{Math.round(employee.hoursMtd)}h MTD</span>
                      </div>
                    </KanbanItem>
                  ))}
                  {!column.isPseudo && column.items.length > 0 ? (
                    <div style={{ marginTop: 'auto', padding: '6px 8px', borderRadius: 6, background: 'var(--surf2)', fontSize: 10.5, display: 'flex', justifyContent: 'space-between', color: 'var(--muted)' }} className="proto-mono">
                      <span>Total</span>
                      <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{Math.round(totalHours)}h{showPayRates ? ` · ${protoCurrency(totalEarned)}` : ''}</span>
                    </div>
                  ) : null}
                </KanbanColumn>
              )
            })}
          </div>
        )}

        {view === 'capacity' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div className="section-title">Hours Logged · {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
              <div style={{ display: 'flex', gap: 14, fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: 'var(--gold)', borderRadius: 2 }} /> ACTUAL</span>
                <span>TARGET: 160h / month</span>
              </div>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {normalizedEmployees.map(employee => {
                const pct = Math.min(1.2, employee.hoursMtd / 160)
                const overCapacity = employee.hoursMtd > 160
                return (
                  <div key={employee.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr 90px 110px', gap: 14, alignItems: 'center' }}>
                    <button type="button" className="proto-plain-button" onClick={() => navigate(`/employees/${employee.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                      <Avatar name={employee.name} color={employee.color} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{employee.roleLabel}</div>
                      </div>
                    </button>
                    <div style={{ position: 'relative', height: 18, background: 'var(--surf2)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(pct / 1.2) * 100}%`, height: '100%', background: overCapacity ? '#fb923c' : 'var(--gold)' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(1 / 1.2) * 100}%`, width: 1, background: 'var(--border-strong)' }} />
                      <span className="proto-mono" style={{ position: 'absolute', left: 8, top: 1, fontSize: 10.5, fontWeight: 700, color: '#0b1018' }}>{Math.round(employee.hoursMtd)}h</span>
                    </div>
                    <span className="proto-mono" style={{ fontSize: 11.5, color: overCapacity ? '#fb923c' : 'var(--text-soft)', fontWeight: 700, textAlign: 'right' }}>{Math.round(pct * 100)}%</span>
                    <span className="proto-mono" style={{ fontSize: 11.5, color: showPayRates ? 'var(--text)' : 'var(--dim)', fontWeight: 700, textAlign: 'right' }}>{showPayRates ? protoCurrency(employee.earned) : '—'}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11.5, flexWrap: 'wrap' }} className="proto-mono">
              <span style={{ color: 'var(--muted)' }}>Total hours: <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{totalHoursLogged.toLocaleString()}</span></span>
              <span style={{ color: 'var(--muted)' }}>Payroll: <span style={{ color: 'var(--text)', fontWeight: 700 }}>{showPayRates ? protoCurrency(totalPayrollMtd) : '—'}</span></span>
            </div>
          </div>
        )}

        {view === 'table' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="proto-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Number</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th style={{ textAlign: 'right' }}>Rate</th>
                  <th style={{ textAlign: 'right' }}>Hrs MTD</th>
                  <th style={{ textAlign: 'right' }}>Earned</th>
                </tr>
              </thead>
              <tbody>
                {normalizedEmployees.map(employee => (
                  <tr key={employee.id} onClick={() => navigate(`/employees/${employee.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={employee.name} color={employee.color} size="sm" />
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{employee.name}</span>
                      </div>
                    </td>
                    <td className="proto-mono" style={{ color: 'var(--muted)' }}>{employee.employeeNumber || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{employee.roleLabel}</td>
                    <td><StatusChip status={(employee.status || 'active').toLowerCase()} /></td>
                    <td style={{ color: 'var(--muted)' }}>{employee.locationLabel}</td>
                    <td className="proto-mono" style={{ textAlign: 'right', color: showPayRates ? 'var(--text)' : 'var(--dim)', fontWeight: 700 }}>{showPayRates && employee.payRate ? protoCurrency(Number(employee.payRate)) : '—'}</td>
                    <td className="proto-mono" style={{ textAlign: 'right', color: 'var(--text)' }}>{Math.round(employee.hoursMtd)}</td>
                    <td className="proto-mono" style={{ textAlign: 'right', color: showPayRates ? 'var(--gold)' : 'var(--dim)', fontWeight: 700 }}>{showPayRates ? protoCurrency(employee.earned) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {normalizedEmployees.length === 0 && (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
            {search || filterStatus ? 'No team members match these filters.' : 'No team members yet.'}
          </div>
        )}
      </div>

      {/* Statements Modal */}
      {modal === 'statements' && selectedEmp && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="avatar-sm" style={{ background: avatarColor(selectedEmp.name) }}>{initials(selectedEmp.name)}</div>
                <div>
                  <h2 className="modal-title">{selectedEmp.name} — Statements</h2>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {selectedEmp.employeeNumber && `${selectedEmp.employeeNumber} · `}
                    {selectedEmp.payRate ? `$${selectedEmp.payRate}/hr` : 'No pay rate set'}
                  </div>
                </div>
              </div>
              <button className="modal-close btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <EmployeeStatementsPanel emp={selectedEmp} invoices={invoices} onInvoicesChange={setInvoices} />
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {editSheetOpen && (
        <div className="sheet-overlay" onClick={() => setModal(null)}>
          <aside className="sheet-panel" onClick={(ev) => ev.stopPropagation()}>
            <div className="sheet-header">
              <div>
                <div className="sheet-eyebrow">Team Workspace</div>
                <h2 className="sheet-title">{modal === 'add' ? 'Add Team Member' : 'Edit Member'}</h2>
                <p className="sheet-subtitle">Manage staffing details, compensation rules, and supporting documents without leaving the board.</p>
              </div>
              <button className="modal-close btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="sheet-body">
              <div className="sheet-section">
                <div className="sheet-section-title">Identity</div>
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Full Name *</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label className="form-label">Role / Position</label>
                  <input className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Intake Specialist" />
                </div>
                <div className="form-group">
                  <label className="form-label">Employment Type</label>
                  <select className="form-select" value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
                    {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t || '— Not set —'}</option>)}
                  </select>
                </div>
                {showPayRates && (
                  <div className="form-group">
                    <label className="form-label">Pay Rate ($/hr)</label>
                    <input className="form-input" type="number" value={form.payRate} onChange={(e) => setForm({ ...form, payRate: e.target.value })} placeholder="4.50" />
                  </div>
                )}
                {showPayRates && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Default Shift Start</label>
                      <input
                        className="form-input"
                        type="text"
                        value={form.defaultShiftStart}
                        onChange={(e) => setForm({ ...form, defaultShiftStart: e.target.value })}
                        onBlur={(e) => setForm({ ...form, defaultShiftStart: normalizeClockInput(e.target.value) })}
                        placeholder="4:00 pm"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Default Shift End</label>
                      <input
                        className="form-input"
                        type="text"
                        value={form.defaultShiftEnd}
                        onChange={(e) => setForm({ ...form, defaultShiftEnd: e.target.value })}
                        onBlur={(e) => setForm({ ...form, defaultShiftEnd: normalizeClockInput(e.target.value) })}
                        placeholder="12:00 am"
                      />
                    </div>
                  </>
                )}
                {showPayRates && (
                  <div className="form-group">
                    <label className="form-label">Premium Rule</label>
                    <select className="form-select" value={form.premiumEnabled ? 'night' : ''} onChange={(e) => setForm({ ...form, premiumEnabled: e.target.value === 'night' })}>
                      <option value="">No premium pay</option>
                      <option value="night">Night shift premium</option>
                    </select>
                  </div>
                )}
                {showPayRates && form.premiumEnabled && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Premium Starts At</label>
                      <input
                        className="form-input"
                        type="text"
                        value={form.premiumStartTime}
                        onChange={(e) => setForm({ ...form, premiumStartTime: e.target.value })}
                        onBlur={(e) => setForm({ ...form, premiumStartTime: normalizeClockInput(e.target.value) || '21:00' })}
                        placeholder="9:00 pm"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Premium Increase %</label>
                      <input className="form-input" type="number" value={form.premiumPercent} onChange={(e) => setForm({ ...form, premiumPercent: e.target.value })} placeholder="15" />
                    </div>
                  </>
                )}
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">CC Emails</label>
                  <input className="form-input" value={form.ccEmails} onChange={(e) => setForm({ ...form, ccEmails: e.target.value })} placeholder="payroll@yvastaffing.net, manager@example.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Location</label>
                  <input className="form-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Santo Domingo, DO" />
                </div>
                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <input className="form-input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="EST / AST" />
                </div>
                <div className="form-group">
                  <label className="form-label">Hire Year</label>
                  <input className="form-input" value={form.startYear} onChange={(e) => setForm({ ...form, startYear: e.target.value })} placeholder="2025" />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Internal Notes</label>
                  <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Performance notes, schedule preferences, etc." />
                </div>
              </div>
              </div>
              {modal === 'add' && (
                <div className="board-summary-note">
                  Employee number will be auto-assigned (e.g. YVA25001) on save.
                </div>
              )}
              {showPayRates && form.premiumEnabled && (
                <div className="board-summary-note">
                  Example: a 4:00 pm to 12:00 am shift with a {form.premiumPercent || '15'}% premium starting at {form.premiumStartTime || '21:00'} will split 5 regular hours and 3 premium hours automatically.
                </div>
              )}
              {showPayRates && (form.defaultShiftStart || form.defaultShiftEnd) && (
                <div className="board-summary-note">
                  Saved schedule: {form.defaultShiftStart || '—'} to {form.defaultShiftEnd || '—'}. Invoice rows for this employee will auto-fill these times.
                </div>
              )}

              {/* Attachments */}
              <div className="sheet-section">
                <div className="sheet-section-title">Files &amp; Documents</div>
              <div style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>
                    Files &amp; Documents {attachments.length > 0 && `(${attachments.length})`}
                  </div>
                  <button className="btn-ghost btn-xs" onClick={() => fileInputRef.current?.click()}>+ Upload</button>
                  <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
                </div>
                {attachments.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No files. Accepts images, PDFs, audio (max 5 MB each). For videos use a URL link.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {attachments.map(att => (
                      <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px' }}>
                        <span style={{ fontSize: 16 }}>{att.mimeType.startsWith('image/') ? '🖼' : att.mimeType === 'application/pdf' ? '📄' : att.mimeType.startsWith('audio/') ? '🎵' : '📎'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{(att.size / 1024).toFixed(0)} KB</div>
                        </div>
                        {att.mimeType.startsWith('audio/') && (
                          <audio controls src={att.dataUrl} style={{ height: 28, maxWidth: 160 }} />
                        )}
                        {att.mimeType.startsWith('image/') && (
                          <img src={att.dataUrl} alt={att.name} style={{ height: 36, width: 36, objectFit: 'cover', borderRadius: 4 }} />
                        )}
                        <a href={att.dataUrl} download={att.name} className="btn-ghost btn-xs">↓</a>
                        <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </div>
            <div className="sheet-footer">
              <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveForm} disabled={!form.name.trim()}>
                {modal === 'add' ? 'Add Member' : 'Save Changes'}
              </button>
            </div>
          </aside>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Remove team member?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => doDelete(confirmDelete)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
