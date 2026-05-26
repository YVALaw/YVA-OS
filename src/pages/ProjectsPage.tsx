import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Employee, Expense, Invoice, Project, Task, TaskStatus } from '../data/types'
import { loadExpenses, loadSnapshot, loadTasks, saveExpenses, saveProjects, saveTasks } from '../services/storage'
import { formatMoney } from '../utils/money'
import {
  Avatar,
  Drawer,
  KanbanColumn,
  KanbanItem,
  Modal,
  ProtoIcon,
  SearchField,
  StatusChip,
  ToggleGroup,
  colorFromString,
  protoCurrency,
  protoDate,
  useKanbanDnd,
} from '../components/PrototypeKit'

function uid() {
  return crypto.randomUUID()
}

type ProjectStage = 'planning' | 'active' | 'hiring' | 'review' | 'on-hold' | 'completed'
type ViewMode = 'kanban' | 'table'

const STAGES: { id: ProjectStage; label: string; color: string }[] = [
  { id: 'planning', label: 'Planning', color: '#3b82f6' },
  { id: 'active', label: 'Active', color: '#22c55e' },
  { id: 'hiring', label: 'Hiring', color: '#f97316' },
  { id: 'review', label: 'Review', color: '#a855f7' },
  { id: 'on-hold', label: 'On Hold', color: '#22d3ee' },
  { id: 'completed', label: 'Completed', color: '#14b8a6' },
]

const TASK_COLS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: 'To Do' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
]

type LinkEntry = { label: string; url: string }

type FormData = {
  name: string
  rate: string
  budget: string
  clientId: string
  status: ProjectStage
  billingModel: string
  startDate: string
  endDate: string
  description: string
  projectNeeds: string
  notes: string
  links: LinkEntry[]
  employeeIds: string[]
}

const EMPTY_FORM: FormData = {
  name: '',
  rate: '',
  budget: '',
  clientId: '',
  status: 'planning',
  billingModel: 'hourly',
  startDate: '',
  endDate: '',
  description: '',
  projectNeeds: '',
  notes: '',
  links: [],
  employeeIds: [],
}

function normalizeProjectStage(value?: string | null): ProjectStage {
  const normalized = String(value || 'planning').trim().toLowerCase().replace(/\s+/g, '-')
  switch (normalized) {
    case 'active':
      return 'active'
    case 'hiring':
      return 'hiring'
    case 'review':
      return 'review'
    case 'on-hold':
    case 'onhold':
    case 'on_hold':
      return 'on-hold'
    case 'completed':
    case 'done':
      return 'completed'
    case 'planning':
    default:
      return 'planning'
  }
}

function currentMonthKey(date?: string) {
  return date ? date.slice(0, 7) === new Date().toISOString().slice(0, 7) : false
}

function projectPrefix(project: Project) {
  const words = project.name.trim().split(/\s+/).filter(Boolean)
  const value = words.length > 1
    ? words.map(word => word[0]).join('')
    : (project.name.trim().slice(0, 4) || 'PRJ')
  return value.toUpperCase().slice(0, 4)
}

function projectClientName(project: Project, clients: Client[]) {
  if (!project.clientId) return null
  return clients.find(client => client.id === project.clientId)?.company || clients.find(client => client.id === project.clientId)?.name || null
}

function invoiceHours(invoice: Invoice, projectRate?: string | number) {
  const explicit = invoice.items?.reduce((sum, item) => sum + Number(item.hoursTotal || 0), 0) || 0
  if (explicit > 0) return explicit
  const rate = Number(projectRate || 0)
  const subtotal = Number(invoice.subtotal || 0)
  if (rate > 0 && subtotal > 0) return subtotal / rate
  return 0
}

function projectInvoiceStats(project: Project, invoices: Invoice[]) {
  const related = invoices.filter(invoice => invoice.projectId === project.id || invoice.projectName === project.name)
  const mtd = related.filter(invoice => currentMonthKey(invoice.date))
  const billedMtd = mtd.reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0)
  const billedLifetime = related.reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0)
  const hoursMtd = mtd.reduce((sum, invoice) => sum + invoiceHours(invoice, project.rate), 0)
  return { related, billedMtd, billedLifetime, hoursMtd }
}

