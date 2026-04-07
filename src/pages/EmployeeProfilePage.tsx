import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Attachment, Employee, Invoice, Project } from '../data/types'
import { loadSnapshot, saveEmployees, saveInvoices, loadSettings } from '../services/storage'
import { uploadFile, deleteFile } from '../services/fileStorage'
import { sendEmail, type SendEmailResult } from '../services/gmail'
import { formatMoney, fmtHoursHM } from '../utils/money'
import { htmlToPdfAttachment } from '../utils/pdf'
import { employeePremiumConfig, normalizeClockInput, payrollFromInvoiceItem } from '../utils/payroll'

function uid() { return crypto.randomUUID() }

const VIDEO_EXTS = ['mp4','mov','avi','webm','mkv','m4v','wmv','3gp']
const AUDIO_EXTS = ['mp3','wav','ogg','m4a','aac','flac','wma']
function fileExt(name: string) { return name.split('.').pop()?.toLowerCase() ?? '' }
function isVideo(att: Attachment) { return att.mimeType.startsWith('video') || VIDEO_EXTS.includes(fileExt(att.name)) }
function isAudio(att: Attachment) { return att.mimeType.startsWith('audio') || AUDIO_EXTS.includes(fileExt(att.name)) }
function attIcon(att: Attachment) {
  if (att.mimeType.startsWith('image')) return '🖼'
  if (isVideo(att)) return '🎬'
  if (isAudio(att)) return '🎵'
  return '📄'
}

function VideoPlayer({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])
  async function load() {
    setLoading(true)
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      setBlobUrl(URL.createObjectURL(blob))
    } catch { /* ignore */ } finally { setLoading(false) }
  }
  if (blobUrl) return <video controls autoPlay src={blobUrl} style={{ width: '100%', maxHeight: 220, borderRadius: 6, marginTop: 4 }} />
  return (
    <button onClick={load} disabled={loading} style={{ marginTop: 4, width: '100%', background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px', color: 'var(--muted)', cursor: loading ? 'wait' : 'pointer', fontSize: 13 }}>
      {loading ? 'Loading video…' : '▶ Click to load video'}
    </button>
  )
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
    case 'inactive':   return 'badge-red'
    case 'on hold':    return 'badge-yellow'
    case 'onboarding': return 'badge-blue'
    case 'trial':      return 'badge-purple'
    default:           return 'badge-green'
  }
}

const STATUS_OPTIONS = ['Active', 'Onboarding', 'Trial', 'On hold', 'Inactive']
const TYPE_OPTIONS   = ['', 'Full-time', 'Part-time', 'Project-based']

