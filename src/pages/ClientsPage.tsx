import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ActivityLogEntry, Client, Invoice, Project } from '../data/types'
import { loadSnapshot, saveClients, loadActivityLog, saveActivityLog, loadSettings } from '../services/storage'
import { sendEmail } from '../services/gmail'
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

type ClientStage = 'lead' | 'prospect' | 'active' | 'paused' | 'churned'
type ViewMode = 'cards' | 'kanban'

const STAGES: { key: ClientStage; label: string }[] = [
  { key: 'lead',     label: 'Lead' },
  { key: 'prospect', label: 'Prospect' },
  { key: 'active',   label: 'Active' },
  { key: 'paused',   label: 'Paused' },
  { key: 'churned',  label: 'Churned' },
]

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function stageColor(s?: string): string {
  switch ((s || 'lead').toLowerCase()) {
    case 'active':   return '#22c55e'
    case 'prospect': return '#f5b533'
    case 'paused':   return '#475569'
    case 'churned':  return '#ef4444'
    default:         return '#3b82f6'
  }
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

type LinkEntry = { label: string; url: string }
type FormData  = {
  name: string; company: string; email: string; phone: string; address: string
  timezone: string; defaultRate: string; paymentTerms: string; tags: string
  notes: string; status: string; contractEnd: string; links: LinkEntry[]
}
const EMPTY: FormData = {
  name: '', company: '', email: '', phone: '', address: '',
  timezone: '', defaultRate: '', paymentTerms: '', tags: '', notes: '',
  status: 'active', contractEnd: '', links: [],
}

function fmtTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ClientsPage() {
  const navigate = useNavigate()
  const [clients,  setClients]  = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    loadSnapshot().then(snap => {
      setClients(snap.clients)
      setInvoices(snap.invoices)
      setProjects(snap.projects)
    })
  }, [])
  const [view, setView]   = useState<ViewMode>('kanban')
  const [modal, setModal] = useState<null | 'add' | 'edit'>(null)
  const [form,  setForm]  = useState<FormData>(EMPTY)
  const [editId, setEditId]       = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl,   setNewLinkUrl]   = useState('')

  // Activity log
  const [activityClient, setActivityClient] = useState<Client | null>(null)
  const [activityLog, setActivityLog]       = useState<ActivityLogEntry[]>([])
  const [activityNote, setActivityNote]     = useState('')

  function openActivity(c: Client) {
    setActivityClient(c)
    loadActivityLog().then(all => {
      setActivityLog(all.filter(e => e.clientId === c.id).sort((a, b) => b.createdAt - a.createdAt))
    })
    setActivityNote('')
  }
  function addActivity() {
    if (!activityNote.trim() || !activityClient) return
    const entry: ActivityLogEntry = { id: uid(), clientId: activityClient.id, note: activityNote.trim(), createdAt: Date.now() }
    loadActivityLog().then(all => {
      void saveActivityLog([entry, ...all])
      setActivityLog([entry, ...activityLog])
      setActivityNote('')
    })
  }
  function deleteActivity(id: string) {
    loadActivityLog().then(all => {
      const next = all.filter(e => e.id !== id)
      void saveActivityLog(next)
      setActivityLog(activityLog.filter(e => e.id !== id))
    })
  }

  function persist(next: Client[]) { setClients(next); void saveClients(next) }

  function openAdd() { setForm({ ...EMPTY }); setEditId(null); setModal('add'); setNewLinkLabel(''); setNewLinkUrl('') }
  function openEdit(c: Client) {
    setForm({
      name: c.name, company: c.company ?? '', email: c.email ?? '',
      phone: c.phone ?? '', address: c.address ?? '',
      timezone: c.timezone ?? '', defaultRate: c.defaultRate != null ? String(c.defaultRate) : '',
      paymentTerms: c.paymentTerms ?? '', tags: c.tags ?? '',
      notes: c.notes ?? '', status: c.status ?? 'active',
      contractEnd: c.contractEnd ?? '', links: c.links ?? [],
    })
    setEditId(c.id); setModal('edit'); setNewLinkLabel(''); setNewLinkUrl('')
  }
  function saveForm() {
    if (!form.name.trim()) return
    const data: Partial<Client> = {
      name: form.name, company: form.company || undefined, email: form.email || undefined,
      phone: form.phone || undefined, address: form.address || undefined,
      timezone: form.timezone || undefined,
      defaultRate: form.defaultRate ? Number(form.defaultRate) : undefined,
      paymentTerms: form.paymentTerms || undefined, tags: form.tags || undefined,
      notes: form.notes || undefined, status: form.status,
      contractEnd: form.contractEnd || undefined,
      links: form.links.length > 0 ? form.links : undefined,
    }
    if (modal === 'add') persist([...clients, { id: uid(), ...data } as Client])
    else if (editId) persist(clients.map((c) => c.id === editId ? { ...c, ...data } : c))
    setModal(null)
  }
  function doDelete(id: string) { persist(clients.filter((c) => c.id !== id)); setConfirmDelete(null) }

  function moveStage(id: string, stage: ClientStage) {
    persist(clients.map((c) => c.id === id ? { ...c, status: stage } : c))
  }

  function addLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return
    setForm(f => ({ ...f, links: [...f.links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] }))
    setNewLinkLabel(''); setNewLinkUrl('')
  }
  function removeLink(i: number) {
    setForm(f => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }))
  }

  const filtered = clients.filter((c) =>
    `${c.name} ${c.email ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  )
  const byStage = (s: ClientStage) => filtered.filter((c) => (c.status || 'lead').toLowerCase() === s)

  function clientRevenue(id: string) {
    const name = clients.find(c => c.id === id)?.name
    return invoices.filter(inv => inv.clientName === name).reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
  }
  function clientProjects(id: string) {
    return projects.filter(p => p.clientId === id).length
  }
  function clientOutstanding(id: string) {
    const name = clients.find(c => c.id === id)?.name
    if (!name) return 0
    const unpaidStatuses = new Set(['sent', 'viewed', 'overdue', 'partial'])
    return invoices
      .filter(inv => inv.clientName === name && unpaidStatuses.has((inv.status || '').toLowerCase()))
      .reduce((s, inv) => s + ((Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)), 0)
  }
  async function sendClientReminder(c: Client) {
    const settings = await loadSettings()
    const unpaidInvs = invoices.filter(inv => {
      const unpaidStatuses = new Set(['sent', 'viewed', 'overdue', 'partial'])
      return inv.clientName === c.name && unpaidStatuses.has((inv.status || '').toLowerCase())
    })
    if (unpaidInvs.length === 0) return
    const totalOwed = unpaidInvs.reduce((s, inv) => s + ((Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)), 0)
    const companyName = settings.companyName || 'YVA Staffing'
    const invoiceList = unpaidInvs.map(inv => `  • ${inv.number} — $${(Number(inv.subtotal) || 0).toFixed(2)}`).join('\n')

    let bodyText: string
    if (settings.reminderEmailTemplate) {
      bodyText = settings.reminderEmailTemplate
        .replace(/\{clientName\}/g, c.name)
        .replace(/\{invoiceNumber\}/g, unpaidInvs.length === 1 ? unpaidInvs[0].number : `${unpaidInvs.length} invoices`)
        .replace(/\{amount\}/g, `$${totalOwed.toFixed(2)}`)
        .replace(/\{dueDate\}/g, unpaidInvs[0]?.dueDate || '')
        .replace(/\{companyName\}/g, companyName)
    } else {
      bodyText =
        `Hi ${c.name},\n\nThis is a friendly reminder that you have ${unpaidInvs.length === 1 ? 'an outstanding invoice' : `${unpaidInvs.length} outstanding invoices`} totaling $${totalOwed.toFixed(2)}:\n\n${invoiceList}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n${settings.emailSignature || companyName}`
    }
    const subject = `Outstanding Balance Reminder — ${companyName}`
    sendEmail(c.email || '', subject, bodyText)
  }

  const dragId = { current: null as string | null }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-header-actions">
          <input className="form-input" style={{ width: 200 }} placeholder="Search clients..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="view-toggle">
            <button className={`view-toggle-btn${view === 'cards' ? ' active' : ''}`} onClick={() => setView('cards')}>Cards</button>
            <button className={`view-toggle-btn${view === 'kanban' ? ' active' : ''}`} onClick={() => setView('kanban')}>Pipeline</button>
          </div>
          <button className="btn-primary" onClick={openAdd}>+ Add Client</button>
        </div>
      </div>

      {/* CARDS VIEW */}
      {view === 'cards' && (
        <div className="card-grid">
          {filtered.map((c) => {
            const rev = clientRevenue(c.id)
            const projCount = clientProjects(c.id)
            const outstanding = clientOutstanding(c.id)
            const color = avatarColor(c.name)
            return (
              <div key={c.id} className="entity-card" style={{ borderTop: `2px solid ${stageColor(c.status)}`, cursor: 'pointer' }} onClick={() => navigate('/clients/' + c.id)}>
                <div className="card-top">
                  <div className="card-top-left">
                    <div className="avatar" style={{ background: color }}>{initials(c.name)}</div>
                    <div>
                      <div className="card-name">{c.name}</div>
                      <div className="card-sub">{c.email || 'No email'}</div>
                    </div>
                  </div>
                  <span className={`badge ${stageBadge(c.status)}`}>{c.status || 'Lead'}</span>
                </div>
                <div className="card-stats">
                  <div className="stat-item">
                    <div className="stat-label">Revenue</div>
                    <div className="stat-value stat-value-gold">${(rev / 1000).toFixed(1)}k</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">Projects</div>
                    <div className="stat-value">{projCount}</div>
                  </div>
                  {outstanding > 0 && (
                    <div className="stat-item">
                      <div className="stat-label">Outstanding</div>
                      <div className="stat-value" style={{ color: '#f87171', fontSize: 13 }}>${outstanding.toFixed(2)}</div>
                    </div>
                  )}
                  {c.paymentTerms && (
                    <div className="stat-item">
                      <div className="stat-label">Terms</div>
                      <div className="stat-value" style={{ fontSize: 12 }}>{c.paymentTerms}</div>
                    </div>
                  )}
                  {c.address && (
                    <div className="stat-item">
                      <div className="stat-label">Location</div>
                      <div className="stat-value" style={{ fontSize: 12 }}>{c.address.split(',')[0]}</div>
                    </div>
                  )}
                </div>
                {c.contractEnd && (() => {
                  const daysLeft = Math.ceil((new Date(c.contractEnd).getTime() - Date.now()) / 86400000)
                  if (daysLeft > 60) return null
                  return (
                    <div style={{ fontSize: 11, color: daysLeft <= 0 ? '#ef4444' : daysLeft <= 30 ? '#f97316' : '#f5b533', marginTop: 4, fontWeight: 600 }}>
                      {daysLeft <= 0 ? `Contract expired ${Math.abs(daysLeft)}d ago` : `Contract ends in ${daysLeft}d (${c.contractEnd})`}
                    </div>
                  )
                })()}
                {c.notes && <div className="card-detail" style={{ fontSize: 11, opacity: .7 }}>{c.notes}</div>}
                {(c.links ?? []).length > 0 && (
                  <div className="card-links">
                    {(c.links ?? []).map((lk, i) => (
                      <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="card-link-pill">{lk.label}</a>
                    ))}
                  </div>
                )}
                <div className="card-footer">
                  <button className="btn-xs btn-ghost" onClick={ev => { ev.stopPropagation(); navigate('/clients/' + c.id) }}>View Profile</button>
                  {outstanding > 0 && c.email && (
                    <button className="btn-xs btn-ghost" style={{ color: '#fb923c' }} onClick={ev => { ev.stopPropagation(); sendClientReminder(c) }}>✉ Remind</button>
                  )}
                  <button className="btn-xs btn-ghost" onClick={ev => { ev.stopPropagation(); openEdit(c) }}>Edit</button>
                  <button className="btn-xs btn-danger" onClick={ev => { ev.stopPropagation(); setConfirmDelete(c.id) }}>Remove</button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 14 }}>
              {search ? 'No clients match your search.' : 'No clients yet. Add your first.'}
            </div>
          )}
        </div>
      )}

      {/* KANBAN VIEW */}
      {view === 'kanban' && (
        <div className="kanban-board">
          {STAGES.map(({ key, label }) => (
            <div key={key} className={`kanban-col kanban-col-${key}`}>
              <div className="kanban-col-header">
                <span className="kanban-stage-dot" />
                <span className="kanban-col-label">{label}</span>
                <span className="kanban-col-count">{byStage(key).length}</span>
              </div>
              <div className="kanban-cards" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId.current) { moveStage(dragId.current, key); dragId.current = null } }}>
                {byStage(key).map((c) => (
                  <div key={c.id} className="kanban-card" draggable onDragStart={() => { dragId.current = c.id }}>
                    <div className="kanban-card-name">{c.name}</div>
                    <div className="kanban-card-meta">{c.email || 'No email'}</div>
                    {(c.links ?? []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                        {(c.links ?? []).map((lk, i) => (
                          <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="card-link-pill card-link-pill-sm" onClick={e => e.stopPropagation()}>{lk.label}</a>
                        ))}
                      </div>
                    )}
                    <div className="kanban-card-actions">
                      <button className="btn-xs btn-ghost" onClick={() => openActivity(c)}>Activity</button>
                      <button className="btn-xs btn-ghost" onClick={() => openEdit(c)}>Edit</button>
                      <button className="btn-xs btn-danger" onClick={() => setConfirmDelete(c.id)}>×</button>
                    </div>
                  </div>
                ))}
                {byStage(key).length === 0 && <div className="kanban-empty">Drop here</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{modal === 'add' ? 'Add Client' : 'Edit Client'}</h2>
              <button className="modal-close btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Display Name *</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Client / contact name" />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Company / Legal Name</label>
                  <input className="form-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Legal entity name (optional)" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="billing@client.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Stage</label>
                  <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <input className="form-input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="EST / PST" />
                </div>
                <div className="form-group">
                  <label className="form-label">Default Rate ($/hr)</label>
                  <input className="form-input" type="number" value={form.defaultRate} onChange={(e) => setForm({ ...form, defaultRate: e.target.value })} placeholder="8.50" />
                </div>
                <div className="form-group">
                  <label className="form-label">Payment Terms</label>
                  <select className="form-select" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
                    <option value="">— Not set —</option>
                    <option value="On receipt">On receipt</option>
                    <option value="Net 7">Net 7</option>
                    <option value="Net 15">Net 15</option>
                    <option value="Net 30">Net 30</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Contract End Date</label>
                  <input className="form-input" type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Billing Address</label>
                  <input className="form-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, City, State" />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Tags</label>
                  <input className="form-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="e.g. Law firm, US, High priority" />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Internal Notes</label>
                  <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Scope, preferred communication, special billing rules..." />
                </div>

                {/* Links section */}
                <div className="form-group form-group-full">
                  <label className="form-label">Documents &amp; Links</label>
                  {form.links.length > 0 && (
                    <div className="links-list">
                      {form.links.map((lk, i) => (
                        <div key={i} className="link-item">
                          <a href={lk.url} target="_blank" rel="noopener noreferrer" className="link-item-label">{lk.label}</a>
                          <span className="link-item-url">{lk.url}</span>
                          <button className="btn-icon btn-danger" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => removeLink(i)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="link-add-row">
                    <input className="form-input" value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)} placeholder="Label (e.g. Contract)" style={{ flex: 1 }} />
                    <input className="form-input" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..." style={{ flex: 2 }} />
                    <button className="btn-ghost btn-sm" onClick={addLink} disabled={!newLinkLabel.trim() || !newLinkUrl.trim()}>+ Add</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveForm} disabled={!form.name.trim()}>
                {modal === 'add' ? 'Add Client' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Log Modal */}
      {activityClient && (
        <div className="modal-overlay" onClick={() => setActivityClient(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Activity — {activityClient.name}</h2>
              <button className="modal-close btn-icon" onClick={() => setActivityClient(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {/* Add note */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  value={activityNote}
                  onChange={e => setActivityNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addActivity() } }}
                  placeholder="Add a note, call summary, update..."
                  autoFocus
                />
                <button className="btn-primary btn-sm" onClick={addActivity} disabled={!activityNote.trim()}>Add</button>
              </div>

              {/* Timeline */}
              {activityLog.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 13 }}>
                  No activity yet. Add a note above.
                </div>
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
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setActivityClient(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Remove client?</div>
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