function projectExpenseTotal(projectId: string, expenses: Expense[]) {
  return expenses.filter(expense => expense.projectId === projectId).reduce((sum, expense) => sum + expense.amount, 0)
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [view, setView] = useState<ViewMode>('kanban')
  const [search, setSearch] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [modal, setModal] = useState<null | 'add' | 'edit'>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dragSuppressRef = useRef<string | null>(null)

  useEffect(() => {
    loadSnapshot().then(snap => {
      setProjects(snap.projects.map(project => ({ ...project, status: normalizeProjectStage(project.status) })))
      setClients(snap.clients)
      setEmployees(snap.employees)
      setInvoices(snap.invoices)
    })
    loadTasks().then(setTasks)
    loadExpenses().then(setExpenses)
  }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return projects
    return projects.filter(project => {
      const haystack = [
        project.name,
        projectPrefix(project),
        projectClientName(project, clients) || '',
        project.status || '',
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [clients, projects, search])

  const byStage = useMemo(() => {
    const map: Record<ProjectStage, Project[]> = {
      planning: [], active: [], hiring: [], review: [], 'on-hold': [], completed: [],
    }
    filtered.forEach(project => {
      const stage = normalizeProjectStage(project.status)
      map[stage]?.push(project)
    })
    return map
  }, [filtered])

  const projectTaskCount = useMemo(() => new Map<string, number>(), [])
  filtered.forEach(project => {
    projectTaskCount.set(project.id, tasks.filter(task => task.projectId === project.id).length)
  })

  const activeCount = filtered.filter(project => normalizeProjectStage(project.status) === 'active').length
  const hoursMtd = filtered.reduce((sum, project) => sum + projectInvoiceStats(project, invoices).hoursMtd, 0)
  const billedMtd = filtered.reduce((sum, project) => sum + projectInvoiceStats(project, invoices).billedMtd, 0)
  const totalTeam = filtered.reduce((sum, project) => sum + (project.employeeIds?.length || 0), 0)

  async function persist(next: Project[]) {
    const previous = projects
    setProjects(next)
    setSaveError(null)
    try {
      await saveProjects(next)
    } catch (error) {
      setProjects(previous)
      setSaveError(error instanceof Error ? error.message : 'Project could not be saved.')
    }
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM })
    setEditId(null)
    setModal('add')
    setSaveError(null)
  }

  function openEdit(project: Project) {
    setForm({
      name: project.name,
      rate: project.rate != null ? String(project.rate) : '',
      budget: project.budget != null ? String(project.budget) : '',
      clientId: project.clientId || '',
      status: normalizeProjectStage(project.status),
      billingModel: project.billingModel || 'hourly',
      startDate: project.startDate || '',
      endDate: project.endDate || '',
      description: project.description || '',
      projectNeeds: project.projectNeeds || '',
      notes: project.notes || '',
      links: project.links || [],
      employeeIds: project.employeeIds || [],
    })
    setEditId(project.id)
    setModal('edit')
    setSaveError(null)
  }

  async function saveForm() {
    if (!form.name.trim()) return
    setSaving(true)
    const partial: Partial<Project> = {
      name: form.name.trim(),
      rate: form.rate ? Number(form.rate) : undefined,
      budget: form.budget ? Number(form.budget) : undefined,
      clientId: form.clientId || null,
      status: normalizeProjectStage(form.status),
      billingModel: form.billingModel,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      description: form.description || undefined,
      projectNeeds: form.projectNeeds || undefined,
      notes: form.notes || undefined,
      links: form.links.length ? form.links : undefined,
      employeeIds: form.employeeIds,
    }

    const next = modal === 'add'
      ? [...projects, { id: uid(), ...partial } as Project]
      : projects.map(project => project.id === editId ? { ...project, ...partial } : project)

    await persist(next)
    setSaving(false)
    setModal(null)
  }

  async function doDelete(projectId: string) {
    await persist(projects.filter(project => project.id !== projectId))
    setConfirmDelete(null)
    if (selectedProjectId === projectId) setSelectedProjectId(null)
  }

  function moveStage(id: string, stage: ProjectStage) {
    void persist(projects.map(project => (project.id === id ? { ...project, status: normalizeProjectStage(stage) } : project)))
  }

  const dnd = useKanbanDnd<Project>(projects, setProjects, (project, newStage) => ({ ...project, status: normalizeProjectStage(newStage) }))
  const selectedProject = selectedProjectId ? projects.find(project => project.id === selectedProjectId) || null : null

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="proto-eyebrow">Operate · Projects</div>
            <h1 className="page-title">Projects</h1>
            <p className="page-sub">
              <strong>{projects.length}</strong> total · <strong>{activeCount}</strong> active · <strong>{Math.round(hoursMtd).toLocaleString()}</strong> hrs logged this month
            </p>
          </div>
          <button type="button" className="proto-btn proto-btn-primary" onClick={openAdd}>
            <ProtoIcon name="plus" size={13} />
            New Project
          </button>
        </div>

        <div className="proto-page-head-row" style={{ alignItems: 'center' }}>
          <SearchField value={search} onChange={setSearch} placeholder="Search projects..." minWidth={280} />
          <ToggleGroup value={view} onChange={setView} options={[{ id: 'kanban', label: 'Kanban' }, { id: 'table', label: 'Table' }]} />
        </div>
      </div>

      <div className="proto-page-body">
        <div className="proto-kpi-grid-4" style={{ marginBottom: 16 }}>
          {[
            { label: 'Visible Projects', value: filtered.length, color: 'var(--blue)' },
            { label: 'Active Delivery', value: activeCount, color: 'var(--emerald)' },
            { label: 'Hours MTD', value: Math.round(hoursMtd).toLocaleString(), color: 'var(--purple)' },
            { label: 'Billed MTD', value: formatMoney(billedMtd), color: 'var(--gold)' },
          ].map(card => (
            <div key={card.label} className="proto-kpi">
              <div className="proto-kpi-accent" style={{ background: card.color }} />
              <div className="proto-kpi-label">{card.label}</div>
              <div className="proto-kpi-value">{card.value}</div>
            </div>
          ))}
        </div>

        {view === 'kanban' ? (
          <div className="kanban" style={{ '--kanban-cols': STAGES.length } as React.CSSProperties}>
            {STAGES.map(stage => (
              <KanbanColumn<Project>
                key={stage.id}
                column={{ id: stage.id, label: stage.label, items: byStage[stage.id] }}
                dnd={dnd}
                accent={stage.color}
                headerRight={<button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={openAdd}><ProtoIcon name="plus" size={12} /></button>}
              >
                {byStage[stage.id].map(project => {
                    const clientName = projectClientName(project, clients)
                    const stats = projectInvoiceStats(project, invoices)
                  const team = project.employeeIds || []
                  return (
                    <KanbanItem
                      key={project.id}
                      item={project}
                      dnd={dnd}
                      accent={stage.color}
                      sourceColumnId={stage.id}
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span className="proto-mono" style={{ fontSize: 9.5, padding: '2px 6px', background: 'var(--surf2)', color: 'var(--accent)', borderRadius: 3, fontWeight: 700 }}>
                          {projectPrefix(project)}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{project.name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>{clientName || 'No client assigned'}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                        <div>
                          <div className="proto-eyebrow" style={{ fontSize: 9 }}>Rate</div>
                          <div className="proto-mono" style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginTop: 2 }}>
                            {project.rate != null ? `${protoCurrency(Number(project.rate))}/hr` : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="proto-eyebrow" style={{ fontSize: 9 }}>Hours MTD</div>
                          <div className="proto-mono" style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginTop: 2 }}>
                            {Math.round(stats.hoursMtd).toLocaleString()}h
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex' }}>
                          {team.slice(0, 4).map((employeeId, index) => {
                            const employee = employees.find(item => item.id === employeeId)
                            return employee ? (
                              <div key={employee.id} style={{ marginLeft: index === 0 ? 0 : -8, border: '2px solid var(--surf-2)', borderRadius: 999 }}>
                                <Avatar name={employee.name} color={colorFromString(employee.name)} size="sm" />
                              </div>
                            ) : null
                          })}
                          {team.length > 4 && (
                            <div style={{ marginLeft: -8, width: 24, height: 24, borderRadius: 999, background: 'var(--surf2)', border: '2px solid var(--surf-2)', display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 800, color: 'var(--muted)' }}>
                              +{team.length - 4}
                            </div>
                          )}
                          {team.length === 0 && <span style={{ fontSize: 10, color: 'var(--dim)', fontStyle: 'italic' }}>Unstaffed</span>}
                        </div>
                        <span className="proto-mono" style={{ fontSize: 10.5, color: 'var(--accent)', fontWeight: 700 }}>{formatMoney(stats.billedMtd)}</span>
                      </div>
                    </KanbanItem>
                  )
                })}
              </KanbanColumn>
            ))}
          </div>
        ) : (
          <div className="proto-card" style={{ overflow: 'hidden' }}>
            <table className="proto-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Team</th>
                  <th style={{ textAlign: 'right' }}>Rate</th>
                  <th style={{ textAlign: 'right' }}>Hours MTD</th>
                  <th style={{ textAlign: 'right' }}>Billed MTD</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(project => {
                  const stats = projectInvoiceStats(project, invoices)
                  const clientName = projectClientName(project, clients)
                  return (
                    <tr key={project.id} onClick={() => setSelectedProjectId(project.id)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="proto-mono" style={{ fontSize: 9.5, padding: '2px 6px', background: 'var(--surf2)', color: 'var(--accent)', borderRadius: 3, fontWeight: 700 }}>
                            {projectPrefix(project)}
                          </span>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{project.name}</span>
                        </div>
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{clientName || '—'}</td>
                      <td><StatusChip status={normalizeProjectStage(project.status)} /></td>
                      <td>
                        <div style={{ display: 'flex' }}>
                          {(project.employeeIds || []).slice(0, 4).map((employeeId, index) => {
                            const employee = employees.find(item => item.id === employeeId)
                            return employee ? (
                              <div key={employee.id} style={{ marginLeft: index === 0 ? 0 : -8, border: '2px solid var(--surf)', borderRadius: 999 }}>
                                <Avatar name={employee.name} color={colorFromString(employee.name)} size="sm" />
                              </div>
                            ) : null
                          })}
                          {(project.employeeIds || []).length > 4 && (
                            <div style={{ marginLeft: -8, width: 24, height: 24, borderRadius: 999, background: 'var(--surf2)', border: '2px solid var(--surf)', display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 800, color: 'var(--muted)' }}>
                              +{(project.employeeIds || []).length - 4}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="proto-mono" style={{ textAlign: 'right', fontWeight: 700 }}>{project.rate != null ? protoCurrency(Number(project.rate)) : '—'}</td>
                      <td className="proto-mono" style={{ textAlign: 'right' }}>{Math.round(stats.hoursMtd).toLocaleString()}</td>
                      <td className="proto-mono" style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 700 }}>{formatMoney(stats.billedMtd)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer open={Boolean(selectedProject)} onClose={() => setSelectedProjectId(null)} width={700}>
        {selectedProject && <ProjectDrawer project={selectedProject} clients={clients} employees={employees} invoices={invoices} tasks={tasks} expenses={expenses} onClose={() => setSelectedProjectId(null)} onEdit={openEdit} onNavigate={navigate} />}
      </Drawer>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Project' : 'Edit Project'}
        subtitle="Keep the live wiring and save the new structure in the same data model."
        width={780}
        footer={(
          <>
            <button type="button" className="proto-btn proto-btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={() => void saveForm()} disabled={!form.name.trim() || saving}>
              {saving ? 'Saving...' : modal === 'add' ? 'Add Project' : 'Save Changes'}
            </button>
          </>
        )}
      >
        {saveError ? <div className="settings-notice settings-notice-error">{saveError}</div> : null}
        <div className="proto-two-col" style={{ gap: 14 }}>
          <div className="proto-list-card">
            <div className="proto-list-card-head">
              <span>Project Details</span>
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Name *</label>
              <input className="proto-input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Project name" />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Client</label>
              <select className="proto-input" value={form.clientId} onChange={e => setForm(prev => ({ ...prev, clientId: e.target.value }))}>
                <option value="">No client</option>
                {clients.map(client => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
              </select>
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Status</label>
              <select className="proto-input" value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value as ProjectStage }))}>
                {STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Billing model</label>
              <select className="proto-input" value={form.billingModel} onChange={e => setForm(prev => ({ ...prev, billingModel: e.target.value }))}>
                <option value="hourly">Hourly</option>
                <option value="fixed">Fixed</option>
                <option value="retainer">Retainer</option>
              </select>
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Rate</label>
              <input className="proto-input" type="number" value={form.rate} onChange={e => setForm(prev => ({ ...prev, rate: e.target.value }))} placeholder="12" />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Budget</label>
              <input className="proto-input" type="number" value={form.budget} onChange={e => setForm(prev => ({ ...prev, budget: e.target.value }))} placeholder="0" />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Start date</label>
              <input className="proto-input" type="date" value={form.startDate} onChange={e => setForm(prev => ({ ...prev, startDate: e.target.value }))} />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">End date</label>
              <input className="proto-input" type="date" value={form.endDate} onChange={e => setForm(prev => ({ ...prev, endDate: e.target.value }))} />
            </div>
            <div className="proto-profile-row" style={{ alignItems: 'flex-start' }}>
              <label className="proto-profile-label">Description</label>
              <textarea className="proto-input" rows={3} value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
            </div>
            <div className="proto-profile-row" style={{ alignItems: 'flex-start' }}>
              <label className="proto-profile-label">Project needs</label>
              <textarea className="proto-input" rows={3} value={form.projectNeeds} onChange={e => setForm(prev => ({ ...prev, projectNeeds: e.target.value }))} />
            </div>
            <div className="proto-profile-row" style={{ alignItems: 'flex-start' }}>
              <label className="proto-profile-label">Notes</label>
              <textarea className="proto-input" rows={3} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
            </div>
          </div>

          <div className="proto-sidebar-stack">
            <div className="proto-list-card">
              <div className="proto-list-card-head">
                <span>Team</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="proto-row-stack" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {form.employeeIds.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>No team assigned.</span>
                  ) : form.employeeIds.map(employeeId => {
                    const employee = employees.find(item => item.id === employeeId)
                    return employee ? (
                      <span key={employee.id} className="proto-tag">
                        {employee.name}
                        <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" style={{ width: 18, height: 18, minWidth: 18 }} onClick={() => setForm(prev => ({ ...prev, employeeIds: prev.employeeIds.filter(id => id !== employeeId) }))}>
                          <ProtoIcon name="close" size={10} />
                        </button>
                      </span>
                    ) : null
                  })}
                </div>
                <SearchField
                  value=""
                  onChange={() => {}}
                  placeholder="Search team member..."
                  minWidth={0}
                />
                <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                  {employees
                    .filter(employee => !form.employeeIds.includes(employee.id))
                    .slice(0, 8)
                    .map(employee => (
                      <button
                        key={employee.id}
                        type="button"
                        className="proto-plain-button"
                        style={{ justifyContent: 'space-between' }}
                        onClick={() => setForm(prev => ({ ...prev, employeeIds: [...prev.employeeIds, employee.id] }))}
                      >
                        <span>{employee.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>{employee.role || 'Team'}</span>
                      </button>
                    ))}
                </div>
              </div>
            </div>

            <div className="proto-list-card">
              <div className="proto-list-card-head">
                <span>Links</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {form.links.map((link, index) => (
                  <div key={`${link.label}-${index}`} className="proto-list-row">
                    <a href={link.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{link.label}</a>
                    <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => setForm(prev => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }))}>
                      <ProtoIcon name="close" size={10} />
                    </button>
                  </div>
                ))}
                <input className="proto-input" value="" onChange={() => {}} placeholder="Add link" disabled />
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Link editing stays available in the profile page to keep this modal focused.</div>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {confirmDelete ? (
        <Modal
          open={Boolean(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
          title="Remove project?"
          subtitle="This cannot be undone."
          width={420}
          footer={(
            <>
              <button type="button" className="proto-btn proto-btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button type="button" className="proto-btn proto-btn-danger" onClick={() => void doDelete(confirmDelete)}>Remove</button>
            </>
          )}
        >
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Deleting the project removes it from the board and from the profile route.</p>
        </Modal>
      ) : null}
    </div>
  )
}

function ProjectDrawer({
  project,
  clients,
  employees,
  invoices,
  tasks,
  expenses,
  onClose,
  onEdit,
  onNavigate,
}: {
  project: Project
  clients: Client[]
  employees: Employee[]
  invoices: Invoice[]
  tasks: Task[]
  expenses: Expense[]
  onClose: () => void
  onEdit: (project: Project) => void
  onNavigate: ReturnType<typeof useNavigate>
}) {
  const clientName = projectClientName(project, clients)
  const stats = projectInvoiceStats(project, invoices)
  const relatedTasks = tasks.filter(task => task.projectId === project.id)
  const team = project.employeeIds || []
  const totalHoursLifetime = stats.related.reduce((sum, invoice) => sum + invoiceHours(invoice, project.rate), 0)
  const openTasks = relatedTasks.filter(task => task.status !== 'done')

  return (
    <div className="project-detail">
      <div className="project-detail-head">
        <div style={{ minWidth: 0 }}>
          <div className="project-detail-title-row">
            <span className="project-prefix-chip">
              {projectPrefix(project)}
            </span>
            <div className="project-detail-title">{project.name}</div>
            <StatusChip status={project.status} filled />
          </div>
          <div className="project-detail-sub">
            {clientName ? (
              <button type="button" className="proto-plain-button" onClick={() => onNavigate('/clients/' + (project.clientId || ''))} style={{ paddingInline: 0, width: 'auto', color: 'var(--muted)' }}>
                {clientName}
              </button>
            ) : 'No client assigned'}
            {' · '}
            Hourly · {relatedTasks.length} tasks · {team.length} people
          </div>
        </div>
        <div className="project-detail-actions">
          <button type="button" className="proto-btn proto-btn-ghost" onClick={() => onEdit(project)}>
            <ProtoIcon name="edit" size={12} />
            Edit
          </button>
          <button type="button" className="proto-btn proto-btn-primary" onClick={() => onNavigate('/projects/' + project.id)}>
            Open Profile
          </button>
          <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={onClose}>
            <ProtoIcon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="project-detail-body">
        <div className="project-detail-metrics">
          {[
            { label: 'Hourly Rate', value: project.rate != null ? `${protoCurrency(Number(project.rate))}/hr` : '—', color: 'var(--accent)' },
            { label: 'Hours · MTD', value: `${Math.round(stats.hoursMtd).toLocaleString()}h`, sub: `${team.length} people`, color: '#60a5fa' },
            { label: 'Billed · lifetime', value: formatMoney(stats.billedLifetime), sub: `${Math.round(totalHoursLifetime).toLocaleString()}h total`, color: '#10b981' },
          ].map(card => (
            <div key={card.label} className="project-detail-metric">
              <div className="proto-kpi-accent" style={{ background: card.color }} />
              <div className="proto-kpi-label">{card.label}</div>
              <div className="proto-kpi-value">{card.value}</div>
              {'sub' in card ? <div className="project-detail-metric-sub">{card.sub}</div> : null}
            </div>
          ))}
        </div>

        <div className="section-title" style={{ marginBottom: 10 }}>Team · {team.length}</div>
        <div className="project-detail-team">
          {team.length === 0 ? (
            <div className="project-detail-empty">No employees assigned yet</div>
          ) : team.map(employeeId => {
            const employee = employees.find(item => item.id === employeeId)
            const employeeHours = stats.related.reduce((sum, invoice) => {
              const hours = invoice.items?.filter(item =>
                (item.employeeId && item.employeeId === employee?.id) ||
                item.employeeName?.toLowerCase() === employee?.name.toLowerCase(),
              ).reduce((itemSum, item) => itemSum + Number(item.hoursTotal || 0), 0) || 0
              return sum + hours
            }, 0)
            return employee ? (
              <button key={employee.id} type="button" className="project-detail-person" onClick={() => onNavigate('/employees/' + employee.id)}>
                <Avatar name={employee.name} color={colorFromString(employee.name)} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="project-detail-person-name">{employee.name}</div>
                  <div className="project-detail-person-sub">{employee.role || 'Team member'} · {employee.payRate ? `${protoCurrency(Number(employee.payRate))}/hr` : 'Rate not set'}</div>
                </div>
                <span className="proto-mono project-detail-person-hours">{Math.round(employeeHours).toLocaleString()}h</span>
              </button>
            ) : null
          })}
        </div>

        <div className="section-title" style={{ marginBottom: 10 }}>Open tasks</div>
        <div className="project-detail-card">
          {relatedTasks.length === 0 ? (
            <div className="project-detail-empty">No tasks yet</div>
          ) : relatedTasks.slice(0, 8).map((task, index) => {
            const done = task.status === 'done'
            const employee = employees.find(item => item.name === task.assigneeName)
            return (
              <div key={task.id} className="project-detail-task" style={{ borderBottom: index < Math.min(relatedTasks.length, 8) - 1 ? '1px solid var(--border)' : 'none' }}>
                <span className={`project-detail-task-check${done ? ' done' : ''}`}>
                  {done ? <ProtoIcon name="check" size={10} /> : null}
                </span>
                <span className="project-detail-task-title" style={{ color: done ? 'var(--muted)' : 'var(--text)', textDecoration: done ? 'line-through' : 'none' }}>{task.title}</span>
                {employee ? <Avatar name={employee.name} color={colorFromString(employee.name)} size="sm" /> : <span />}
                {task.dueDate ? <span className="proto-mono project-detail-task-due">{protoDate(task.dueDate)}</span> : <span />}
              </div>
            )
          })}
        </div>

        <div className="project-detail-section-head">
          <div className="section-title">Invoices</div>
          <button type="button" className="proto-btn proto-btn-ghost" onClick={() => onNavigate('/invoice?new=1')}>
            <ProtoIcon name="plus" size={12} />
            New invoice
          </button>
        </div>
        <div className="project-detail-card" style={{ overflow: 'hidden' }}>
          <table className="proto-table project-detail-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Hours</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stats.related.length === 0 ? (
                <tr><td colSpan={5} className="proto-empty">No invoices yet</td></tr>
              ) : stats.related.slice(0, 8).map(invoice => (
                <tr key={invoice.id}>
                  <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{invoice.number}</td>
                  <td style={{ color: 'var(--muted)' }}>{protoDate(invoice.date)}</td>
                  <td style={{ textAlign: 'right' }}>{Math.round(invoiceHours(invoice, project.rate)).toLocaleString()}h</td>
                  <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>{formatMoney(Number(invoice.subtotal || 0))}</td>
                  <td><StatusChip status={invoice.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="project-detail-notes">
          <div className="project-detail-note-row">
            <span>Billing model</span>
            <strong>{project.billingModel || 'hourly'}</strong>
          </div>
          <div className="project-detail-note-row">
            <span>Start date</span>
            <strong>{protoDate(project.startDate)}</strong>
          </div>
          <div className="project-detail-note-row">
            <span>End date</span>
            <strong>{protoDate(project.endDate)}</strong>
          </div>
          <div className="project-detail-note-row">
            <span>Expenses</span>
            <strong>{formatMoney(projectExpenseTotal(project.id, expenses))}</strong>
          </div>
          <div className="project-detail-note-row">
            <span>Open tasks</span>
            <strong>{openTasks.length}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}