function getEmpInvoices(name: string, invoices: Invoice[], from?: string, to?: string) {
  return invoices.filter(inv => {
    const has = (inv.items || []).some(it => it.employeeName?.toLowerCase() === name.toLowerCase())
    if (!has) return false
    const d = inv.date || inv.billingEnd || inv.billingStart
    if (!d) return true
    if (from && d < from) return false
    if (to   && d > to)   return false
    return true
  }).sort(compareInvoicesDesc)
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

function getEmployeePaymentRecord(inv: Invoice, emp: Employee) {
  return inv.employeePayments?.[emp.id] || inv.employeePayments?.[emp.name]
}

function getEmployeeInvoiceItems(emp: Employee, inv: Invoice) {
  return (inv.items || []).filter(it =>
    (it.employeeId && it.employeeId === emp.id) ||
    it.employeeName?.toLowerCase() === emp.name.toLowerCase()
  )
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
  const payRate  = Number(emp.payRate) || 0
  const premiumConfig = employeePremiumConfig(emp)
  const dopRate  = settings.usdToDop || 0
  const summary = summarizeEmployeeInvoices(emp, empInvoices)
  const totalHours = summary.hours
  const totalUSD = summary.totalPay
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0
  function ph(v: string): number {
    if (!v) return 0; const s = v.trim().replace(',','.')
    if (s.includes(':')) { const [h,m]=s.split(':'); return (parseInt(h)||0)+(parseInt(m)||0)/60 }
    return parseFloat(s)||0
  }
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
        allDates = Object.keys(daily).filter(d=>ph(daily[d])>0).sort()
      }
    }
    const label = '<div style="font-size:11px;margin-bottom:6px"><strong style="font-size:13px">'+inv.number+'</strong>&nbsp;&middot;&nbsp;'+(inv.projectName||'—')+'&nbsp;&middot;&nbsp;<span style="color:#999">'+invPeriod+'</span></div>'
    if (allDates.length > 0 && daily) {
      const dateHeaders = allDates.map(d=>{const dt=new Date(d+'T12:00:00');return '<th style="text-align:center;font-size:9px;padding:5px 3px;min-width:22px;color:#999;border-bottom:2px solid #eee;white-space:nowrap">'+DA[dt.getDay()]+'<br>'+(dt.getMonth()+1)+'/'+dt.getDate()+'</th>'}).join('')
      const dayCells = allDates.map(d=>{const h=ph(daily[d]||'');return '<td style="text-align:center;padding:7px 4px;font-size:12px;color:'+(h>0?'#111':'#ccc')+'">'+(h>0?(h%1===0?String(h):h.toFixed(1)):'—')+'</td>'}).join('')
      return label+'<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr>'+dateHeaders+'<th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">HOURS</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">RATE</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">EARNED</th></tr></thead><tbody><tr>'+dayCells+'<td style="text-align:right;font-weight:700;padding:8px 6px">'+hrs.toFixed(1)+'h</td><td style="text-align:right;color:#999;padding:8px 6px">'+(payRate>0?'$'+payRate+'/hr':'—')+'</td><td style="text-align:right;font-weight:700;color:#f5b533;padding:8px 6px">'+(earned>0?'$'+earned.toFixed(2):'—')+'</td></tr></tbody></table>' + (invoiceSummary.premium > 0 ? '<div style="font-size:11px;color:#666;margin-top:-10px;margin-bottom:14px">Premium split: '+invoiceSummary.regular.toFixed(2)+'h regular + '+invoiceSummary.premium.toFixed(2)+'h at +'+premiumConfig.percent+'%</div>' : '')
    } else {
      return label+'<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr><th style="font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">HOURS</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">RATE</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">EARNED</th></tr></thead><tbody><tr><td style="font-weight:700;padding:8px 6px">'+hrs.toFixed(1)+'h</td><td style="text-align:right;color:#999;padding:8px 6px">'+(payRate>0?'$'+payRate+'/hr':'—')+'</td><td style="text-align:right;font-weight:700;color:#f5b533;padding:8px 6px">'+(earned>0?'$'+earned.toFixed(2):'—')+'</td></tr></tbody></table>' + (invoiceSummary.premium > 0 ? '<div style="font-size:11px;color:#666;margin-top:-10px;margin-bottom:14px">Premium split: '+invoiceSummary.regular.toFixed(2)+'h regular + '+invoiceSummary.premium.toFixed(2)+'h at +'+premiumConfig.percent+'%</div>' : '')
    }
  }).join('<hr style="border:none;border-top:1px solid #eee;margin:0 0 16px">')

  const period   = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  return `<!DOCTYPE html><html><head><title>Statement — ${emp.name}</title><style>@page{size:Letter;margin:.5in}body{font-family:Arial,sans-serif;width:7.5in;min-height:10in;margin:0 auto;color:#111}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid #f5b533;padding-bottom:16px}.logo{height:48px}h2{margin:0;font-size:22px;color:#f5b533}.meta{font-size:12px;color:#999;margin-top:4px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.kpi{background:#f9f9f9;border-radius:8px;padding:14px;text-align:center}.kpi-v{font-size:20px;font-weight:800;color:#111}.kpi-l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999;padding:8px 8px;border-bottom:2px solid #eee}td{padding:8px;border-bottom:1px solid #eee}.footer{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;text-align:center}@media print{body{margin:0 auto}}</style></head><body><div class="header"><img src="${window.location.origin}/yva-logo.png" class="logo" onerror="this.style.display='none'" /><div style="text-align:right"><h2>EARNINGS STATEMENT</h2><div class="meta">${emp.name}${emp.employeeNumber?` · ${emp.employeeNumber}`:''}</div><div class="meta">Period: ${period}</div><div class="meta">Generated: ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div></div></div><div class="kpis"><div class="kpi"><div class="kpi-v">${empInvoices.length}</div><div class="kpi-l">Invoices</div></div><div class="kpi"><div class="kpi-v">${totalHours.toFixed(1)}h</div><div class="kpi-l">Total Hours</div></div><div class="kpi"><div class="kpi-v">${payRate>0?'$'+payRate+'/hr':'—'}</div><div class="kpi-l">Base Rate</div></div>${summary.premiumHours>0?`<div class="kpi"><div class="kpi-v">${summary.premiumHours.toFixed(1)}h</div><div class="kpi-l">Premium Hours (+${premiumConfig.percent}%)</div></div>`:''}<div class="kpi"><div class="kpi-v">${payRate>0?'$'+totalUSD.toFixed(2):'—'}</div><div class="kpi-l">Total Earned (USD)</div></div>${totalDOP>0?`<div class="kpi"><div class="kpi-v">RD$${totalDOP.toLocaleString('en-US',{maximumFractionDigits:0})}</div><div class="kpi-l">Total Earned (DOP @ ${dopRate})</div></div>`:''}</div>${sections?sections+'<div style="text-align:right;font-weight:800;font-size:13px;padding:10px 0;border-top:2px solid #111;margin-top:4px">Total &nbsp;&nbsp; '+totalHours.toFixed(1)+'h &nbsp;&nbsp; '+(payRate>0?'$'+totalUSD.toFixed(2):'—')+'</div>'+(summary.premiumHours>0?'<div style="text-align:right;font-size:11px;color:#666">Regular: '+summary.regularHours.toFixed(2)+'h · Premium: '+summary.premiumHours.toFixed(2)+'h at +'+premiumConfig.percent+'%</div>':''):'<p style="color:#999;text-align:center;padding:24px">No invoice data for this period.</p>'}<div class="footer">YVA Staffing · Bilingual Virtual Professionals · yvastaffing.net</div></body></html>`
}

