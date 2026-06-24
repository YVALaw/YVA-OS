import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ActivityLogEntry, Client, Invoice, Project } from '../data/types'
import { loadSnapshot, saveClients, loadActivityLog, saveActivityLog, loadSettings } from '../services/storage'
import { sendEmail } from '../services/gmail'
import { formatEmailList, parseEmailList } from '../utils/email'
import { Avatar, KanbanColumn, KanbanItem, ProtoIcon, SearchField, StatusChip, ToggleGroup, colorFromString, dueLabel, protoCurrency, protoDateShort, useKanbanDnd } from '../components/PrototypeKit'
function uid() { return crypto.randomUUID() }

type ClientStage = 'lead' | 'prospect' | 'active' | 'paused' | 'churned'
type ViewMode = 'cards' | 'kanban' | 'table'

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
  name: string; company: string; email: string; ccEmails: string; phone: string; address: string
  timezone: string; defaultRate: string; paymentTerms: string; tags: string
  notes: string; status: string; contractEnd: string; links: LinkEntry[]
}
const EMPTY: FormData = {
  name: '', company: '', email: '', ccEmails: '', phone: '', address: '',
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
  const dragSuppressRef = useRef<string | null>(null)

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
      name: c.name, company: c.company ?? '', email: c.email ?? '', ccEmails: formatEmailList(c.ccEmails),
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
    const cc = parseEmailList(form.ccEmails)
    if (cc.invalid.length > 0) {
      alert(`Invalid CC email${cc.invalid.length === 1 ? '' : 's'}: ${cc.invalid.join(', ')}`)
      return
    }
    const data: Partial<Client> = {
      name: form.name, company: form.company || undefined, email: form.email || undefined,
      ccEmails: cc.emails.length ? cc.emails : undefined,
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
  const totalRevenue = filtered.reduce((sum, client) => sum + clientRevenue(client.id), 0)
  const totalOutstanding = filtered.reduce((sum, client) => sum + clientOutstanding(client.id), 0)
  const activeClients = filtered.filter(c => (c.status || 'lead').toLowerCase() === 'active').length
  const contractRisk = filtered.filter((c) => {
    if (!c.contractEnd) return false
    const daysLeft = Math.ceil((new Date(c.contractEnd).getTime() - Date.now()) / 86400000)
    return daysLeft <= 45
  }).length

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
    sendEmail(c.email || '', subject, bodyText, { cc: c.ccEmails || [] })
  }

  const stageCounts = useMemo(() => ({
    lead: clients.filter(client => (client.status || 'lead').toLowerCase() === 'lead').length,
    prospect: clients.filter(client => (client.status || 'lead').toLowerCase() === 'prospect').length,
    active: clients.filter(client => (client.status || 'lead').toLowerCase() === 'active').length,
    paused: clients.filter(client => (client.status || 'lead').toLowerCase() === 'paused').length,
    churned: clients.filter(client => (client.status || 'lead').toLowerCase() === 'churned').length,
  }), [clients])
  const dnd = useKanbanDnd(clients, (updater) => {
    const next = typeof updater === 'function' ? updater(clients) : updater
    persist(next)
  }, (client, newStageId) => ({ ...client, status: newStageId }))
  const panelOpen = modal !== null

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row">
          <div>
            <div className="proto-eyebrow" style={{ color: 'var(--gold)', marginBottom: 8 }}>People · Clients</div>
            <h1 className="page-title">Clients</h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6, fontWeight: 500 }}>
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>{clients.length}</span> total · {activeClients} active · {protoCurrency(totalOutstanding)} outstanding
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="proto-btn">
              <ProtoIcon name="download" size={13} />
              Export
            </button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={openAdd}>
              <ProtoIcon name="plus" size={13} />
              NEW CLIENT
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <SearchField value={search} onChange={setSearch} placeholder="Search clients, tags, contacts…" minWidth={280} />
          <ToggleGroup
            value={view}
            onChange={setView}
            options={[
              { id: 'kanban', label: 'Kanban' },
              { id: 'cards', label: 'Cards' },
              { id: 'table', label: 'Table' },
            ]}
          />
        </div>
      </div>

      <div className="proto-page-body">
        {view === 'kanban' && (
          <div className="kanban" style={{ ['--kanban-cols' as never]: STAGES.length }}>
            {STAGES.map(stage => {
              const laneClients = byStage(stage.key)
              const laneOutstanding = laneClients.reduce((sum, client) => sum + clientOutstanding(client.id), 0)
              return (
                <KanbanColumn
                  key={stage.key}
                  column={{ id: stage.key, label: stage.label, items: laneClients }}
                  dnd={dnd}
                  accent={stageColor(stage.key)}
                  headerRight={<button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={openAdd}><ProtoIcon name="plus" size={12} /></button>}
                >
                  {laneClients.map(client => {
                    const mtdBilled = invoices
                      .filter(invoice => invoice.clientName === client.name && (invoice.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7))
                      .reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
                    return (
                      <KanbanItem key={client.id} item={client} dnd={dnd} accent={stageColor(stage.key)} sourceColumnId={stage.key} onClick={() => navigate(`/clients/${client.id}`)}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                          <Avatar name={client.name} color={colorFromString(client.name)} size="sm" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.company || client.name}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1 }}>{client.name}</div>
                          </div>
                        </div>
                        {client.tags ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                            {client.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 2).map(tag => (
                              <span key={tag} style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', padding: '1px 5px', background: 'var(--surf3)', color: 'var(--muted)', borderRadius: 3 }}>{tag}</span>
                            ))}
                          </div>
                        ) : null}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                          <span className="proto-mono" style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 700 }}>{protoCurrency(mtdBilled)}</span>
                          {clientOutstanding(client.id) > 0 ? <span className="proto-mono" style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>{protoCurrency(clientOutstanding(client.id))} due</span> : null}
                          {client.contractEnd ? <span className="proto-mono" style={{ fontSize: 10, color: '#fb923c', fontWeight: 700 }}>↻ {dueLabel(client.contractEnd)}</span> : null}
                        </div>
                      </KanbanItem>
                    )
                  })}
                  <div style={{ marginTop: 'auto', padding: '6px 8px', borderRadius: 6, background: 'var(--surf2)', fontSize: 10.5, display: 'flex', justifyContent: 'space-between', color: 'var(--muted)' }} className="proto-mono">
                    <span>{laneClients.length} client{laneClients.length === 1 ? '' : 's'}</span>
                    <span style={{ color: laneOutstanding > 0 ? '#f87171' : 'var(--gold)', fontWeight: 700 }}>{protoCurrency(laneOutstanding)}</span>
                  </div>
                </KanbanColumn>
              )
            })}
          </div>
        )}

        {view === 'cards' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filtered.map(client => {
              const outstanding = clientOutstanding(client.id)
              const billedMtd = invoices
                .filter(invoice => invoice.clientName === client.name && (invoice.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7))
                .reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
              const tagList = (client.tags || '').split(',').map(tag => tag.trim()).filter(Boolean)
              return (
                <button
                  key={client.id}
                  type="button"
                  className="proto-plain-button card"
                  onClick={() => navigate(`/clients/${client.id}`)}
                  style={{ padding: 16, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Avatar name={client.name} color={colorFromString(client.name)} size="lg" />
                    <StatusChip status={(client.status || 'lead').toLowerCase()} filled />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.005em' }}>{client.company || client.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{client.name} · {(client.address || '').split(',')[0] || 'No city'}</div>
                  </div>
                  {tagList.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {tagList.map(tag => <span key={tag} style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', padding: '2px 7px', background: 'var(--surf2)', color: 'var(--muted)', borderRadius: 3 }}>{tag}</span>)}
                    </div>
                  ) : null}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <div>
                      <div className="proto-eyebrow">MTD</div>
                      <div className="proto-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{protoCurrency(billedMtd)}</div>
                    </div>
                    <div>
                      <div className="proto-eyebrow">Outstanding</div>
                      <div className="proto-mono" style={{ fontSize: 14, fontWeight: 700, color: outstanding > 0 ? '#f87171' : 'var(--dim)', marginTop: 2 }}>{protoCurrency(outstanding)}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {view === 'table' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="proto-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Stage</th>
                  <th>Tags</th>
                  <th style={{ textAlign: 'right' }}>Billed MTD</th>
                  <th style={{ textAlign: 'right' }}>Outstanding</th>
                  <th>Contract</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(client => {
                  const billedMtd = invoices
                    .filter(invoice => invoice.clientName === client.name && (invoice.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7))
                    .reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
                  const tagList = (client.tags || '').split(',').map(tag => tag.trim()).filter(Boolean)
                  return (
                    <tr key={client.id} onClick={() => navigate(`/clients/${client.id}`)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={client.name} color={colorFromString(client.name)} size="sm" />
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{client.company || client.name}</span>
                        </div>
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{client.name}</td>
                      <td><StatusChip status={(client.status || 'lead').toLowerCase()} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {tagList.slice(0, 2).map(tag => <span key={tag} style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', padding: '2px 6px', background: 'var(--surf2)', color: 'var(--muted)', borderRadius: 3 }}>{tag}</span>)}
                        </div>
                      </td>
                      <td className="proto-mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{protoCurrency(billedMtd)}</td>
                      <td className="proto-mono" style={{ textAlign: 'right', fontWeight: 700, color: clientOutstanding(client.id) > 0 ? '#f87171' : 'var(--dim)' }}>{protoCurrency(clientOutstanding(client.id))}</td>
                      <td className="proto-mono" style={{ color: 'var(--muted)' }}>{client.contractEnd ? protoDateShort(client.contractEnd) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Panel */}
      {panelOpen && (
        <div className="sheet-overlay" onClick={() => setModal(null)}>
          <aside className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">
              <div>
                <div className="sheet-eyebrow">Client Workspace</div>
                <h2 className="sheet-title">{modal === 'add' ? 'Create Client' : 'Edit Client'}</h2>
                <p className="sheet-subtitle">Keep the pipeline clean while updating the key billing, contact, and contract details here.</p>
              </div>
              <button className="modal-close btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="sheet-body">
              <div className="sheet-section">
                <div className="sheet-section-title">Identity</div>
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
                    <label className="form-label">Stage</label>
                    <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Contract End Date</label>
                    <input className="form-input" type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="sheet-section">
                <div className="sheet-section-title">Billing & Contact</div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="billing@client.com" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">CC Emails</label>
                    <input className="form-input" value={form.ccEmails} onChange={(e) => setForm({ ...form, ccEmails: e.target.value })} placeholder="ops@client.com, accounting@client.com" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Phone</label>
                    <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
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
                  <div className="form-group form-group-full">
                    <label className="form-label">Billing Address</label>
                    <input className="form-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, City, State" />
                  </div>
                </div>
              </div>

              <div className="sheet-section">
                <div className="sheet-section-title">Context</div>
              <div className="form-grid-2">
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
            </div>
            <div className="sheet-footer">
              <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveForm} disabled={!form.name.trim()}>
                {modal === 'add' ? 'Add Client' : 'Save Changes'}
              </button>
            </div>
          </aside>
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
