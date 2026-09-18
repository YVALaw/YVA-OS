import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Client, Employee, Expense, Invoice, Project, Task, TaskStatus } from '../data/types'
import { loadExpenses, loadSnapshot, loadTasks, saveExpenses, saveProjects, saveTasks as saveTasksToStorage } from '../services/storage'
import { formatHourlyRate, formatMoney } from '../utils/money'
import { invoiceItemHours } from '../utils/invoiceHours'
import type { ProjectAssignmentDraft } from '../utils/rates'
import { fromAssignmentDrafts, setAssignmentDraft, toAssignmentDrafts } from '../utils/rates'
import {
  Avatar,
  Modal,
  ProtoIcon,
  SearchField,
  StatusChip,
  colorFromString,
  protoDate,
  protoDateShort,
} from '../components/PrototypeKit'

function uid() {
  return crypto.randomUUID()
}

const STAGES = ['planning', 'active', 'hiring', 'review', 'on-hold', 'completed'] as const

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

function currentMonthKey(date?: string) {
  return date ? date.slice(0, 7) === new Date().toISOString().slice(0, 7) : false
}

function invoiceHours(invoice: Invoice, projectRate?: string | number) {
  const explicit = invoice.items?.reduce((sum, item) => sum + invoiceItemHours(item), 0) || 0
  if (explicit > 0) return explicit
  const rate = Number(projectRate || 0)
  const subtotal = Number(invoice.subtotal || 0)
  return rate > 0 && subtotal > 0 ? subtotal / rate : 0
}

