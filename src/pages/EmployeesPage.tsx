import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Attachment, Employee, Invoice } from '../data/types'
import {
  loadSnapshot, saveEmployees,
  loadEmployeeCounter, saveEmployeeCounter, loadSettings,
} from '../services/storage'
import { formatMoney, fmtHoursHM } from '../utils/money'
import { useRole } from '../context/RoleContext'
import { can } from '../lib/roles'

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

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

const STATUS_OPTIONS = ['Active', 'Onboarding', 'Trial', 'On hold', 'Inactive']
const TYPE_OPTIONS   = ['', 'Full-time', 'Part-time', 'Project-based']

type FormData = {
  name: string; email: string; phone: string; payRate: string
  role: string; employmentType: string; location: string
  timezone: string; startYear: string; status: string; notes: string
}
const EMPTY: FormData = {
  name: '', email: '', phone: '', payRate: '', role: '', employmentType: '',
  location: '', timezone: '', startYear: '', status: 'Active', notes: '',
}

function getEmployeeInvoices(empName: string, invoices: Invoice[], from?: string, to?: string) {
  return invoices.filter(inv => {
    const hasEmp = (inv.items || []).some(it => it.employeeName?.toLowerCase() === empName.toLowerCase())
    if (!hasEmp) return false
    if (!from && !to) return true
    const d = inv.date || inv.billingEnd || inv.billingStart
    if (!d) return true
    if (from && d < from) return false
    if (to   && d > to)   return false
    return true
  })
}

