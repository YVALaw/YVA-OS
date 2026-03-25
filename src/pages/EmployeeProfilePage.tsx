import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Attachment, Employee, Invoice, Project } from '../data/types'
import { loadSnapshot, saveEmployees, loadSettings } from '../services/storage'
import { sendEmail } from '../services/gmail'
import { formatMoney, fmtHoursHM } from '../utils/money'

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

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
  })
}

async function emailStatement(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const payRate  = Number(emp.payRate) || 0
  const dopRate  = settings.usdToDop || 0
  const totalHours = empInvoices.reduce((s, inv) =>
    s + (inv.items||[]).filter(it=>it.employeeName?.toLowerCase()===emp.name.toLowerCase())
      .reduce((h,it)=>h+(Number(it.hoursTotal)||0),0), 0)
  const totalUSD = totalHours * payRate
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
  sendEmail(emp.email || '', subject, bodyText)
}

async function printPayslip(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string) {
  const settings = await loadSettings()
  const payRate  = Number(emp.payRate) || 0
  const dopRate  = settings.usdToDop || 0
  const totalHours = empInvoices.reduce((s, inv) =>
    s + (inv.items||[]).filter(it=>it.employeeName?.toLowerCase()===emp.name.toLowerCase())
      .reduce((h,it)=>h+(Number(it.hoursTotal)||0),0), 0)
  const totalUSD = totalHours * payRate
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0
  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  function ph(v: string): number {
    if (!v) return 0; const s = v.trim().replace(',','.')
    if (s.includes(':')) { const [h,m]=s.split(':'); return (parseInt(h)||0)+(parseInt(m)||0)/60 }
    return parseFloat(s)||0
  }
  const rows = empInvoices.map(inv => {
    const items = (inv.items||[]).filter(it=>it.employeeName?.toLowerCase()===emp.name.toLowerCase())
    const hrs = items.reduce((h,it)=>h+(Number(it.hoursTotal)||0),0)
    const earned = payRate > 0 ? hrs * payRate : 0
    const period2 = inv.billingStart ? inv.billingStart+(inv.billingEnd?' – '+inv.billingEnd:'') : (inv.date||'—')
    const daily = items[0]?.daily
    const dayAbbr2 = ['Su','Mo','Tu','We','Th','Fr','Sa']
    const dailyCards = daily
      ? Object.entries(daily).filter(([,v])=>ph(v)>0).sort(([a],[b])=>a.localeCompare(b))
          .map(([date,val])=>{
            const h=ph(val)
            const dt=new Date(date+'T12:00:00')
            const lbl=dayAbbr2[dt.getDay()]+'<br>'+(dt.getMonth()+1)+'/'+dt.getDate()
            return `<div style="text-align:center;background:#efefef;border-radius:4px;padding:4px 8px;min-width:38px"><div style="font-size:9px;color:#999;line-height:1.4">${lbl}</div><div style="font-size:12px;font-weight:700;color:#111">${h%1===0?h:h.toFixed(1)}h</div></div>`
          }).join('')
      : ''
    const dailyRows = dailyCards
      ? `<tr style="background:#fafafa"><td colspan="5" style="padding:4px 8px 12px;border-bottom:1px solid #eee"><div style="display:flex;gap:6px;flex-wrap:wrap">${dailyCards}</div></td></tr>`
      : ''
    return `<tr>
      <td style="font-weight:600">${inv.number}</td>
      <td>${inv.projectName||'—'}</td>
      <td style="color:#666;font-size:11px">${period2}</td>
      <td style="text-align:right;font-weight:600">${hrs.toFixed(1)}h</td>
      <td style="text-align:right;font-weight:700;color:#f5b533">${earned>0?'$'+earned.toFixed(2):'—'}</td>
    </tr>${dailyRows}`
  }).join('')
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><title>Statement — ${emp.name}</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#111}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid #f5b533;padding-bottom:16px}.logo{height:48px}h2{margin:0;font-size:22px;color:#f5b533}.meta{font-size:12px;color:#999;margin-top:4px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.kpi{background:#f9f9f9;border-radius:8px;padding:14px;text-align:center}.kpi-v{font-size:20px;font-weight:800;color:#111}.kpi-l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999;padding:8px 8px;border-bottom:2px solid #eee}td{padding:8px;border-bottom:1px solid #eee}.footer{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;text-align:center}@media print{body{margin:16px}}</style></head><body><div class="header"><img src="${window.location.origin}/yva-logo.png" class="logo" onerror="this.style.display='none'" /><div style="text-align:right"><h2>EARNINGS STATEMENT</h2><div class="meta">${emp.name}${emp.employeeNumber?` · ${emp.employeeNumber}`:''}</div><div class="meta">Period: ${period}</div><div class="meta">Generated: ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div></div></div><div class="kpis"><div class="kpi"><div class="kpi-v">${empInvoices.length}</div><div class="kpi-l">Invoices</div></div><div class="kpi"><div class="kpi-v">${totalHours.toFixed(1)}h</div><div class="kpi-l">Total Hours</div></div><div class="kpi"><div class="kpi-v">${payRate>0?'$'+payRate+'/hr':'—'}</div><div class="kpi-l">Pay Rate</div></div><div class="kpi"><div class="kpi-v">${payRate>0?'$'+totalUSD.toFixed(2):'—'}</div><div class="kpi-l">Total Earned (USD)</div></div>${totalDOP>0?`<div class="kpi"><div class="kpi-v">RD$${totalDOP.toLocaleString('en-US',{maximumFractionDigits:0})}</div><div class="kpi-l">Total Earned (DOP @ ${dopRate})</div></div>`:''}</div>${rows?`<table><thead><tr><th>Invoice</th><th>Project</th><th>Period</th><th style="text-align:right">Hours</th><th style="text-align:right">Earned</th></tr></thead><tbody>${rows}<tr style="font-weight:800;border-top:2px solid #111"><td colspan="3">Total</td><td style="text-align:right">${totalHours.toFixed(1)}h</td><td style="text-align:right;color:#f5b533">${payRate>0?'$'+totalUSD.toFixed(2):'—'}</td></tr></tbody></table>`:'<p style="color:#999;text-align:center;padding:24px">No invoice data for this period.</p>'}<div class="footer">YVA Staffing · Bilingual Virtual Professionals · yvastaffing.net</div><script>window.onload=function(){window.print()}</script></body></html>`)
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
    name: '', email: '', phone: '', payRate: '', role: '',
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
  const totalHours  = empInvoices.reduce((s, inv) =>
    s + (inv.items||[]).filter(it => it.employeeName?.toLowerCase() === empNN.name.toLowerCase())
      .reduce((h, it) => h + (Number(it.hoursTotal)||0), 0), 0)
  const totalEarned = payRate > 0 ? totalHours * payRate : 0
  const assignedProjects = projects.filter(p => (p.employeeIds || []).includes(empNN.id))

  function persistUpdate(updated: Employee) {
    const next = employees.map(e => e.id === updated.id ? updated : e)
    setEmployeesState(next)
    void saveEmployees(next)
  }

  function handleSave() {
    if (!form.name.trim()) return
    const updated: Employee = {
      ...empNN,
      name: form.name,
      email: form.email || undefined,
      phone: form.phone || undefined,
      payRate: form.payRate ? Number(form.payRate) : undefined,
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
    persistUpdate(updated)
    setEditing(false)
  }

  function handlePhotoUpload(file: File) {
    if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { alert('Image too large (max 5 MB).'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const url = ev.target?.result as string
      setPhotoUrl(url)
      persistUpdate({ ...empNN, photoUrl: url, attachments })
    }
    reader.readAsDataURL(file)
  }

  function handleCancel() {
    setForm({
      name: empNN.name,
      email: empNN.email ?? '',
      phone: empNN.phone ?? '',
      payRate: empNN.payRate != null ? String(empNN.payRate) : '',
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

  function handleFileUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) { alert('File too large (max 5 MB).'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const att: Attachment = {
        id: uid(), name: file.name, mimeType: file.type,
        size: file.size, dataUrl: ev.target?.result as string, uploadedAt: Date.now(),
      }
      setAttachments(prev => {
        const next = [...prev, att]
        persistUpdate({ ...empNN, attachments: next })
        return next
      })
    }
    reader.readAsDataURL(file)
  }

  function removeAttachment(attId: string) {
    setAttachments(prev => {
      const next = prev.filter(a => a.id !== attId)
      persistUpdate({ ...empNN, attachments: next })
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
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
            {attachments.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>No files yet. Upload CVs, audio notes, or documents.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {attachments.map(att => (
                  <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surf3)', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 18 }}>{att.mimeType.startsWith('image') ? '🖼' : att.mimeType.startsWith('audio') ? '🎵' : '📄'}</span>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(att.size / 1024).toFixed(1)} KB · {new Date(att.uploadedAt).toLocaleDateString()}</div>
                    </div>
                    {att.mimeType.startsWith('audio') && (
                      <audio controls src={att.dataUrl} style={{ height: 28, maxWidth: 140 }} />
                    )}
                    <a href={att.dataUrl} download={att.name} className="btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 8px' }}>↓</a>
                    <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => removeAttachment(att.id)}>×</button>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Invoices',    value: String(empInvoices.length) },
              { label: 'Total Hours', value: fmtHoursHM(totalHours) },
              { label: 'Total Earned', value: payRate > 0 ? formatMoney(totalEarned) : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="settings-stat-card">
                <div className="settings-stat-count" style={{ fontSize: 16 }}>{value}</div>
                <div className="settings-stat-label">{label}</div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn-ghost btn-sm" onClick={() => emailStatement(emp, empInvoices, dateFrom, dateTo)}
              disabled={empInvoices.length === 0 || !empNN.email}
              title={!empNN.email ? 'No email on file' : ''}>
              ✉ Email Statement
            </button>
            <button className="btn-ghost btn-sm" onClick={() => printPayslip(emp, empInvoices, dateFrom, dateTo)}
              disabled={empInvoices.length === 0}>
              ⎙ PDF Payslip
            </button>
          </div>

          {/* Invoice table */}
          {empInvoices.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>No invoices for this period.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Invoice</th><th>Project</th><th>Period</th><th>Hours</th><th>Earned</th></tr>
                </thead>
                <tbody>
                  {empInvoices.map(inv => {
                    const items = (inv.items||[]).filter(it => it.employeeName?.toLowerCase() === empNN.name.toLowerCase())
                    const hrs   = items.reduce((h,it) => h+(Number(it.hoursTotal)||0), 0)
                    const period2 = inv.billingStart
                      ? `${inv.billingStart}${inv.billingEnd ? ' – ' + inv.billingEnd : ''}`
                      : (inv.date || '—')
                    const daily = items[0]?.daily
                    const dailyEntries = daily
                      ? Object.entries(daily).filter(([, v]) => parseFloat(v) > 0).sort(([a], [b]) => a.localeCompare(b))
                      : []
                    return (
                      <React.Fragment key={inv.id}>
                        <tr>
                          <td className="td-name">{inv.number}</td>
                          <td className="td-muted">{inv.projectName || '—'}</td>
                          <td className="td-muted" style={{ fontSize: 11 }}>{period2}</td>
                          <td>{fmtHoursHM(hrs)}</td>
                          <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{payRate > 0 ? formatMoney(hrs * payRate) : '—'}</td>
                        </tr>
                        {dailyEntries.length > 0 && (
                          <tr style={{ background: 'rgba(255,255,255,.03)' }}>
                            <td colSpan={5} style={{ padding: '4px 8px 10px' }}>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {dailyEntries.map(([date, val]) => {
                                  const h = parseFloat(val) || 0
                                  const dt = new Date(date + 'T12:00:00')
                                  const dayAbbr = ['Su','Mo','Tu','We','Th','Fr','Sa']
                                  return (
                                    <div key={date} style={{ textAlign: 'center', background: 'rgba(255,255,255,.07)', borderRadius: 4, padding: '4px 8px', minWidth: 38 }}>
                                      <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.4 }}>{dayAbbr[dt.getDay()]}<br />{dt.getMonth()+1}/{dt.getDate()}</div>
                                      <div style={{ fontSize: 12, fontWeight: 700 }}>{h % 1 === 0 ? h : h.toFixed(1)}h</div>
                                    </div>
                                  )
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
