import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ActivityLogEntry, Client, Invoice, Project } from '../data/types'
import { loadSnapshot, saveClients, loadActivityLog, saveActivityLog, loadSettings } from '../services/storage'
import { sendEmail } from '../services/gmail'

function uid() { return crypto.randomUUID() }

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function stageBadge(s?: string): string {
  switch ((s || 'lead').toLowerCase()) {
    case 'active':   return 'badge-green'
    case 'prospect': return 'badge-yellow'
    case 'paused':   return 'badge-gray'
    case 'churned':  return 'badge-red'
    default:         return 'badge-blue'
  }
}
function statusBadge(s: string): string { return stageBadge(s) }
function fmtTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STAGES = [
  { key: 'lead', label: 'Lead' }, { key: 'prospect', label: 'Prospect' },
  { key: 'active', label: 'Active' }, { key: 'paused', label: 'Paused' }, { key: 'churned', label: 'Churned' },
]

type LinkEntry = { label: string; url: string }

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [clients,  setClientsState] = useState<Client[]>([])
  const [invoices, setInvoices]     = useState<Invoice[]>([])
  const [projects, setProjects]     = useState<Project[]>([])
  useEffect(() => {
    loadSnapshot().then(snap => {
      setClientsState(snap.clients)
      setInvoices(snap.invoices)
      setProjects(snap.projects)
    })
    loadActivityLog().then(all => {
      setActivityLog(all.filter(e => e.clientId === id).sort((a, b) => b.createdAt - a.createdAt))
    })
  }, [id])

  const client = clients.find(c => c.id === id)

  const [editing, setEditing]     = useState(false)
  const [form, setForm]           = useState({
    name: '', company: '', email: '', phone: '', address: '',
    timezone: '', defaultRate: '', paymentTerms: '', tags: '',
    notes: '', status: 'active', contractEnd: '', links: [] as LinkEntry[],
  })
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl,   setNewLinkUrl]   = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Activity log
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [activityNote, setActivityNote] = useState('')

  // Sync form/photo from client once data loads
  useEffect(() => {
    if (client && !editing) {
      setForm({
        name:         client.name ?? '',
        company:      client.company ?? '',
        email:        client.email ?? '',
        phone:        client.phone ?? '',
        address:      client.address ?? '',
        timezone:     client.timezone ?? '',
        defaultRate:  client.defaultRate != null ? String(client.defaultRate) : '',
        paymentTerms: client.paymentTerms ?? '',
        tags:         client.tags ?? '',
        notes:        client.notes ?? '',
        status:       client.status ?? 'active',
        contractEnd:  client.contractEnd ?? '',
        links:        (client.links ?? []) as LinkEntry[],
      })
      setPhotoUrl(client.photoUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id])

  if (!client) {
    return (
      <div className="page-wrap">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          Client not found.
          <br /><button className="btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/clients')}>← Back to Clients</button>
        </div>
      </div>
    )
  }

  // client is guaranteed non-null here (early return above handles null case)
  const clientNN = client!

  // Computed
  const clientInvoices = invoices.filter(inv => inv.clientName === clientNN.name)
  const totalRevenue   = clientInvoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
  const outstanding    = clientInvoices
    .filter(inv => new Set(['sent','viewed','overdue','partial']).has((inv.status||'').toLowerCase()))
    .reduce((s, inv) => s + ((Number(inv.subtotal)||0) - (Number(inv.amountPaid)||0)), 0)
  const clientProjects = projects.filter(p => p.clientId === clientNN.id)

  function persistUpdate(updated: Client) {
    const next = clients.map(c => c.id === updated.id ? updated : c)
    setClientsState(next)
    void saveClients(next)
  }

  function handleSave() {
    if (!form.name.trim()) return
    const updated: Client = {
      ...clientNN,
      name: form.name,
      company: form.company || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      timezone: form.timezone || undefined,
      defaultRate: form.defaultRate ? Number(form.defaultRate) : undefined,
      paymentTerms: form.paymentTerms || undefined,
      tags: form.tags || undefined,
      notes: form.notes || undefined,
      status: form.status,
      contractEnd: form.contractEnd || undefined,
      links: form.links.length > 0 ? form.links : undefined,
      photoUrl,
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
      persistUpdate({ ...clientNN, photoUrl: url })
    }
    reader.readAsDataURL(file)
  }

  function handleCancel() {
    setForm({
      name: clientNN.name,
      company: clientNN.company ?? '',
      email: clientNN.email ?? '',
      phone: clientNN.phone ?? '',
      address: clientNN.address ?? '',
      timezone: clientNN.timezone ?? '',
      defaultRate: clientNN.defaultRate != null ? String(clientNN.defaultRate) : '',
      paymentTerms: clientNN.paymentTerms ?? '',
      tags: clientNN.tags ?? '',
      notes: clientNN.notes ?? '',
      status: clientNN.status ?? 'active',
      contractEnd: clientNN.contractEnd ?? '',
      links: clientNN.links ?? [],
    })
    setEditing(false)
  }

  function handleDelete() {
    const next = clients.filter(c => c.id !== clientNN.id)
    setClientsState(next)
    void saveClients(next)
    navigate('/clients')
  }

  function addLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return
    setForm(f => ({ ...f, links: [...f.links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] }))
    setNewLinkLabel(''); setNewLinkUrl('')
  }
  function removeLink(i: number) {
    setForm(f => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }))
  }

  function addActivity() {
    if (!activityNote.trim()) return
    const entry: ActivityLogEntry = { id: uid(), clientId: clientNN.id, note: activityNote.trim(), createdAt: Date.now() }
    loadActivityLog().then(all => {
      void saveActivityLog([entry, ...all])
      setActivityLog([entry, ...activityLog])
      setActivityNote('')
    })
  }
  function deleteActivity(entryId: string) {
    loadActivityLog().then(all => {
      void saveActivityLog(all.filter(e => e.id !== entryId))
      setActivityLog(activityLog.filter(e => e.id !== entryId))
    })
  }

  async function sendReminder() {
    const settings = await loadSettings()
    const unpaidInvs = clientInvoices.filter(inv =>
      new Set(['sent','viewed','overdue','partial']).has((inv.status||'').toLowerCase()))
    if (unpaidInvs.length === 0) return
    const totalOwed = unpaidInvs.reduce((s, inv) => s + ((Number(inv.subtotal)||0) - (Number(inv.amountPaid)||0)), 0)
    const companyName = settings.companyName || 'YVA Staffing'
    const invoiceList = unpaidInvs.map(inv => `  • ${inv.number} — $${(Number(inv.subtotal)||0).toFixed(2)}`).join('\n')
    let bodyText: string
    if (settings.reminderEmailTemplate) {
      bodyText = settings.reminderEmailTemplate
        .replace(/\{clientName\}/g, clientNN.name)
        .replace(/\{invoiceNumber\}/g, unpaidInvs.length === 1 ? unpaidInvs[0].number : `${unpaidInvs.length} invoices`)
        .replace(/\{amount\}/g, `$${totalOwed.toFixed(2)}`)
        .replace(/\{dueDate\}/g, unpaidInvs[0]?.dueDate || '')
        .replace(/\{companyName\}/g, companyName)
    } else {
      bodyText = `Hi ${clientNN.name},\n\nThis is a friendly reminder that you have ${unpaidInvs.length === 1 ? 'an outstanding invoice' : `${unpaidInvs.length} outstanding invoices`} totaling $${totalOwed.toFixed(2)}:\n\n${invoiceList}\n\nPlease let us know when we can expect payment.\n\n${settings.emailSignature || companyName}`
    }
    const subject = `Outstanding Balance Reminder — ${companyName}`
    sendEmail(clientNN.email || '', subject, bodyText)
  }

  const color = avatarColor(clientNN.name)

  return (
    <div className="page-wrap" style={{ maxWidth: 980 }}>
      <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }} />

      <button className="btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/clients')}>
        ← Back to Clients
      </button>

      {/* Header */}
      <div className="profile-header">
        <div className="profile-header-left">
          <div className="avatar-wrap" title="Click to change photo" onClick={() => photoInputRef.current?.click()}>
            {photoUrl
              ? <img className="avatar-photo" src={photoUrl} alt={clientNN.name} />
              : <div className="avatar profile-avatar" style={{ background: color }}>{initials(clientNN.name)}</div>
            }
            <span className="avatar-cam">📷</span>
          </div>
          <div>
            {editing
              ? <input className="form-input profile-name-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              : <h1 className="profile-name">{clientNN.name}</h1>
            }
            <div className="profile-sub">
              {clientNN.company && <span style={{ color: 'var(--muted)' }}>{clientNN.company}</span>}
              {clientNN.company && clientNN.email && <span style={{ color: 'var(--muted)' }}> · </span>}
              {clientNN.email && <span style={{ color: 'var(--muted)' }}>{clientNN.email}</span>}
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
              <span className={`badge ${statusBadge(clientNN.status || 'lead')}`} style={{ fontSize: 13 }}>{clientNN.status || 'Lead'}</span>
              {outstanding > 0 && clientNN.email && (
                <button className="btn-ghost btn-sm" style={{ color: '#fb923c' }} onClick={sendReminder}>✉ Remind</button>
              )}
              <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit Profile</button>
              <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
        </div>
      </div>

      {/* KPI row */}
      {!editing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Total Revenue', value: `$${(totalRevenue/1000).toFixed(1)}k`, color: 'var(--gold)' },
            { label: 'Invoices', value: String(clientInvoices.length), color: 'var(--text)' },
            { label: 'Outstanding', value: outstanding > 0 ? `$${outstanding.toFixed(2)}` : '$0', color: outstanding > 0 ? '#f87171' : 'var(--success)' },
            { label: 'Projects', value: String(clientProjects.length), color: '#60a5fa' },
          ].map(({ label, value, color: c }) => (
            <div key={label} className="settings-stat-card">
              <div className="settings-stat-count" style={{ color: c, fontSize: 18 }}>{value}</div>
              <div className="settings-stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="profile-grid">
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Info */}
          <div className="data-card">
            <div className="data-card-title">Client Information</div>
            <div className="profile-fields">
              {editing ? (
                <>
                  <div className="profile-field">
                    <span className="profile-field-label">Company</span>
                    <input className="form-input form-input-sm" value={form.company} onChange={e => setForm(f => ({...f, company: e.target.value}))} placeholder="Legal entity name" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Stage</span>
                    <select className="form-select form-input-sm" value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                      {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Email</span>
                    <input className="form-input form-input-sm" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Phone</span>
                    <input className="form-input form-input-sm" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Billing Address</span>
                    <input className="form-input form-input-sm" value={form.address} onChange={e => setForm(f => ({...f, address: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Timezone</span>
                    <input className="form-input form-input-sm" value={form.timezone} onChange={e => setForm(f => ({...f, timezone: e.target.value}))} placeholder="EST / PST" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Default Rate ($/hr)</span>
                    <input className="form-input form-input-sm" type="number" value={form.defaultRate} onChange={e => setForm(f => ({...f, defaultRate: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Payment Terms</span>
                    <select className="form-select form-input-sm" value={form.paymentTerms} onChange={e => setForm(f => ({...f, paymentTerms: e.target.value}))}>
                      <option value="">— Not set —</option>
                      <option>On receipt</option><option>Net 7</option><option>Net 15</option><option>Net 30</option>
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Contract End</span>
                    <input className="form-input form-input-sm" type="date" value={form.contractEnd} onChange={e => setForm(f => ({...f, contractEnd: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Tags</span>
                    <input className="form-input form-input-sm" value={form.tags} onChange={e => setForm(f => ({...f, tags: e.target.value}))} placeholder="Law firm, US, High priority" />
                  </div>
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Notes</span>
                    <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
                  </div>
                  {/* Links edit */}
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Links</span>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {form.links.map((lk, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <a href={lk.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, color: 'var(--gold)' }}>{lk.label}</a>
                          <button className="btn-icon btn-danger" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => removeLink(i)}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input className="form-input form-input-sm" value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)} placeholder="Label" style={{ flex: 1 }} />
                        <input className="form-input form-input-sm" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..." style={{ flex: 2 }} />
                        <button className="btn-ghost btn-sm" onClick={addLink} disabled={!newLinkLabel.trim() || !newLinkUrl.trim()}>+ Add</button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {[
                    { label: 'Company',         value: clientNN.company },
                    { label: 'Stage',           value: clientNN.status || 'Lead' },
                    { label: 'Email',           value: clientNN.email },
                    { label: 'Phone',           value: clientNN.phone },
                    { label: 'Address',         value: clientNN.address },
                    { label: 'Timezone',        value: clientNN.timezone },
                    { label: 'Default Rate',    value: clientNN.defaultRate ? `$${clientNN.defaultRate}/hr` : undefined },
                    { label: 'Payment Terms',   value: clientNN.paymentTerms },
                    { label: 'Contract End',    value: clientNN.contractEnd },
                    { label: 'Tags',            value: clientNN.tags },
                  ].map(({ label, value }) => value ? (
                    <div key={label} className="profile-field">
                      <span className="profile-field-label">{label}</span>
                      <span className="profile-field-value">{value}</span>
                    </div>
                  ) : null)}
                  {clientNN.notes && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Notes</span>
                      <span className="profile-field-value" style={{ whiteSpace: 'pre-wrap' }}>{clientNN.notes}</span>
                    </div>
                  )}
                  {(clientNN.links ?? []).length > 0 && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Links</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(clientNN.links ?? []).map((lk, i) => (
                          <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="card-link-pill">{lk.label}</a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Projects */}
          {clientProjects.length > 0 && (
            <div className="data-card">
              <div className="data-card-title">Projects</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                {clientProjects.map(p => (
                  <button key={p.id} className="btn-ghost btn-sm" onClick={() => navigate('/projects/' + p.id)} style={{ fontSize: 12 }}>
                    {p.name}
                    {p.status && <span style={{ marginLeft: 6, color: 'var(--muted)', fontSize: 11 }}>{p.status}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Invoice history */}
          {clientInvoices.length > 0 && (
            <div className="data-card">
              <div className="data-card-title">Invoice History</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
                  <tbody>
                    {clientInvoices.slice(0, 10).map(inv => (
                      <tr key={inv.id}>
                        <td className="td-name">{inv.number}</td>
                        <td className="td-muted">{inv.date || '—'}</td>
                        <td><span className="badge badge-gray" style={{ fontSize: 11 }}>{inv.status || 'draft'}</span></td>
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>${(Number(inv.subtotal)||0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right — Activity Log */}
        <div className="data-card" style={{ alignSelf: 'start' }}>
          <div className="data-card-title">Activity Log</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="form-input"
              style={{ flex: 1 }}
              value={activityNote}
              onChange={e => setActivityNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addActivity() } }}
              placeholder="Add a note, call summary, update..."
            />
            <button className="btn-primary btn-sm" onClick={addActivity} disabled={!activityNote.trim()}>Add</button>
          </div>
          {activityLog.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>No activity yet.</div>
          ) : (
            <div className="activity-timeline">
              {activityLog.map(entry => (
                <div key={entry.id} className="activity-item">
                  <div className="activity-dot" />
                  <div className="activity-body">
                    <div className="activity-note">{entry.note}</div>
                    <div className="activity-time">{fmtTimestamp(entry.createdAt)}</div>
                  </div>
                  <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '2px 5px', opacity: .5 }} onClick={() => deleteActivity(entry.id)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete {clientNN.name}?</div>
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