async function printPayslip(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const payRate = Number(emp.payRate) || 0
  const dopRate = settings.usdToDop || 0

  const totalHours = empInvoices.reduce((s, inv) =>
    s + (inv.items||[]).filter(it=>it.employeeName?.toLowerCase()===emp.name.toLowerCase())
      .reduce((h,it)=>h+(Number(it.hoursTotal)||0),0), 0)
  const totalUSD = totalHours * payRate
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0

  const rows = empInvoices.map(inv => {
    const items = (inv.items||[]).filter(it=>it.employeeName?.toLowerCase()===emp.name.toLowerCase())
    const hrs = items.reduce((h,it)=>h+(Number(it.hoursTotal)||0),0)
    return `<tr>
      <td>${inv.number}</td><td>${inv.clientName||'—'}</td><td>${inv.projectName||'—'}</td>
      <td>${inv.date||'—'}</td><td style="text-align:right">${hrs.toFixed(1)}h</td>
      <td style="text-align:right">$${payRate}/hr</td>
      <td style="text-align:right"><strong>${payRate>0?'$'+(hrs*payRate).toFixed(2):'—'}</strong></td>
    </tr>`
  }).join('')

  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head>
  <title>Statement — ${emp.name}</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#111}
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
    @media print{body{margin:16px}}
  </style></head><body>
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
    <div class="kpi"><div class="kpi-v">${payRate>0?'$'+totalUSD.toFixed(2):'—'}</div><div class="kpi-l">Total Earned (USD)</div></div>
    ${totalDOP>0?`<div class="kpi" style="grid-column:1/-1"><div class="kpi-v">RD$${totalDOP.toLocaleString('en-US',{maximumFractionDigits:0})}</div><div class="kpi-l">Total Earned (DOP @ ${dopRate})</div></div>`:''}
  </div>
  ${rows ? `<table><thead><tr><th>Invoice</th><th>Client</th><th>Project</th><th>Date</th><th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>` : '<p style="color:#999;text-align:center;padding:24px">No invoice data for this period.</p>'}
  <div class="footer">YVA Staffing · Bilingual Virtual Professionals · yvastaffing.net</div>
  <script>window.onload=function(){window.print()}</script>
  </body></html>`)
  win.document.close()
}

async function emailStatement(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const payRate = Number(emp.payRate) || 0
  const dopRate = settings.usdToDop || 0
  const totalHours = empInvoices.reduce((s, inv) =>
    s + (inv.items||[]).filter(it=>it.employeeName?.toLowerCase()===emp.name.toLowerCase())
      .reduce((h,it)=>h+(Number(it.hoursTotal)||0),0), 0)
  const totalUSD = totalHours * payRate
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0
  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  const companyName = settings.companyName || 'YVA Staffing'

  const subject = encodeURIComponent(`Your Earnings Statement — ${period} — ${companyName}`)

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
  window.location.href = `mailto:${emp.email || ''}?subject=${subject}&body=${encodeURIComponent(bodyText)}`
}

function EmployeeStatementsPanel({ emp, invoices }: { emp: Employee; invoices: Invoice[] }) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  const empInvoices = getEmployeeInvoices(emp.name, invoices, dateFrom || undefined, dateTo || undefined)
  const payRate = Number(emp.payRate) || 0

  const totalHours = empInvoices.reduce((s, inv) => {
    return s + (inv.items || []).filter(it => it.employeeName?.toLowerCase() === emp.name.toLowerCase())
      .reduce((h, it) => h + (Number(it.hoursTotal) || 0), 0)
  }, 0)
  const totalEarned = payRate > 0 ? totalHours * payRate : 0

  const byProject = new Map<string, { hours: number; earned: number }>()
  for (const inv of empInvoices) {
    const items = (inv.items || []).filter(it => it.employeeName?.toLowerCase() === emp.name.toLowerCase())
    const projName = inv.projectName || 'No project'
    const pp = byProject.get(projName) || { hours: 0, earned: 0 }
    for (const it of items) {
      const h = Number(it.hoursTotal) || 0
      pp.hours  += h
      pp.earned += h * (payRate || 0)
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
          <button
            className="btn-ghost btn-sm"
            onClick={() => emailStatement(emp, empInvoices, dateFrom, dateTo)}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div className="settings-stat-card">
          <div className="settings-stat-count">{empInvoices.length}</div>
          <div className="settings-stat-label">Invoices</div>
        </div>
        <div className="settings-stat-card">
          <div className="settings-stat-count">{fmtHoursHM(totalHours)}</div>
          <div className="settings-stat-label">Total Hours</div>
        </div>
        <div className="settings-stat-card">
          <div className="settings-stat-count" style={{ fontSize: 15 }}>{payRate > 0 ? formatMoney(totalEarned) : '—'}</div>
          <div className="settings-stat-label">Total Earned</div>
        </div>
      </div>

      {empInvoices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: 13 }}>
          No invoices found for this period.
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Invoice</th><th>Client</th><th>Project</th><th>Date</th><th>Hours</th><th>Rate</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {empInvoices.map(inv => {
                  const items = (inv.items || []).filter(it => it.employeeName?.toLowerCase() === emp.name.toLowerCase())
                  const hrs = items.reduce((h, it) => h + (Number(it.hoursTotal) || 0), 0)
                  return (
                    <tr key={inv.id}>
                      <td className="td-name">{inv.number}</td>
                      <td className="td-muted">{inv.clientName || '—'}</td>
                      <td className="td-muted">{inv.projectName || '—'}</td>
                      <td className="td-muted">{inv.date || '—'}</td>
                      <td>{fmtHoursHM(hrs)}</td>
                      <td className="td-muted">{payRate > 0 ? `$${payRate}/hr` : '—'}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{payRate > 0 ? formatMoney(hrs * payRate) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{payRate > 0 ? formatMoney(pt.earned) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
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
  const [projects,  setProjects]  = useState<{ id: string; name: string; employeeIds?: string[]; status?: string }[]>([])
  useEffect(() => {
    loadSnapshot().then(snap => {
      setEmployees(snap.employees)
      setInvoices(snap.invoices)
      setProjects(snap.projects)
    })
  }, [])
  const [modal, setModal]       = useState<null | 'add' | 'edit' | 'statements'>(null)
  const [showCapacity, setShowCapacity] = useState(false)
  const [form, setForm]         = useState<FormData>(EMPTY)
  const [editId, setEditId]     = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedEmp, setSelectedEmp]   = useState<Employee | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  function persist(next: Employee[]) { setEmployees(next); void saveEmployees(next) }

  function openAdd() { setForm({ ...EMPTY }); setAttachments([]); setEditId(null); setModal('add') }
  function openEdit(e: Employee) {
    setForm({
      name: e.name, email: e.email ?? '', phone: e.phone ?? '',
      payRate: e.payRate != null ? String(e.payRate) : '',
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
    if (modal === 'add') {
      const empNum = await generateEmployeeNumber()
      persist([...employees, { ...form, id: uid(), employeeNumber: empNum, attachments } as Employee])
    } else if (editId) {
      persist(employees.map((e) => e.id === editId ? { ...e, ...form, attachments } : e))
    }
    setModal(null)
  }
  function doDelete(id: string) { persist(employees.filter((e) => e.id !== id)); setConfirmDelete(null) }

  const filtered = employees.filter((e) => {
    const matchSearch = `${e.name} ${e.email ?? ''} ${(e as {role?:string}).role ?? ''}`.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus || (e.status || 'Active') === filterStatus
    return matchSearch && matchStatus
  })

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Team</h1>
          <p className="page-sub">{employees.length} member{employees.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-header-actions">
          <input className="form-input" style={{ width: 190 }} placeholder="Search team..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="form-select" style={{ width: 130 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn-primary" onClick={openAdd}>+ Add Member</button>
        </div>
      </div>

      {/* Capacity toggle */}
      <div style={{ marginBottom: 12 }}>
        <button className="btn-ghost btn-sm" onClick={() => setShowCapacity(v => !v)}>
          {showCapacity ? 'Hide' : 'Show'} Capacity View
        </button>
      </div>

      {/* Capacity View */}
      {showCapacity && (() => {
        const now = new Date()
        const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
        const monthEnd   = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10)
        const activeEmps = employees.filter(e => (e.status || 'Active').toLowerCase() === 'active')

        return (
          <div className="data-card" style={{ marginBottom: 16 }}>
            <div className="data-card-title">Team Capacity — {now.toLocaleString('en-US',{month:'long',year:'numeric'})}</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Assigned Projects</th>
                    <th style={{textAlign:'right'}}>Hrs This Month</th>
                    {showPayRates && <th style={{textAlign:'right'}}>Earned (USD)</th>}
                  </tr>
                </thead>
                <tbody>
                  {activeEmps.map(e => {
                    const empProjects = projects.filter(p => (p.employeeIds||[]).includes(e.id) && (p.status||'').toLowerCase() === 'active')
                    const monthInvs   = invoices.filter(inv => {
                      const d = inv.date || inv.billingEnd || ''
                      return d >= monthStart && d <= monthEnd && (inv.items||[]).some(it => it.employeeName?.toLowerCase() === e.name.toLowerCase())
                    })
                    const monthHours  = monthInvs.reduce((s, inv) =>
                      s + (inv.items||[]).filter(it=>it.employeeName?.toLowerCase()===e.name.toLowerCase())
                        .reduce((h,it)=>h+(Number(it.hoursTotal)||0),0), 0)
                    const payRate = Number(e.payRate) || 0
                    return (
                      <tr key={e.id}>
                        <td className="td-name">{e.name}</td>
                        <td className="td-muted">{(e as {role?:string}).role || '—'}</td>
                        <td>
                          {empProjects.length === 0
                            ? <span className="td-muted">None</span>
                            : empProjects.map(p => (
                              <span key={p.id} style={{fontSize:11,background:'var(--surf2)',border:'1px solid var(--border)',borderRadius:4,padding:'2px 6px',marginRight:4}}>{p.name}</span>
                            ))}
                        </td>
                        <td style={{textAlign:'right',fontWeight:600}}>{monthHours > 0 ? `${monthHours.toFixed(1)}h` : '—'}</td>
                        {showPayRates && <td style={{textAlign:'right',color:'var(--gold)',fontWeight:700}}>{monthHours > 0 && payRate > 0 ? formatMoney(monthHours*payRate) : '—'}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      <div className="card-grid">
        {filtered.map((e) => {
          const color = avatarColor(e.name)
          const empInvoiceCount = invoices.filter(inv => (inv.items||[]).some(it => it.employeeName?.toLowerCase() === e.name.toLowerCase())).length
          const empNum = e.employeeNumber
          return (
            <div key={e.id} className="entity-card" style={{ borderTop: `2px solid ${statusColor(e.status)}`, cursor: 'pointer' }} onClick={() => navigate('/employees/' + e.id)}>
              <div className="card-top">
                <div className="card-top-left">
                  <div className="avatar" style={{ background: color }}>{initials(e.name)}</div>
                  <div>
                    <div className="card-name">{e.name}</div>
                    <div className="card-sub">{empNum ? `${empNum} · ` : ''}{(e as {role?:string}).role || e.email || 'No email'}</div>
                  </div>
                </div>
                <span className={`badge ${statusBadge(e.status)}`}>{e.status || 'Active'}</span>
              </div>
              <div className="card-stats">
                {showPayRates && e.payRate && (
                  <div className="stat-item">
                    <div className="stat-label">Pay Rate</div>
                    <div className="stat-value stat-value-gold">${e.payRate}/hr</div>
                  </div>
                )}
                {(e as {employmentType?:string}).employmentType && (
                  <div className="stat-item">
                    <div className="stat-label">Type</div>
                    <div className="stat-value">{(e as {employmentType?:string}).employmentType}</div>
                  </div>
                )}
                {(e as {location?:string}).location && (
                  <div className="stat-item">
                    <div className="stat-label">Location</div>
                    <div className="stat-value" style={{ fontSize: 12 }}>{(e as {location?:string}).location}</div>
                  </div>
                )}
                {e.timezone && (
                  <div className="stat-item">
                    <div className="stat-label">Timezone</div>
                    <div className="stat-value">{e.timezone}</div>
                  </div>
                )}
                {e.startYear && (
                  <div className="stat-item">
                    <div className="stat-label">Since</div>
                    <div className="stat-value">{e.startYear}</div>
                  </div>
                )}
                <div className="stat-item">
                  <div className="stat-label">Invoices</div>
                  <div className="stat-value">{empInvoiceCount}</div>
                </div>
              </div>
              {(e as {notes?:string}).notes && (
                <div className="card-detail" style={{ fontSize: 11, opacity: .75 }}>{(e as {notes?:string}).notes}</div>
              )}
              <div className="card-footer">
                <button className="btn-xs btn-teal" onClick={ev => { ev.stopPropagation(); navigate('/employees/' + e.id) }}>View Profile</button>
                <button className="btn-xs btn-ghost" onClick={ev => { ev.stopPropagation(); openEdit(e) }}>Edit</button>
                <button className="btn-xs btn-danger" onClick={ev => { ev.stopPropagation(); setConfirmDelete(e.id) }}>Remove</button>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 14 }}>
            {search || filterStatus ? 'No results.' : 'No team members yet. Add your first.'}
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
              <EmployeeStatementsPanel emp={selectedEmp} invoices={invoices} />
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{modal === 'add' ? 'Add Team Member' : 'Edit Member'}</h2>
              <button className="modal-close btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
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
              {modal === 'add' && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                  Employee number will be auto-assigned (e.g. YVA25001) on save.
                </div>
              )}

              {/* Attachments */}
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
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
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveForm} disabled={!form.name.trim()}>
                {modal === 'add' ? 'Add Member' : 'Save Changes'}
              </button>
            </div>
          </div>
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