async function emailStatement(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const dopRate  = settings.usdToDop || 0
  const summary = summarizeEmployeeInvoices(emp, empInvoices)
  const totalHours = summary.hours
  const totalUSD = summary.totalPay
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0
  const period   = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  const companyName = settings.companyName || 'YVA Staffing'
  const subject  = `Your Earnings Statement — ${period} — ${companyName}`
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
  return sendEmail(emp.email || '', subject, bodyText, { attachments: [attachment] })
}

async function printPayslip(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(buildPayslipHTML(emp, empInvoices, dateFrom, dateTo, settings).replace('</body></html>', '<script>window.onload=function(){window.print()}</script></body></html>'))
  win.document.close()
}

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [employees, setEmployeesState] = useState<Employee[]>([])
  const [invoices,  setInvoices]        = useState<Invoice[]>([])
  const [projects,  setProjects]        = useState<Project[]>([])
  useEffect(() => {
    loadSnapshot().then(snap => {
      setEmployeesState(snap.employees)
      setInvoices(snap.invoices)
      setProjects(snap.projects)
    })
  }, [])

  const emp = employees.find(e => e.id === id)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', payRate: '', defaultShiftStart: '', defaultShiftEnd: '', premiumEnabled: false, premiumStartTime: '21:00', premiumPercent: '15', role: '',
    employmentType: '', location: '', timezone: '', startYear: '', status: 'Active', notes: '',
  })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined)

  // Sync form/attachments/photo from emp once data loads
  useEffect(() => {
    if (emp && !editing) {
      setForm({
        name:           emp.name ?? '',
        email:          emp.email ?? '',
        phone:          emp.phone ?? '',
        payRate:        emp.payRate != null ? String(emp.payRate) : '',
        defaultShiftStart: emp.defaultShiftStart ?? '',
        defaultShiftEnd: emp.defaultShiftEnd ?? '',
        premiumEnabled: Boolean(emp.premiumEnabled),
        premiumStartTime: emp.premiumStartTime ?? '21:00',
        premiumPercent: emp.premiumPercent != null ? String(emp.premiumPercent) : '15',
        role:           emp.role ?? '',
        employmentType: emp.employmentType ?? '',
        location:       emp.location ?? '',
        timezone:       emp.timezone ?? '',
        startYear:      emp.startYear != null ? String(emp.startYear) : '',
        status:         emp.status ?? 'Active',
        notes:          emp.notes ?? '',
      })
      setAttachments(emp.attachments ?? [])
      setPhotoUrl(emp.photoUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp?.id])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Statements state
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [toast, setToast] = useState<string | null>(null)

  if (!emp) {
    return (
      <div className="page-wrap">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          Employee not found.
          <br /><button className="btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/employees')}>← Back to Team</button>
        </div>
      </div>
    )
  }

  // emp is guaranteed non-null here (early return above handles null case)
  const empNN = emp!

  const empInvoices = getEmpInvoices(empNN.name, invoices, dateFrom || undefined, dateTo || undefined)
  const payRate     = Number(empNN.payRate) || 0
  const premiumConfig = employeePremiumConfig(empNN)
  const summary = summarizeEmployeeInvoices(empNN, empInvoices)
  const totalHours  = summary.hours
  const totalEarned  = summary.totalPay
  const paidCount    = empInvoices.filter(inv => getEmployeePaymentRecord(inv, empNN)?.status === 'paid').length
  const pendingCount = empInvoices.length - paidCount
  const totalPaid    = empInvoices.reduce((s, inv) => {
    if (getEmployeePaymentRecord(inv, empNN)?.status !== 'paid') return s
    return s + getEmployeeInvoiceItems(empNN, inv).reduce((itemTotal, item) => itemTotal + payrollFromInvoiceItem(item, empNN).totalPay, 0)
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

  async function markPaid(inv: Invoice) {
    const payAmount = getEmployeeInvoiceItems(empNN, inv).reduce((sum, item) => sum + payrollFromInvoiceItem(item, empNN).totalPay, 0)
    const existingPayments = { ...(inv.employeePayments || {}) }
    if (empNN.name in existingPayments && empNN.id !== empNN.name) delete existingPayments[empNN.name]
    const updated = invoices.map(i => i.id === inv.id ? {
      ...i,
      employeePayments: {
        ...(i.id === inv.id ? existingPayments : i.employeePayments || {}),
        [empNN.id]: { status: 'paid' as const, paidDate: new Date().toISOString().slice(0,10), amount: payAmount }
      }
    } : i)
    setInvoices(updated)
    await saveInvoices(updated)
    showToast(`Marked ${inv.number} as paid`)
  }

  async function markPending(inv: Invoice) {
    const existingPayments = { ...(inv.employeePayments || {}) }
    if (empNN.name in existingPayments && empNN.id !== empNN.name) delete existingPayments[empNN.name]
    const updated = invoices.map(i => i.id === inv.id ? {
      ...i,
      employeePayments: { ...(i.id === inv.id ? existingPayments : i.employeePayments || {}), [empNN.id]: { status: 'pending' as const } }
    } : i)
    setInvoices(updated)
    await saveInvoices(updated)
    showToast(`Marked ${inv.number} as pending`)
  }

  async function handleStatementEmail(targetInvoices: Invoice[]) {
    if (!empNN.email || targetInvoices.length === 0) return
    const result = await emailStatement(empNN, targetInvoices, dateFrom, dateTo)
    showToast(describeEmailResult(result, empNN.email))
  }

  const assignedProjects = projects.filter(p => (p.employeeIds || []).includes(empNN.id))

  async function persistUpdate(updated: Employee) {
    const next = employees.map(e => e.id === updated.id ? updated : e)
    setEmployeesState(next)
    await saveEmployees(next)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    const updated: Employee = {
      ...empNN,
      name: form.name,
      email: form.email || undefined,
      phone: form.phone || undefined,
      payRate: form.payRate ? Number(form.payRate) : undefined,
      defaultShiftStart: form.defaultShiftStart || undefined,
      defaultShiftEnd: form.defaultShiftEnd || undefined,
      premiumEnabled: form.premiumEnabled || undefined,
      premiumStartTime: form.premiumEnabled ? (form.premiumStartTime || '21:00') : undefined,
      premiumPercent: form.premiumEnabled ? Number(form.premiumPercent || 0) : undefined,
      role: form.role || undefined,
      employmentType: form.employmentType || undefined,
      location: form.location || undefined,
      timezone: form.timezone || undefined,
      startYear: form.startYear ? Number(form.startYear) : undefined,
      status: form.status,
      notes: form.notes || undefined,
      photoUrl,
      attachments,
    }
    try {
      await persistUpdate(updated)
      setEditing(false)
      showToast('Employee profile saved')
    } catch (error) {
      console.error('Employee save failed', error)
      alert(error instanceof Error ? error.message : 'Employee profile could not be saved.')
    }
  }

  function handlePhotoUpload(file: File) {
    if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { alert('Image too large (max 5 MB).'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const url = ev.target?.result as string
      setPhotoUrl(url)
      void persistUpdate({ ...empNN, photoUrl: url, attachments }).catch(error => {
        console.error('Employee photo save failed', error)
        alert(error instanceof Error ? error.message : 'Employee photo could not be saved.')
      })
    }
    reader.readAsDataURL(file)
  }

  function handleCancel() {
    setForm({
      name: empNN.name,
      email: empNN.email ?? '',
      phone: empNN.phone ?? '',
      payRate: empNN.payRate != null ? String(empNN.payRate) : '',
      defaultShiftStart: empNN.defaultShiftStart ?? '',
      defaultShiftEnd: empNN.defaultShiftEnd ?? '',
      premiumEnabled: Boolean(empNN.premiumEnabled),
      premiumStartTime: empNN.premiumStartTime ?? '21:00',
      premiumPercent: empNN.premiumPercent != null ? String(empNN.premiumPercent) : '15',
      role: empNN.role ?? '',
      employmentType: empNN.employmentType ?? '',
      location: empNN.location ?? '',
      timezone: empNN.timezone ?? '',
      startYear: empNN.startYear != null ? String(empNN.startYear) : '',
      status: empNN.status ?? 'Active',
      notes: empNN.notes ?? '',
    })
    setAttachments(empNN.attachments ?? [])
    setEditing(false)
  }

  function handleDelete() {
    const next = employees.filter(e => e.id !== empNN.id)
    setEmployeesState(next)
    void saveEmployees(next)
    navigate('/employees')
  }

  async function downloadAttachment(url: string, name: string) {
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      // Force octet-stream so browser always downloads instead of previewing
      const forceBlob = new Blob([blob], { type: 'application/octet-stream' })
      const blobUrl = URL.createObjectURL(forceBlob)
      const a = document.createElement('a')
      a.href = blobUrl; a.download = name
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
    } catch { window.open(url, '_blank') }
  }

  function handleFileUpload(file: File) {
    if (file.size > 200 * 1024 * 1024) { alert('File too large (max 200 MB).'); return }
    void (async () => {
      try {
        const { storageUrl, storagePath } = await uploadFile(file, `employees/${empNN.id}`)
        const att: Attachment = {
          id: uid(), name: file.name, mimeType: file.type,
          size: file.size, dataUrl: storageUrl, storageUrl, storagePath, uploadedAt: Date.now(),
        }
        setAttachments(prev => {
          const next = [...prev, att]
          void persistUpdate({ ...empNN, attachments: next }).catch(error => {
            console.error('Employee attachment save failed', error)
            alert(error instanceof Error ? error.message : 'Attachment could not be saved.')
          })
          return next
        })
      } catch (e) {
        console.error('Upload failed', e)
        alert('Upload failed. Please try again.')
      }
    })()
  }

  function removeAttachment(attId: string) {
    const att = attachments.find(a => a.id === attId)
    if (att?.storagePath) void deleteFile(att.storagePath)
    setAttachments(prev => {
      const next = prev.filter(a => a.id !== attId)
      void persistUpdate({ ...empNN, attachments: next }).catch(error => {
        console.error('Employee attachment delete failed', error)
        alert(error instanceof Error ? error.message : 'Attachment could not be removed.')
      })
      return next
    })
  }

  const color = avatarColor(empNN.name)

  return (
    <div className="page-wrap" style={{ maxWidth: 900 }}>
      {/* Back */}
      <button className="btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/employees')}>
        ← Back to Team
      </button>

      {/* Profile header */}
      <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }} />

      <div className="profile-header">
        <div className="profile-header-left">
          <div className="avatar-wrap" title="Click to change photo" onClick={() => photoInputRef.current?.click()}>
            {photoUrl
              ? <img className="avatar-photo" src={photoUrl} alt={empNN.name} />
              : <div className="avatar profile-avatar" style={{ background: color }}>{initials(empNN.name)}</div>
            }
            <span className="avatar-cam">📷</span>
          </div>
          <div>
            {editing
              ? <input className="form-input profile-name-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              : <h1 className="profile-name">{empNN.name}</h1>
            }
            <div className="profile-sub">
              {empNN.employeeNumber && <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{empNN.employeeNumber}</span>}
              {empNN.employeeNumber && empNN.role && <span style={{ color: 'var(--muted)' }}> · </span>}
              {empNN.role && <span style={{ color: 'var(--muted)' }}>{empNN.role}</span>}
            </div>
          </div>
        </div>
        <div className="profile-header-actions">
          {editing ? (
            <>
              <button className="btn-primary btn-sm" onClick={handleSave} disabled={!form.name.trim()}>Save Changes</button>
              <button className="btn-ghost btn-sm" onClick={handleCancel}>Cancel</button>
            </>
          ) : (
            <>
              <span className={`badge ${statusBadge(empNN.status)}`} style={{ fontSize: 13 }}>{empNN.status || 'Active'}</span>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit Profile</button>
              <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="profile-grid">
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Contact & Work Info */}
          <div className="data-card">
            <div className="data-card-title">Profile Information</div>
            <div className="profile-fields">
              {editing ? (
                <>
                  <div className="profile-field">
                    <span className="profile-field-label">Role</span>
                    <input className="form-input form-input-sm" value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} placeholder="e.g. Virtual Assistant" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Status</span>
                    <select className="form-select form-input-sm" value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                      {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Employment Type</span>
                    <select className="form-select form-input-sm" value={form.employmentType} onChange={e => setForm(f => ({...f, employmentType: e.target.value}))}>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t || '— Not set —'}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Email</span>
                    <input className="form-input form-input-sm" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="email@example.com" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Phone</span>
                    <input className="form-input form-input-sm" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="+1 555 000 0000" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Pay Rate ($/hr)</span>
                    <input className="form-input form-input-sm" type="number" value={form.payRate} onChange={e => setForm(f => ({...f, payRate: e.target.value}))} placeholder="8.50" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Default Shift Start</span>
                    <input className="form-input form-input-sm" value={form.defaultShiftStart} onChange={e => setForm(f => ({...f, defaultShiftStart: e.target.value}))} onBlur={e => setForm(f => ({...f, defaultShiftStart: normalizeClockInput(e.target.value)}))} placeholder="4:00 pm" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Default Shift End</span>
                    <input className="form-input form-input-sm" value={form.defaultShiftEnd} onChange={e => setForm(f => ({...f, defaultShiftEnd: e.target.value}))} onBlur={e => setForm(f => ({...f, defaultShiftEnd: normalizeClockInput(e.target.value)}))} placeholder="12:00 am" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Premium Rule</span>
                    <select className="form-select form-input-sm" value={form.premiumEnabled ? 'night' : ''} onChange={e => setForm(f => ({...f, premiumEnabled: e.target.value === 'night'}))}>
                      <option value="">No premium pay</option>
                      <option value="night">Night shift premium</option>
                    </select>
                  </div>
                  {form.premiumEnabled && (
                    <>
                      <div className="profile-field">
                        <span className="profile-field-label">Premium Starts At</span>
                        <input className="form-input form-input-sm" value={form.premiumStartTime} onChange={e => setForm(f => ({...f, premiumStartTime: e.target.value}))} onBlur={e => setForm(f => ({...f, premiumStartTime: normalizeClockInput(e.target.value) || '21:00'}))} placeholder="9:00 pm" />
                      </div>
                      <div className="profile-field">
                        <span className="profile-field-label">Premium Increase %</span>
                        <input className="form-input form-input-sm" type="number" value={form.premiumPercent} onChange={e => setForm(f => ({...f, premiumPercent: e.target.value}))} placeholder="15" />
                      </div>
                    </>
                  )}
                  <div className="profile-field">
                    <span className="profile-field-label">Location</span>
                    <input className="form-input form-input-sm" value={form.location} onChange={e => setForm(f => ({...f, location: e.target.value}))} placeholder="Santo Domingo, DR" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Timezone</span>
                    <input className="form-input form-input-sm" value={form.timezone} onChange={e => setForm(f => ({...f, timezone: e.target.value}))} placeholder="AST / EST" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Start Year</span>
                    <input className="form-input form-input-sm" type="number" value={form.startYear} onChange={e => setForm(f => ({...f, startYear: e.target.value}))} placeholder="2024" />
                  </div>
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Notes</span>
                    <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Internal notes..." />
                  </div>
                </>
              ) : (
                <>
                  {[
                    { label: 'Role',            value: empNN.role },
                    { label: 'Status',          value: empNN.status || 'Active' },
                    { label: 'Employment Type', value: empNN.employmentType },
                    { label: 'Email',           value: empNN.email },
                    { label: 'Phone',           value: empNN.phone },
                    { label: 'Pay Rate',        value: empNN.payRate ? `$${empNN.payRate}/hr` : undefined },
                    { label: 'Default Shift',   value: empNN.defaultShiftStart || empNN.defaultShiftEnd ? `${empNN.defaultShiftStart || '—'} to ${empNN.defaultShiftEnd || '—'}` : undefined },
                    { label: 'Premium Rule',    value: empNN.premiumEnabled ? `+${empNN.premiumPercent || 0}% after ${empNN.premiumStartTime || '21:00'}` : undefined },
                    { label: 'Location',        value: empNN.location },
                    { label: 'Timezone',        value: empNN.timezone },
                    { label: 'Start Year',      value: empNN.startYear ? String(empNN.startYear) : undefined },
                  ].map(({ label, value }) => value ? (
                    <div key={label} className="profile-field">
                      <span className="profile-field-label">{label}</span>
                      <span className="profile-field-value">{value}</span>
                    </div>
                  ) : null)}
                  {empNN.notes && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Notes</span>
                      <span className="profile-field-value" style={{ whiteSpace: 'pre-wrap' }}>{empNN.notes}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Assigned Projects */}
          {assignedProjects.length > 0 && (
            <div className="data-card">
              <div className="data-card-title">Assigned Projects</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                {assignedProjects.map(p => (
                  <button key={p.id} className="btn-ghost btn-sm" onClick={() => navigate('/projects/' + p.id)}
                    style={{ fontSize: 12 }}>
                    {p.name}
                    {p.status && <span style={{ marginLeft: 6, color: 'var(--muted)', fontSize: 11 }}>{p.status}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Attachments */}
          <div className="data-card">
            <div className="data-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Attachments
              <button className="btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>+ Upload</button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*,video/*,.mp4,.mov,.avi,.webm,.mkv,.m4v,.wmv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
            {attachments.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>No files yet. Upload CVs, audio notes, videos, or documents.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {attachments.map(att => (
                  <div key={att.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surf3)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{attIcon(att)}</span>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{att.size >= 1024*1024 ? (att.size/1024/1024).toFixed(1)+' MB' : (att.size/1024).toFixed(1)+' KB'} · {new Date(att.uploadedAt).toLocaleDateString()}</div>
                      </div>
                      {isAudio(att) && (
                        <audio controls src={att.storageUrl || att.dataUrl} style={{ height: 28, maxWidth: 140 }} />
                      )}
                      <button className="btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => downloadAttachment(att.storageUrl || att.dataUrl, att.name)}>↓</button>
                      <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => removeAttachment(att.id)}>×</button>
                    </div>
                    {isVideo(att) && <VideoPlayer url={att.storageUrl || att.dataUrl} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — Statements */}
        <div className="data-card" style={{ alignSelf: 'start' }}>
          <div className="data-card-title">Earnings Statements</div>

          {/* Date filter */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 1, minWidth: 120, margin: 0 }}>
              <label className="form-label">From</label>
              <input className="form-input form-input-sm" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 120, margin: 0 }}>
              <label className="form-label">To</label>
              <input className="form-input form-input-sm" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            {(dateFrom || dateTo) && (
              <button className="btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo('') }}>Clear</button>
            )}
          </div>

          {/* KPI summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
            <div className="settings-stat-card">
              <div className="settings-stat-count" style={{ fontSize: 16 }}>{empInvoices.length}</div>
              <div className="settings-stat-label">Invoices</div>
            </div>
            <div className="settings-stat-card">
              <div className="settings-stat-count" style={{ fontSize: 16 }}>{fmtHoursHM(totalHours)}</div>
              <div className="settings-stat-label">Total Hours</div>
            </div>
            <div className="settings-stat-card">
              <div className="settings-stat-count" style={{ fontSize: 15 }}>{summary.premiumHours > 0 ? fmtHoursHM(summary.premiumHours) : '—'}</div>
              <div className="settings-stat-label">{summary.premiumHours > 0 ? `Premium Hrs (+${premiumConfig.percent}%)` : 'Premium Hrs'}</div>
            </div>
            <div className="settings-stat-card">
              <div className="settings-stat-count" style={{ fontSize: 15 }}>{payRate > 0 ? formatMoney(totalEarned) : '—'}</div>
              <div className="settings-stat-label">Total Earned</div>
            </div>
            <div className="settings-stat-card" style={{ borderColor: paidCount > 0 ? 'var(--gold)' : undefined }}>
              <div className="settings-stat-count" style={{ fontSize: 15, color: paidCount > 0 ? 'var(--gold)' : undefined }}>{payRate > 0 ? formatMoney(totalPaid) : paidCount}</div>
              <div className="settings-stat-label">{paidCount} Paid</div>
            </div>
            <div className="settings-stat-card">
              <div className="settings-stat-count" style={{ fontSize: 15, color: pendingCount > 0 ? 'var(--muted)' : undefined }}>{pendingCount}</div>
              <div className="settings-stat-label">Pending</div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn-ghost btn-sm" onClick={() => { void handleStatementEmail(empInvoices) }}
              disabled={empInvoices.length === 0 || !empNN.email}
              title={!empNN.email ? 'No email on file' : ''}>
              ✉ Email Statement
            </button>
            <button className="btn-ghost btn-sm" onClick={() => printPayslip(emp, empInvoices, dateFrom, dateTo)}
              disabled={empInvoices.length === 0}>
              ⎙ PDF Payslip
            </button>
          </div>

          {/* Invoice sections */}
          {empInvoices.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>No invoices for this period.</div>
          ) : (
            <div>
              {empInvoices.map(inv => {
                const items = getEmployeeInvoiceItems(empNN, inv)
                const invoiceSummary = items.reduce((acc, item) => {
                  const payroll = payrollFromInvoiceItem(item, empNN)
                  acc.hrs += payroll.totalHours
                  acc.regular += payroll.regularHours
                  acc.premium += payroll.premiumHours
                  acc.earned += payroll.totalPay
                  return acc
                }, { hrs: 0, regular: 0, premium: 0, earned: 0 })
                const hrs   = invoiceSummary.hrs
                const period2 = inv.billingStart
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
                    allDates = Object.keys(daily).filter(d => parseFloat(daily[d]) > 0).sort()
                  }
                }
                const payment = getEmployeePaymentRecord(inv, empNN)
                const isPaid  = payment?.status === 'paid'
                return (
                  <div key={inv.id} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ background: 'var(--surf2)', padding: '7px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{inv.number}</strong>
                      <span style={{ color: 'var(--muted)' }}>·</span>
                      {inv.projectName || '—'}
                      <span style={{ color: 'var(--muted)' }}>·</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>{period2}</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(invoiceSummary.earned)}</span>
                        {isPaid ? (
                          <>
                            <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
                                ✓ Paid {payment?.paidDate ? new Date(payment.paidDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                            </span>
                            <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => { void handleStatementEmail([inv]) }}>Email</button>
                            <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => markPending(inv)}>Undo</button>
                          </>
                        ) : (
                          <>
                            <button className="btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 10px', borderColor: 'var(--gold)', color: 'var(--gold)' }}
                              onClick={() => { void markPaid(inv) }}>
                              Mark as Paid
                            </button>
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
                              const h = daily ? (parseFloat(daily[d] || '') || 0) : 0
                              return (
                                <td key={d} style={{ textAlign: 'center', fontSize: 12, color: h > 0 ? undefined : 'var(--muted)', padding: '7px 3px' }}>
                                  {h > 0 ? (h % 1 === 0 ? h : h.toFixed(1)) : '—'}
                                </td>
                              )
                            })}
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtHoursHM(hrs)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{payRate > 0 ? `$${payRate}/hr` : '—'}</td>
                            <td style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(invoiceSummary.earned)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
              <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 13, padding: '8px 4px', borderTop: '2px solid var(--border)', marginTop: 4 }}>
                Total &nbsp; {fmtHoursHM(totalHours)} &nbsp;&nbsp; {payRate > 0 ? formatMoney(totalEarned) : '—'}
              </div>
            </div>
          )}
        </div>
      </div>

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

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete {empNN.name}?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
