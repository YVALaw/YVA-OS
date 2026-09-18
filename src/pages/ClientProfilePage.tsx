import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ActivityLogEntry, Client, Employee, Invoice, Project } from '../data/types'
import { loadActivityLog, loadSettings, loadSnapshot, saveActivityLog, saveClients, saveProjects } from '../services/storage'
import { sendEmail } from '../services/gmail'
import { formatEmailList, parseEmailList } from '../utils/email'
import { formatHourlyRate } from '../utils/money'
import { Avatar, ProtoIcon, StatusChip, colorFromString, dueLabel, protoCurrency, protoDateShort } from '../components/PrototypeKit'

function uid() { return crypto.randomUUID() }

const STAGES = [
  { key: 'lead', label: 'Lead' },
  { key: 'prospect', label: 'Prospect' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'churned', label: 'Churned' },
]

type LinkEntry = { label: string; url: string }
type NewProjectForm = {
  name: string
  rate: string
  notes: string
  employeeIds: string[]
}

const EMPTY_PROJECT_FORM: NewProjectForm = {
  name: '',
  rate: '',
  notes: '',
  employeeIds: [],
}

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [clients, setClientsState] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [projectModal, setProjectModal] = useState(false)
  const [activityNote, setActivityNote] = useState('')
  const [projectForm, setProjectForm] = useState<NewProjectForm>(EMPTY_PROJECT_FORM)
  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    ccEmails: '',
    phone: '',
    address: '',
    timezone: '',
    defaultRate: '',
    paymentTerms: '',
    tags: '',
    notes: '',
    status: 'active',
    contractEnd: '',
    links: [] as LinkEntry[],
  })
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')

  useEffect(() => {
    loadSnapshot().then(snapshot => {
      setClientsState(snapshot.clients)
      setInvoices(snapshot.invoices)
      setProjects(snapshot.projects)
      setEmployees(snapshot.employees)
    })
  }, [])

  useEffect(() => {
    if (!id) return
    loadActivityLog().then(entries => {
      setActivityLog(entries.filter(entry => entry.clientId === id).sort((a, b) => b.createdAt - a.createdAt))
    })
  }, [id])

  const client = clients.find(entry => entry.id === id)

  useEffect(() => {
    if (!client || editing) return
    setForm({
      name: client.name ?? '',
      company: client.company ?? '',
      email: client.email ?? '',
      ccEmails: formatEmailList(client.ccEmails),
      phone: client.phone ?? '',
      address: client.address ?? '',
      timezone: client.timezone ?? '',
      defaultRate: client.defaultRate != null ? String(client.defaultRate) : '',
      paymentTerms: client.paymentTerms ?? '',
      tags: client.tags ?? '',
      notes: client.notes ?? '',
      status: client.status ?? 'active',
      contractEnd: client.contractEnd ?? '',
      links: client.links ?? [],
    })
  }, [client, editing])

  if (!client) {
    return (
      <div className="proto-page">
        <div className="proto-page-body">
          <div className="proto-empty">Client not found.</div>
        </div>
      </div>
    )
  }

  const clientNN = client

  const clientInvoices = invoices.filter(invoice => invoice.clientName === clientNN.name)
  const clientProjects = projects.filter(project => project.clientId === clientNN.id)
  const unpaidStatuses = new Set(['sent', 'viewed', 'overdue', 'partial'])
  const totalRevenue = clientInvoices.reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
  const totalPaid = clientInvoices
    .filter(invoice => (invoice.status || '').toLowerCase() === 'paid')
    .reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
  const outstanding = clientInvoices
    .filter(invoice => unpaidStatuses.has((invoice.status || '').toLowerCase()))
    .reduce((sum, invoice) => sum + Math.max(0, (Number(invoice.subtotal) || 0) - (Number(invoice.amountPaid) || 0)), 0)
  const billedMtd = clientInvoices
    .filter(invoice => (invoice.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
  const tagList = (clientNN.tags || '').split(',').map(tag => tag.trim()).filter(Boolean)

  function persistUpdate(updated: Client) {
    const next = clients.map(entry => entry.id === updated.id ? updated : entry)
    setClientsState(next)
    void saveClients(next)
  }

  function handleSave() {
    if (!form.name.trim()) return
    const cc = parseEmailList(form.ccEmails)
    if (cc.invalid.length > 0) {
      alert(`Invalid CC email${cc.invalid.length === 1 ? '' : 's'}: ${cc.invalid.join(', ')}`)
      return
    }
    persistUpdate({
      ...clientNN,
      name: form.name,
      company: form.company || undefined,
      email: form.email || undefined,
      ccEmails: cc.emails.length ? cc.emails : undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      timezone: form.timezone || undefined,
      defaultRate: form.defaultRate ? Number(form.defaultRate) : undefined,
      paymentTerms: form.paymentTerms || undefined,
      tags: form.tags || undefined,
      notes: form.notes || undefined,
      status: form.status || undefined,
      contractEnd: form.contractEnd || undefined,
      links: form.links.length ? form.links : undefined,
    })
    setEditing(false)
  }

  function handleCancel() {
    setEditing(false)
  }

  function handleDelete() {
    const next = clients.filter(entry => entry.id !== clientNN.id)
    setClientsState(next)
    void saveClients(next)
    navigate('/clients')
  }

  async function saveClientProject() {
    if (!projectForm.name.trim()) return
    const nextProject: Project = {
      id: uid(),
      name: projectForm.name.trim(),
      clientId: clientNN.id,
      rate: projectForm.rate ? Number(projectForm.rate) : undefined,
      status: 'active',
      billingModel: 'hourly',
      notes: projectForm.notes || undefined,
      employeeIds: Array.from(new Set(projectForm.employeeIds)),
      assignments: [],
    }
    const next = [...projects, nextProject]
    setProjects(next)
    try {
      await saveProjects(next)
      setProjectForm(EMPTY_PROJECT_FORM)
      setProjectModal(false)
    } catch (error) {
      setProjects(projects)
      alert(error instanceof Error ? error.message : 'Project could not be saved.')
    }
  }

  function addLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return
    setForm(current => ({ ...current, links: [...current.links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] }))
    setNewLinkLabel('')
    setNewLinkUrl('')
  }

  function removeLink(index: number) {
    setForm(current => ({ ...current, links: current.links.filter((_, currentIndex) => currentIndex !== index) }))
  }

  function addActivity() {
    if (!activityNote.trim()) return
    const entry: ActivityLogEntry = { id: uid(), clientId: clientNN.id, note: activityNote.trim(), createdAt: Date.now() }
    loadActivityLog().then(all => {
      void saveActivityLog([entry, ...all])
      setActivityLog(current => [entry, ...current])
      setActivityNote('')
    })
  }

  function deleteActivity(entryId: string) {
    loadActivityLog().then(all => {
      const next = all.filter(entry => entry.id !== entryId)
      void saveActivityLog(next)
      setActivityLog(current => current.filter(entry => entry.id !== entryId))
    })
  }

  async function sendReminder() {
    const settings = await loadSettings()
    const unpaidInvs = clientInvoices.filter(invoice => unpaidStatuses.has((invoice.status || '').toLowerCase()))
    if (unpaidInvs.length === 0) return
    const totalOwed = unpaidInvs.reduce((sum, invoice) => sum + Math.max(0, (Number(invoice.subtotal) || 0) - (Number(invoice.amountPaid) || 0)), 0)
    const companyName = settings.companyName || 'YVA Staffing'
    const invoiceList = unpaidInvs.map(invoice => `  • ${invoice.number} — $${(Number(invoice.subtotal) || 0).toFixed(2)}`).join('\n')
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
    sendEmail(clientNN.email || '', `Outstanding Balance Reminder — ${companyName}`, bodyText, { cc: clientNN.ccEmails || [] })
  }

  const daysToRenew = clientNN.contractEnd ? dueLabel(clientNN.contractEnd) : null

  return (
    <div className="proto-page">
      <div className="proto-profile-head">
        <button type="button" className="proto-back-link proto-plain-button" onClick={() => navigate('/clients')}>
          <ProtoIcon name="chevronL" size={12} />
          All Clients
        </button>
        <div className="proto-profile-row">
          <div className="proto-profile-main">
            <Avatar name={clientNN.name} color={colorFromString(clientNN.name)} size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 className="proto-profile-title">{clientNN.company || clientNN.name}</h1>
                <StatusChip status={(clientNN.status || 'active').toLowerCase()} filled />
              </div>
              <div className="proto-profile-meta">
                <span>{clientNN.name}</span>
                {clientNN.email ? <span>{clientNN.email}</span> : null}
                {clientNN.address ? <span>{clientNN.address.split(',')[0]}</span> : null}
                {clientNN.paymentTerms ? <span>{clientNN.paymentTerms}</span> : null}
                {daysToRenew ? <span>Contract: {daysToRenew}</span> : null}
              </div>
              {tagList.length ? (
                <div className="proto-tag-row">
                  {tagList.map(tag => <span key={tag} className="proto-tag">{tag}</span>)}
                </div>
              ) : null}
            </div>
          </div>
          <div className="proto-profile-actions">
            {clientNN.email ? <button type="button" className="proto-btn" onClick={() => {
              const params = new URLSearchParams()
              if (clientNN.ccEmails?.length) params.set('cc', formatEmailList(clientNN.ccEmails))
              window.location.href = `mailto:${clientNN.email}${params.toString() ? `?${params.toString()}` : ''}`
            }}><ProtoIcon name="mail" size={13} /> Email</button> : null}
            {clientNN.phone ? <button type="button" className="proto-btn" onClick={() => window.location.href = `tel:${clientNN.phone}`}><ProtoIcon name="phone" size={13} /> Call</button> : null}
            <button type="button" className="proto-btn" onClick={() => { setProjectForm(EMPTY_PROJECT_FORM); setProjectModal(true) }}><ProtoIcon name="plus" size={13} /> New Project</button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={() => navigate(`/invoice?new=1&client=${encodeURIComponent(clientNN.id)}`)}><ProtoIcon name="plus" size={13} /> New Invoice</button>
            <button type="button" className="proto-btn" onClick={() => setEditing(current => !current)}><ProtoIcon name="edit" size={13} /> {editing ? 'Close Edit' : 'Edit'}</button>
            <button type="button" className="proto-btn proto-btn-danger" onClick={() => setConfirmDelete(true)}><ProtoIcon name="trash" size={13} /> Delete</button>
          </div>
        </div>
      </div>

      <div className="proto-page-body">
        <div className="proto-kpi-grid-4" style={{ marginBottom: 14 }}>
          {[
            { label: 'Total billed', value: protoCurrency(totalRevenue), sub: `${clientInvoices.length} invoices`, color: '#22d3ee' },
            { label: 'Collected', value: protoCurrency(totalPaid), sub: `${Math.round((totalPaid / Math.max(1, totalRevenue)) * 100)}% of total`, color: '#22c55e' },
            { label: 'Outstanding', value: protoCurrency(outstanding), sub: `${clientInvoices.filter(invoice => unpaidStatuses.has((invoice.status || '').toLowerCase())).length} unpaid`, color: '#f87171' },
            { label: 'MTD', value: protoCurrency(billedMtd), sub: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), color: '#60a5fa' },
          ].map(metric => (
            <div key={metric.label} className="proto-kpi">
              <div className="proto-kpi-accent" style={{ background: metric.color }} />
              <div className="proto-kpi-label">{metric.label}</div>
              <div className="proto-kpi-value" style={{ marginTop: 8 }}>{metric.value}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>{metric.sub}</div>
            </div>
          ))}
        </div>

        {editing ? (
          <div className="proto-two-col">
            <div className="card" style={{ padding: 18 }}>
              <div className="proto-section-title" style={{ marginBottom: 14 }}>Client Details</div>
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Display Name</label>
                  <input className="form-input" value={form.name} onChange={(event) => setForm(current => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Company</label>
                  <input className="form-input" value={form.company} onChange={(event) => setForm(current => ({ ...current, company: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={(event) => setForm(current => ({ ...current, email: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">CC Emails</label>
                  <input className="form-input" value={form.ccEmails} onChange={(event) => setForm(current => ({ ...current, ccEmails: event.target.value }))} placeholder="ops@client.com, accounting@client.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={(event) => setForm(current => ({ ...current, phone: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <input className="form-input" value={form.timezone} onChange={(event) => setForm(current => ({ ...current, timezone: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Stage</label>
                  <select className="form-select" value={form.status} onChange={(event) => setForm(current => ({ ...current, status: event.target.value }))}>
                    {STAGES.map(stage => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                  </select>
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Address</label>
                  <input className="form-input" value={form.address} onChange={(event) => setForm(current => ({ ...current, address: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Default Rate</label>
                  <input className="form-input" value={form.defaultRate} onChange={(event) => setForm(current => ({ ...current, defaultRate: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Payment Terms</label>
                  <input className="form-input" value={form.paymentTerms} onChange={(event) => setForm(current => ({ ...current, paymentTerms: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Contract End</label>
                  <input className="form-input" type="date" value={form.contractEnd} onChange={(event) => setForm(current => ({ ...current, contractEnd: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tags</label>
                  <input className="form-input" value={form.tags} onChange={(event) => setForm(current => ({ ...current, tags: event.target.value }))} />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={4} value={form.notes} onChange={(event) => setForm(current => ({ ...current, notes: event.target.value }))} />
                </div>
              </div>
            </div>
            <div className="proto-sidebar-stack">
              <div className="card" style={{ padding: 18 }}>
                <div className="proto-section-title" style={{ marginBottom: 14 }}>Links</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {form.links.map((link, index) => (
                    <div key={`${link.label}-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <a href={link.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: 'var(--gold)', fontSize: 12 }}>{link.label}</a>
                      <button type="button" className="proto-btn proto-btn-danger" style={{ height: 28 }} onClick={() => removeLink(index)}>Remove</button>
                    </div>
                  ))}
                  <input className="form-input" placeholder="Label" value={newLinkLabel} onChange={(event) => setNewLinkLabel(event.target.value)} />
                  <input className="form-input" placeholder="https://..." value={newLinkUrl} onChange={(event) => setNewLinkUrl(event.target.value)} />
                  <button type="button" className="proto-btn" onClick={addLink}>Add Link</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="proto-btn" onClick={handleCancel}>Cancel</button>
                <button type="button" className="proto-btn proto-btn-primary" onClick={handleSave}>Save Changes</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="proto-two-col">
            <div className="proto-sidebar-stack">
              <div className="card proto-list-card">
                <div className="proto-list-card-head">
                  <div className="proto-section-title">Invoices</div>
                  <button type="button" className="proto-btn proto-btn-ghost" onClick={() => navigate('/invoice')}>View All</button>
                </div>
                <table className="proto-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Project</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientInvoices.slice(0, 8).map(invoice => (
                      <tr key={invoice.id} onClick={() => navigate(`/invoice?q=${encodeURIComponent(invoice.number)}`)}>
                        <td className="proto-mono" style={{ color: 'var(--gold)', fontWeight: 700 }}>{invoice.number}</td>
                        <td style={{ color: 'var(--muted)' }}>{invoice.projectName || '—'}</td>
                        <td className="proto-mono" style={{ color: 'var(--muted)' }}>{protoDateShort(invoice.date)}</td>
                        <td className="proto-mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{protoCurrency(Number(invoice.subtotal) || 0)}</td>
                        <td><StatusChip status={(invoice.status || 'draft').toLowerCase()} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="proto-btn proto-btn-ghost" style={{ height: 28 }} onClick={(event) => { event.stopPropagation(); navigate(`/invoice?preview=${encodeURIComponent(invoice.id)}`) }}>Preview</button>
                            <button type="button" className="proto-btn proto-btn-ghost" style={{ height: 28 }} onClick={(event) => { event.stopPropagation(); navigate(`/invoice?edit=${encodeURIComponent(invoice.id)}`) }}>Edit</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {clientInvoices.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>No invoices yet</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="card" style={{ padding: 18 }}>
                <div className="proto-section-title" style={{ marginBottom: 12 }}>Client Details</div>
                <div className="proto-detail-grid">
                  {[
                    { label: 'Email', value: client.email || '—' },
                    { label: 'Invoice CC', value: client.ccEmails?.length ? formatEmailList(client.ccEmails) : '—' },
                    { label: 'Phone', value: client.phone || '—' },
                    { label: 'Address', value: client.address || '—' },
                    { label: 'Timezone', value: client.timezone || '—' },
                    { label: 'Default Rate', value: client.defaultRate ? `${protoCurrency(Number(client.defaultRate))}/h` : '—' },
                    { label: 'Payment Terms', value: client.paymentTerms || '—' },
                    { label: 'Contract End', value: client.contractEnd ? protoDateShort(client.contractEnd) : '—' },
                    { label: 'Links', value: client.links?.length ? String(client.links.length) : '—' },
                  ].map(detail => (
                    <div key={detail.label} className="proto-detail-cell">
                      <div className="proto-eyebrow">{detail.label}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 4 }}>{detail.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="proto-sidebar-stack">
              <div className="card proto-list-card">
                <div className="proto-list-card-head">
                  <div className="proto-section-title">Active Projects</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="proto-btn proto-btn-primary" onClick={() => { setProjectForm(EMPTY_PROJECT_FORM); setProjectModal(true) }}>New Project</button>
                    <button type="button" className="proto-btn proto-btn-ghost" onClick={() => navigate('/projects')}>Open Projects</button>
                  </div>
                </div>
                <div>
                  {clientProjects.length === 0 ? (
                    <div className="proto-empty" style={{ padding: 24 }}>No projects yet</div>
                  ) : clientProjects.map(project => (
                    <button key={project.id} type="button" className="proto-list-row proto-plain-button" onClick={() => navigate(`/projects/${project.id}`)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span className="proto-mono" style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 3, background: 'var(--surf2)', color: 'var(--gold)', fontWeight: 700 }}>{project.name.slice(0, 4).toUpperCase()}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{project.name}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted)' }}>
                        <span>{(project.employeeIds || []).length} people · {project.status || 'planning'}</span>
                        <span className="proto-mono">{project.rate ? `${formatHourlyRate(project.rate)}/h` : '—'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card" style={{ padding: 18 }}>
                <div className="proto-section-title" style={{ marginBottom: 12 }}>Recent Activity</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input className="form-input" value={activityNote} onChange={(event) => setActivityNote(event.target.value)} placeholder="Add activity note…" />
                  <button type="button" className="proto-btn" onClick={addActivity}>Add</button>
                </div>
                <div className="proto-activity-list">
                  {activityLog.slice(0, 8).map(entry => (
                    <div key={entry.id} className="proto-activity-item">
                      <span className="proto-activity-icon"><ProtoIcon name="mail" size={11} /></span>
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>{entry.note}</div>
                        <div className="proto-mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 3 }}>{new Date(entry.createdAt).toLocaleString()}</div>
                      </div>
                      <button type="button" className="proto-btn proto-btn-danger" style={{ height: 28 }} onClick={() => deleteActivity(entry.id)}>Delete</button>
                    </div>
                  ))}
                  {activityLog.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>No activity logged yet.</div> : null}
                </div>
              </div>

              {outstanding > 0 ? (
                <div className="card" style={{ padding: 18 }}>
                  <div className="proto-section-title" style={{ marginBottom: 8 }}>Outstanding Balance</div>
                  <div className="proto-mono" style={{ fontSize: 26, fontWeight: 700, color: '#f87171' }}>{protoCurrency(outstanding)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>Send a reminder to nudge collection from the profile directly.</div>
                  <button type="button" className="proto-btn" style={{ marginTop: 12 }} onClick={() => void sendReminder()}><ProtoIcon name="send" size={12} /> Send Reminder</button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="proto-modal-scrim" onClick={() => setConfirmDelete(false)}>
          <div className="proto-modal-panel" style={{ width: 420 }} onClick={(event) => event.stopPropagation()}>
            <div className="proto-modal-head">
              <div>
                <div className="proto-modal-title">Delete client?</div>
                <div className="proto-modal-subtitle">This removes the client profile from the workspace.</div>
              </div>
            </div>
            <div className="proto-modal-body" style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.6 }}>
              This action cannot be undone.
            </div>
            <div className="proto-modal-foot">
              <button type="button" className="proto-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button type="button" className="proto-btn proto-btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {projectModal && (
        <div className="proto-modal-scrim" onClick={() => setProjectModal(false)}>
          <div className="proto-modal-panel" style={{ width: 560 }} onClick={(event) => event.stopPropagation()}>
            <div className="proto-modal-head">
              <div>
                <div className="proto-modal-title">New Project</div>
                <div className="proto-modal-subtitle">{clientNN.company || clientNN.name}</div>
              </div>
            </div>
            <div className="proto-modal-body">
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Project Name *</label>
                  <input className="form-input" value={projectForm.name} onChange={(event) => setProjectForm(current => ({ ...current, name: event.target.value }))} placeholder="Intake Specialist" />
                </div>
                <div className="form-group">
                  <label className="form-label">Hourly Rate</label>
                  <input className="form-input" type="number" inputMode="decimal" step="0.01" value={projectForm.rate} onChange={(event) => setProjectForm(current => ({ ...current, rate: event.target.value }))} placeholder="10.00" />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Team</label>
                  <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflow: 'auto' }}>
                    {employees.map(employee => {
                      const selected = projectForm.employeeIds.includes(employee.id)
                      return (
                        <button
                          key={employee.id}
                          type="button"
                          className="proto-btn proto-btn-ghost"
                          style={{ justifyContent: 'space-between' }}
                          onClick={() => setProjectForm(current => ({
                            ...current,
                            employeeIds: selected
                              ? current.employeeIds.filter(employeeId => employeeId !== employee.id)
                              : [...current.employeeIds, employee.id],
                          }))}
                        >
                          <span>{employee.name}</span>
                          <span style={{ color: selected ? 'var(--gold)' : 'var(--muted)', fontSize: 11 }}>{selected ? 'Selected' : employee.role || 'Team'}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={3} value={projectForm.notes} onChange={(event) => setProjectForm(current => ({ ...current, notes: event.target.value }))} placeholder="Scope, role details, billing notes..." />
                </div>
              </div>
            </div>
            <div className="proto-modal-foot">
              <button type="button" className="proto-btn" onClick={() => setProjectModal(false)}>Cancel</button>
              <button type="button" className="proto-btn proto-btn-primary" onClick={() => void saveClientProject()} disabled={!projectForm.name.trim()}>Add Project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