export default function ProjectProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[]>([])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [empSearch, setEmpSearch] = useState('')
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')
  const [taskForm, setTaskForm] = useState({ title: '', assigneeName: '', dueDate: '' })
  const [expForm, setExpForm] = useState({ description: '', amount: '', date: new Date().toISOString().slice(0, 10), category: '' })

  const [form, setForm] = useState({
    name: '',
    rate: '',
    budget: '',
    clientId: '',
    status: 'planning' as (typeof STAGES)[number],
    billingModel: 'hourly',
    startDate: '',
    endDate: '',
    description: '',
    projectNeeds: '',
    notes: '',
    links: [] as { label: string; url: string }[],
    employeeIds: [] as string[],
    assignments: [] as ProjectAssignmentDraft[],
  })

  useEffect(() => {
    loadSnapshot().then(snap => {
      setProjects(snap.projects)
      setClients(snap.clients)
      setEmployees(snap.employees)
      setInvoices(snap.invoices)
    })
    loadTasks().then(setAllTasks)
    loadExpenses().then(setAllExpenses)
  }, [id])

  const project = projects.find(item => item.id === id) as Project

  useEffect(() => {
    if (!project || editing) return
    setForm({
      name: project.name || '',
      rate: project.rate != null ? String(project.rate) : '',
      budget: project.budget != null ? String(project.budget) : '',
      clientId: project.clientId || '',
      status: (project.status || 'planning') as (typeof STAGES)[number],
      billingModel: project.billingModel || 'hourly',
      startDate: project.startDate || '',
      endDate: project.endDate || '',
      description: project.description || '',
      projectNeeds: project.projectNeeds || '',
      notes: project.notes || '',
      links: project.links || [],
      employeeIds: Array.from(new Set(project.employeeIds || [])),
      assignments: toAssignmentDrafts(project.assignments),
    })
  }, [editing, project])

  const projectTasks = useMemo(() => allTasks.filter(task => task.projectId === project?.id), [allTasks, project?.id])
  const projectExpenses = useMemo(() => allExpenses.filter(expense => expense.projectId === project?.id), [allExpenses, project?.id])
  const projectInvoices = useMemo(() => invoices.filter(invoice => invoice.projectId === project?.id || invoice.projectName === project?.name), [invoices, project?.id, project?.name])

  const stats = useMemo(() => {
    const mtdInvoices = projectInvoices.filter(invoice => currentMonthKey(invoice.date))
    return {
      billedLifetime: projectInvoices.reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0),
      billedMtd: mtdInvoices.reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0),
      hoursMtd: mtdInvoices.reduce((sum, invoice) => sum + invoiceHours(invoice, project?.rate), 0),
      expenseTotal: projectExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      teamSize: project?.employeeIds?.length || 0,
    }
  }, [project?.rate, project?.employeeIds?.length, projectExpenses, projectInvoices])

  const assignedEmployees = useMemo(
    () => employees.filter(employee => (project?.employeeIds || []).includes(employee.id)),
    [employees, project?.employeeIds],
  )

  if (!project) {
    return (
      <div className="proto-page">
        <div className="proto-page-body">
          <div className="proto-empty" style={{ padding: 60 }}>Project not found.</div>
        </div>
      </div>
    )
  }

  async function persistProject(next: Project) {
    const updated = projects.map(item => item.id === next.id ? next : item)
    const previous = projects
    setProjects(updated)
    setSaveError(null)
    try {
      await saveProjects(updated)
    } catch (error) {
      setProjects(previous)
      setSaveError(error instanceof Error ? error.message : 'Project could not be saved.')
    }
  }

  function beginEditing() {
    setSaveError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setForm({
      name: project.name || '',
      rate: project.rate != null ? String(project.rate) : '',
      budget: project.budget != null ? String(project.budget) : '',
      clientId: project.clientId || '',
      status: (project.status || 'planning') as (typeof STAGES)[number],
      billingModel: project.billingModel || 'hourly',
      startDate: project.startDate || '',
      endDate: project.endDate || '',
      description: project.description || '',
      projectNeeds: project.projectNeeds || '',
      notes: project.notes || '',
      links: project.links || [],
      employeeIds: Array.from(new Set(project.employeeIds || [])),
      assignments: toAssignmentDrafts(project.assignments),
    })
    setEditing(false)
    setEmpSearch('')
    setNewLinkLabel('')
    setNewLinkUrl('')
    setSaveError(null)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const next: Project = {
      ...project,
      name: form.name.trim(),
      rate: form.rate ? Number(form.rate) : undefined,
      budget: form.budget ? Number(form.budget) : undefined,
      clientId: form.clientId || null,
      status: form.status,
      billingModel: form.billingModel,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      description: form.description || undefined,
      projectNeeds: form.projectNeeds || undefined,
      notes: form.notes || undefined,
      links: form.links.length ? form.links : undefined,
      employeeIds: Array.from(new Set(form.employeeIds)),
      assignments: fromAssignmentDrafts(form.assignments, form.employeeIds),
    }
    await persistProject(next)
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    const next = projects.filter(item => item.id !== project.id)
    const previous = projects
    setProjects(next)
    setSaveError(null)
    try {
      await saveProjects(next)
      navigate('/projects')
    } catch (error) {
      setProjects(previous)
      setSaveError(error instanceof Error ? error.message : 'Project could not be deleted.')
    }
  }

  function addLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return
    setForm(prev => ({ ...prev, links: [...prev.links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] }))
    setNewLinkLabel('')
    setNewLinkUrl('')
  }

  function removeLink(index: number) {
    setForm(prev => ({ ...prev, links: prev.links.filter((_, idx) => idx !== index) }))
  }

  function addEmployee(employeeId: string) {
    setForm(prev => prev.employeeIds.includes(employeeId) ? prev : { ...prev, employeeIds: [...prev.employeeIds, employeeId] })
  }

  function patchAssignment(employeeId: string, patch: Partial<Omit<ProjectAssignmentDraft, 'employeeId'>>) {
    setForm(prev => ({ ...prev, assignments: setAssignmentDraft(prev.assignments, employeeId, patch) }))
  }

  function removeEmployee(employeeId: string) {
    setForm(prev => ({
      ...prev,
      employeeIds: prev.employeeIds.filter(id => id !== employeeId),
      assignments: prev.assignments.filter(entry => entry.employeeId !== employeeId),
    }))
  }

  async function persistTasks(next: Task[]) {
    setAllTasks(next)
    await saveTasksToStorage(next)
  }

  async function addTask() {
    if (!taskForm.title.trim()) return
    const nextTask: Task = {
      id: uid(),
      projectId: project.id,
      title: taskForm.title.trim(),
      assigneeName: taskForm.assigneeName || undefined,
      dueDate: taskForm.dueDate || undefined,
      status: 'todo',
      createdAt: Date.now(),
    }
    await persistTasks([...allTasks, nextTask])
    setTaskForm({ title: '', assigneeName: '', dueDate: '' })
  }

  async function moveTask(taskId: string, status: TaskStatus) {
    await persistTasks(allTasks.map(task => task.id === taskId ? { ...task, status } : task))
  }

  async function deleteTask(taskId: string) {
    await persistTasks(allTasks.filter(task => task.id !== taskId))
  }

  async function addExpense() {
    if (!expForm.description.trim() || !expForm.amount) return
    const entry: Expense = {
      id: uid(),
      projectId: project.id,
      description: expForm.description.trim(),
      amount: Number(expForm.amount) || 0,
      date: expForm.date,
      category: expForm.category || undefined,
      createdAt: Date.now(),
    }
    const next = [entry, ...allExpenses]
    setAllExpenses(next)
    await saveExpenses(next)
    setExpForm({ description: '', amount: '', date: new Date().toISOString().slice(0, 10), category: '' })
  }

  async function deleteExpense(expenseId: string) {
    const next = allExpenses.filter(expense => expense.id !== expenseId)
    setAllExpenses(next)
    await saveExpenses(next)
  }

  const filteredSearchEmployees = employees.filter(employee => {
    const query = empSearch.trim().toLowerCase()
    if (!query) return true
    return `${employee.name} ${employee.role || ''} ${employee.email || ''}`.toLowerCase().includes(query)
  })
  const totalHoursLifetime = projectInvoices.reduce((sum, invoice) => sum + invoiceHours(invoice, project.rate), 0)

  return (
    <div className="proto-page project-profile-page">
      <div className="proto-profile-head project-profile-head">
        <button type="button" className="proto-back-link proto-plain-button" onClick={() => navigate('/projects')}>
          <ProtoIcon name="chevronL" size={12} />
          All projects
        </button>
        <div className="proto-profile-row">
          <div className="proto-profile-main">
            <div className="project-profile-mark">{projectPrefix(project)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="project-profile-title-line">
                {editing ? (
                  <input className="proto-input project-profile-title-input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
                ) : (
                  <h1 className="proto-profile-title">{project.name}</h1>
                )}
                <StatusChip status={project.status} filled />
              </div>
              <div className="proto-profile-meta">
                <span>{projectClientName(project, clients) || 'No client assigned'}</span>
                <span>{project.billingModel || 'hourly'}</span>
                <span>{projectTasks.length} tasks</span>
                <span>{assignedEmployees.length} people</span>
              </div>
            </div>
          </div>
          <div className="proto-profile-actions">
            {editing ? (
              <>
                <button type="button" className="proto-btn proto-btn-primary" onClick={() => void handleSave()} disabled={!form.name.trim() || saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button type="button" className="proto-btn proto-btn-ghost" onClick={cancelEditing}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" className="proto-btn proto-btn-ghost" onClick={beginEditing}>
                  <ProtoIcon name="edit" size={12} />
                  Edit Project
                </button>
                <button type="button" className="proto-btn proto-btn-danger" onClick={() => setConfirmDelete(true)}>
                  <ProtoIcon name="trash" size={12} />
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
        {saveError ? <div className="settings-notice settings-notice-error project-profile-notice">{saveError}</div> : null}
      </div>

      <div className="proto-page-body">
        <div className="proto-kpi-grid-4 project-profile-kpis" style={{ marginBottom: 14 }}>
          {[
            { label: 'Hourly Rate', value: project.rate != null ? `${formatHourlyRate(project.rate)}/hr` : '—', sub: project.billingModel || 'hourly', color: 'var(--gold)' },
            { label: 'Hours MTD', value: `${Math.round(stats.hoursMtd).toLocaleString()}h`, sub: `${assignedEmployees.length} people`, color: '#60a5fa' },
            { label: 'Billed Lifetime', value: formatMoney(stats.billedLifetime), sub: `${Math.round(totalHoursLifetime).toLocaleString()}h total`, color: '#10b981' },
            { label: 'Expenses', value: formatMoney(stats.expenseTotal), sub: `${projectExpenses.length} entries`, color: '#f87171' },
          ].map(metric => (
            <div key={metric.label} className="proto-kpi">
              <div className="proto-kpi-accent" style={{ background: metric.color }} />
              <div className="proto-kpi-label">{metric.label}</div>
              <div className="proto-kpi-value" style={{ marginTop: 8 }}>{metric.value}</div>
              <div className="project-profile-kpi-sub">{metric.sub}</div>
            </div>
          ))}
        </div>

        <div className="proto-two-col project-profile-grid">
          <div className="proto-sidebar-stack">
            <div className="card proto-list-card project-profile-section">
              <div className="proto-list-card-head">
                <div className="proto-section-title">Project Details</div>
              </div>
              <div className="project-profile-detail-grid">
                <div className="proto-detail-cell">
                  <div className="proto-eyebrow">Client</div>
                  {editing ? (
                    <select className="proto-input" value={form.clientId} onChange={e => setForm(prev => ({ ...prev, clientId: e.target.value }))}>
                      <option value="">No client</option>
                      {clients.map(client => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
                    </select>
                  ) : (
                    <div className="project-profile-detail-value">{projectClientName(project, clients) || '—'}</div>
                  )}
                </div>
                <div className="proto-detail-cell">
                  <div className="proto-eyebrow">Status</div>
                  {editing ? (
                    <select className="proto-input" value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value as (typeof STAGES)[number] }))}>
                      {STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}
                    </select>
                  ) : (
                    <div className="project-profile-detail-value"><StatusChip status={project.status} /></div>
                  )}
                </div>
                <div className="proto-detail-cell">
                  <div className="proto-eyebrow">Billing Model</div>
                  {editing ? (
                    <select className="proto-input" value={form.billingModel} onChange={e => setForm(prev => ({ ...prev, billingModel: e.target.value }))}>
                      <option value="hourly">Hourly</option>
                      <option value="fixed">Fixed</option>
                      <option value="retainer">Retainer</option>
                    </select>
                  ) : (
                    <div className="project-profile-detail-value">{project.billingModel || 'hourly'}</div>
                  )}
                </div>
                <div className="proto-detail-cell">
                  <div className="proto-eyebrow">Rate</div>
                  {editing ? (
                    <input className="proto-input" type="number" inputMode="decimal" step="0.01" value={form.rate} onChange={e => setForm(prev => ({ ...prev, rate: e.target.value }))} />
                  ) : (
                    <div className="project-profile-detail-value">{project.rate != null ? `${formatHourlyRate(project.rate)}/hr` : '—'}</div>
                  )}
                </div>
                <div className="proto-detail-cell">
                  <div className="proto-eyebrow">Budget</div>
                  {editing ? (
                    <input className="proto-input" type="number" inputMode="decimal" step="0.01" value={form.budget} onChange={e => setForm(prev => ({ ...prev, budget: e.target.value }))} />
                  ) : (
                    <div className="project-profile-detail-value">{project.budget != null ? formatMoney(project.budget) : '—'}</div>
                  )}
                </div>
                <div className="proto-detail-cell">
                  <div className="proto-eyebrow">Timeline</div>
                  {editing ? (
                    <div className="project-profile-inline-inputs">
                      <input className="proto-input" type="date" value={form.startDate} onChange={e => setForm(prev => ({ ...prev, startDate: e.target.value }))} />
                      <input className="proto-input" type="date" value={form.endDate} onChange={e => setForm(prev => ({ ...prev, endDate: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="project-profile-detail-value">{protoDate(project.startDate)} to {protoDate(project.endDate)}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="card proto-list-card project-profile-section">
              <div className="proto-list-card-head">
                <div className="proto-section-title">Project Notes</div>
              </div>
              <div className="project-profile-notes-grid">
                <div className="project-profile-note">
                  <div className="proto-eyebrow">Description</div>
                  {editing ? (
                    <textarea className="proto-input" rows={4} value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
                  ) : (
                    <div className="project-profile-note-copy">{project.description || '—'}</div>
                  )}
                </div>
                <div className="project-profile-note">
                  <div className="proto-eyebrow">Project Needs</div>
                  {editing ? (
                    <textarea className="proto-input" rows={4} value={form.projectNeeds} onChange={e => setForm(prev => ({ ...prev, projectNeeds: e.target.value }))} />
                  ) : (
                    <div className="project-profile-note-copy">{project.projectNeeds || '—'}</div>
                  )}
                </div>
                <div className="project-profile-note">
                  <div className="proto-eyebrow">Internal Notes</div>
                  {editing ? (
                    <textarea className="proto-input" rows={4} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
                  ) : (
                    <div className="project-profile-note-copy">{project.notes || '—'}</div>
                  )}
                </div>
                <div className="project-profile-note">
                  <div className="proto-eyebrow">Links</div>
                  {editing ? (
                    <div className="project-profile-link-editor">
                      {form.links.map((link, index) => (
                        <div key={`${link.label}-${index}`} className="project-profile-link-row">
                          <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
                          <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => removeLink(index)}>
                            <ProtoIcon name="close" size={10} />
                          </button>
                        </div>
                      ))}
                      <div className="project-profile-inline-inputs">
                        <input className="proto-input" value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)} placeholder="Label" />
                        <input className="proto-input" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..." />
                      </div>
                      <button type="button" className="proto-btn proto-btn-ghost" onClick={addLink} disabled={!newLinkLabel.trim() || !newLinkUrl.trim()}>Add link</button>
                    </div>
                  ) : (
                    <div className="project-profile-link-list">
                      {(project.links || []).length === 0 ? <span className="project-profile-note-copy">—</span> : (project.links || []).map(link => <a key={link.label} href={link.url} target="_blank" rel="noreferrer" className="proto-tag">{link.label}</a>)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card proto-list-card project-profile-section">
              <div className="proto-list-card-head">
                <div className="proto-section-title">Team</div>
              </div>
              {editing ? (
                <div className="project-profile-card-body">
                  <div className="project-profile-selected-team">
                    {form.employeeIds.length === 0 ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>No team assigned.</span> : form.employeeIds.map(employeeId => {
                      const employee = employees.find(item => item.id === employeeId)
                      if (!employee) return null
                      const assignment = form.assignments.find(entry => entry.employeeId === employeeId)
                      const formClient = clients.find(item => item.id === form.clientId)
                      const inheritedBill = Number(form.rate) || Number(formClient?.defaultRate) || 0
                      const inheritedPay = Number(employee.payRate) || 0
                      return (
                        <div key={employee.id} className="project-assignment-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700 }}>{employee.name}</span>
                            <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" style={{ width: 18, height: 18, minWidth: 18 }} onClick={() => removeEmployee(employeeId)}>
                              <ProtoIcon name="close" size={10} />
                            </button>
                          </div>
                          <input
                            className="proto-input"
                            style={{ fontSize: 12 }}
                            value={assignment?.position || ''}
                            placeholder={employee.role || 'Position on this project'}
                            onChange={e => patchAssignment(employeeId, { position: e.target.value })}
                          />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                            <label style={{ display: 'grid', gap: 3 }}>
                              <span className="project-assignment-label">Bill /hr</span>
                              <input className="proto-input" type="number" inputMode="decimal" step="0.01" style={{ fontSize: 12 }}
                                value={assignment?.billRate ?? ''}
                                placeholder={inheritedBill > 0 ? String(inheritedBill) : 'Not set'}
                                onChange={e => patchAssignment(employeeId, { billRate: e.target.value })} />
                            </label>
                            <label style={{ display: 'grid', gap: 3 }}>
                              <span className="project-assignment-label">Pay /hr</span>
                              <input className="proto-input" type="number" inputMode="decimal" step="0.01" style={{ fontSize: 12 }}
                                value={assignment?.payRate ?? ''}
                                placeholder={inheritedPay > 0 ? String(inheritedPay) : 'Not set'}
                                onChange={e => patchAssignment(employeeId, { payRate: e.target.value })} />
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <SearchField value={empSearch} onChange={setEmpSearch} placeholder="Search team member..." minWidth={0} />
                  <div className="project-team-search-list">
                    {filteredSearchEmployees
                      .filter(employee => !form.employeeIds.includes(employee.id))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(employee => (
                        <button
                          key={employee.id}
                          type="button"
                          className="proto-plain-button project-team-add-row"
                          onClick={() => addEmployee(employee.id)}
                        >
                          <span>{employee.name}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}>{employee.role || 'Team'}</span>
                        </button>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="project-team-list">
                  {assignedEmployees.length === 0 ? (
                    <div className="proto-empty">No team assigned yet</div>
                  ) : assignedEmployees.map(employee => (
                    <button key={employee.id} type="button" className="project-team-row" onClick={() => navigate('/employees/' + employee.id)}>
                      <div className="project-team-person">
                        <Avatar name={employee.name} color={colorFromString(employee.name)} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="project-team-name">{employee.name}</div>
                          <div className="project-team-meta">{employee.role || 'Team member'}{employee.payRate ? ` · ${formatHourlyRate(employee.payRate)}/hr` : ''}</div>
                        </div>
                      </div>
                      <span className="project-team-status">{employee.status || 'Active'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="proto-sidebar-stack">
            <div className="card proto-list-card project-profile-section">
              <div className="proto-list-card-head">
                <div className="proto-section-title">Tasks</div>
                <span className="proto-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{projectTasks.length}</span>
              </div>
              <div className="project-profile-card-body">
                {editing ? (
                  <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
                    <input className="proto-input" value={taskForm.title} onChange={e => setTaskForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Task title" />
                    <input className="proto-input" value={taskForm.assigneeName} onChange={e => setTaskForm(prev => ({ ...prev, assigneeName: e.target.value }))} placeholder="Assignee" />
                    <input className="proto-input" type="date" value={taskForm.dueDate} onChange={e => setTaskForm(prev => ({ ...prev, dueDate: e.target.value }))} />
                    <button type="button" className="proto-btn proto-btn-ghost" onClick={() => void addTask()} disabled={!taskForm.title.trim()}>
                      <ProtoIcon name="plus" size={12} />
                      Add task
                    </button>
                  </div>
                ) : null}
                {projectTasks.length === 0 ? (
                  <div className="proto-empty">No tasks yet</div>
                ) : projectTasks.map(task => (
                  <div key={task.id} className="proto-list-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {task.assigneeName || 'Unassigned'}
                        {task.dueDate ? ` · Due ${task.dueDate}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <StatusChip status={task.status} />
                      {editing ? (
                        <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => void deleteTask(task.id)}>
                          <ProtoIcon name="close" size={10} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card proto-list-card project-profile-section">
              <div className="proto-list-card-head">
                <div className="proto-section-title">Invoices</div>
                <span className="proto-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{projectInvoices.length}</span>
              </div>
              {projectInvoices.length === 0 ? (
                <div className="proto-empty">No invoices yet</div>
              ) : (
                <table className="proto-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Hours</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectInvoices.slice(0, 8).map(invoice => (
                      <tr key={invoice.id}>
                        <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{invoice.number}</td>
                        <td style={{ color: 'var(--muted)' }}>{protoDateShort(invoice.date)}</td>
                        <td style={{ textAlign: 'right' }}>{Math.round(invoiceHours(invoice, project.rate)).toLocaleString()}h</td>
                        <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>{formatMoney(Number(invoice.subtotal || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card proto-list-card project-profile-section">
              <div className="proto-list-card-head">
                <div className="proto-section-title">Expenses</div>
                <span className="proto-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{projectExpenses.length}</span>
              </div>
              {editing ? (
                <div className="project-profile-card-body">
                  <input className="proto-input" value={expForm.description} onChange={e => setExpForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Description" />
                  <input className="proto-input" type="number" inputMode="decimal" step="0.01" value={expForm.amount} onChange={e => setExpForm(prev => ({ ...prev, amount: e.target.value }))} placeholder="Amount" />
                  <input className="proto-input" type="date" value={expForm.date} onChange={e => setExpForm(prev => ({ ...prev, date: e.target.value }))} />
                  <input className="proto-input" value={expForm.category} onChange={e => setExpForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Category" />
                  <button type="button" className="proto-btn proto-btn-ghost" onClick={() => void addExpense()} disabled={!expForm.description.trim() || !expForm.amount}>
                    <ProtoIcon name="plus" size={12} />
                    Add expense
                  </button>
                </div>
              ) : null}
              {projectExpenses.length === 0 ? (
                <div className="proto-empty">No expenses yet</div>
              ) : (
                <table className="proto-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectExpenses.map(expense => (
                      <tr key={expense.id}>
                        <td>{expense.description}</td>
                        <td style={{ color: 'var(--muted)' }}>{expense.category || '—'}</td>
                        <td style={{ color: 'var(--muted)' }}>{protoDateShort(expense.date)}</td>
                        <td style={{ textAlign: 'right', color: '#f87171', fontWeight: 700 }}>
                          {formatMoney(expense.amount)}
                          {editing ? (
                            <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" style={{ marginLeft: 8 }} onClick={() => void deleteExpense(expense.id)}>
                              <ProtoIcon name="close" size={10} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDelete ? (
        <Modal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={`Delete ${project.name}?`}
          subtitle="This cannot be undone."
          width={420}
          footer={(
            <>
              <button type="button" className="proto-btn proto-btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button type="button" className="proto-btn proto-btn-danger" onClick={() => void handleDelete()}>Delete</button>
            </>
          )}
        >
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Deleting the project removes it from the board and profile routes.</p>
        </Modal>
      ) : null}
    </div>
  )
}
