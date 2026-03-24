import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Employee, Expense, Invoice, Project, Task, TaskStatus } from '../data/types'
import { loadSnapshot, saveProjects, loadTasks, saveTasks, loadExpenses, saveExpenses } from '../services/storage'
import { formatMoney } from '../utils/money'
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

type ProjectStage = 'planning' | 'active' | 'review' | 'completed' | 'on-hold'
type ViewMode = 'cards' | 'kanban'

const STAGES: { key: ProjectStage; label: string }[] = [
  { key: 'planning',  label: 'Planning' },
  { key: 'active',    label: 'Active' },
  { key: 'review',    label: 'Review' },
  { key: 'completed', label: 'Completed' },
  { key: 'on-hold',   label: 'On Hold' },
]

const TASK_COLS: { key: TaskStatus; label: string }[] = [
  { key: 'todo',        label: 'To Do' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'done',        label: 'Done' },
]

function stageColor(s?: string): string {
  switch ((s || 'planning').toLowerCase()) {
    case 'active':    return '#22c55e'
    case 'review':    return '#a855f7'
    case 'completed': return '#14b8a6'
    case 'on-hold':   return '#f5b533'
    default:          return '#3b82f6'
  }
}
function stageBadge(s?: string): string {
  switch ((s || 'planning').toLowerCase()) {
    case 'active':    return 'badge-green'
    case 'review':    return 'badge-purple'
    case 'completed': return 'badge-teal'
    case 'on-hold':   return 'badge-yellow'
    default:          return 'badge-blue'
  }
}

type LinkEntry = { label: string; url: string }
type FormData = {
  name: string; rate: string; budget: string; clientId: string; status: string
  billingModel: string; startDate: string; endDate: string; notes: string
  links: LinkEntry[]; employeeIds: string[]
}
const EMPTY: FormData = {
  name: '', rate: '', budget: '', clientId: '', status: 'planning',
  billingModel: 'hourly', startDate: '', endDate: '', notes: '', links: [], employeeIds: [],
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects,  setProjects]  = useState<Project[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [allTasks,  setAllTasks]  = useState<Task[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[]>([])

  useEffect(() => {
    loadSnapshot().then(snap => {
      setProjects(snap.projects)
      setClients(snap.clients)
      setEmployees(snap.employees)
      setInvoices(snap.invoices)
    })
    loadTasks().then(setAllTasks)
    loadExpenses().then(setAllExpenses)
  }, [])
  const [view, setView]   = useState<ViewMode>('kanban')
  const [modal, setModal] = useState<null | 'add' | 'edit'>(null)
  const [form,  setForm]  = useState<FormData>(EMPTY)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl,   setNewLinkUrl]   = useState('')
  const [empSearch, setEmpSearch] = useState('')
  const [empDropOpen, setEmpDropOpen] = useState(false)

  // Expenses
  const [expenseProject, setExpenseProject] = useState<Project | null>(null)
  const [expenses, setExpenses]             = useState<Expense[]>([])
  const [expForm, setExpForm]               = useState({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: '', recurring: false })
  const EXPENSE_CATS = ['', 'Software', 'Hardware', 'Contractor', 'Travel', 'Marketing', 'Other']

  function openExpenses(p: Project) {
    setExpenseProject(p)
    setExpenses(allExpenses.filter(e => e.projectId === p.id))
    setExpForm({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: '', recurring: false })
  }
  function addExpense() {
    if (!expForm.description.trim() || !expForm.amount || !expenseProject) return
    const entry: Expense = {
      id: uid(), projectId: expenseProject.id,
      description: expForm.description.trim(),
      amount: parseFloat(expForm.amount) || 0,
      date: expForm.date,
      category: expForm.category || undefined,
      recurring: expForm.recurring || undefined,
      createdAt: Date.now(),
    }
    const all = allExpenses
    const next = [entry, ...all]
    void saveExpenses(next)
    setAllExpenses(next)
    setExpenses([entry, ...expenses])
    setExpForm({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: '', recurring: false })
  }
  function deleteExpense(id: string) {
    const next = allExpenses.filter(e => e.id !== id)
    void saveExpenses(next)
    setAllExpenses(next)
    setExpenses(expenses.filter(e => e.id !== id))
  }

  // Task board
  const [taskProject, setTaskProject] = useState<Project | null>(null)
  const [tasks, setTasks]             = useState<Task[]>([])
  const [taskForm, setTaskForm]       = useState({ title: '', description: '', assigneeName: '', dueDate: '' })
  const [taskAddCol, setTaskAddCol]   = useState<TaskStatus | null>(null)
  const taskDragId = { current: null as string | null }

  function openTaskBoard(p: Project) {
    setTaskProject(p)
    setTasks(allTasks)
    setTaskAddCol(null)
    setTaskForm({ title: '', description: '', assigneeName: '', dueDate: '' })
  }
  function closeTaskBoard() { setTaskProject(null) }
  function persistTasks(next: Task[]) { setTasks(next); setAllTasks(next); void saveTasks(next) }
  function addTask(status: TaskStatus) {
    if (!taskForm.title.trim() || !taskProject) return
    const t: Task = {
      id: uid(), projectId: taskProject.id, title: taskForm.title.trim(),
      description: taskForm.description || undefined,
      assigneeName: taskForm.assigneeName || undefined,
      dueDate: taskForm.dueDate || undefined,
      status, createdAt: Date.now(),
    }
    persistTasks([...allTasks, t])
    setTaskForm({ title: '', description: '', assigneeName: '', dueDate: '' })
    setTaskAddCol(null)
  }
  function moveTask(id: string, status: TaskStatus) {
    persistTasks(tasks.map(t => t.id === id ? { ...t, status } : t))
  }
  function deleteTask(id: string) { persistTasks(tasks.filter(t => t.id !== id)) }
  function projectTasks(status: TaskStatus) {
    return tasks.filter(t => t.projectId === taskProject?.id && t.status === status)
  }

  function persist(next: Project[]) { setProjects(next); void saveProjects(next) }

  function openAdd() { setForm({ ...EMPTY }); setEditId(null); setModal('add'); setNewLinkLabel(''); setNewLinkUrl(''); setEmpSearch(''); setEmpDropOpen(false) }
  function openEdit(p: Project) {
    setForm({
      name: p.name, rate: p.rate != null ? String(p.rate) : '',
      budget: p.budget != null ? String(p.budget) : '',
      clientId: p.clientId ?? '', status: p.status ?? 'planning',
      billingModel: p.billingModel ?? 'hourly',
      startDate: p.startDate ?? '', endDate: p.endDate ?? '', notes: p.notes ?? '',
      links: p.links ?? [], employeeIds: p.employeeIds ?? [],
    })
    setEditId(p.id); setModal('edit'); setNewLinkLabel(''); setNewLinkUrl(''); setEmpSearch(''); setEmpDropOpen(false)
  }
  function saveForm() {
    if (!form.name.trim()) return
    const partial: Partial<Project> = {
      name: form.name, rate: form.rate ? Number(form.rate) : undefined,
      budget: form.budget ? Number(form.budget) : undefined,
      clientId: form.clientId || null, status: form.status,
      billingModel: form.billingModel,
      startDate: form.startDate || undefined, endDate: form.endDate || undefined,
      notes: form.notes || undefined, links: form.links.length > 0 ? form.links : undefined,
      employeeIds: form.employeeIds,
    }
    if (modal === 'add') persist([...projects, { id: uid(), ...partial } as Project])
    else if (editId) persist(projects.map((p) => p.id === editId ? { ...p, ...partial } : p))
    setModal(null)
  }
  function doDelete(id: string) { persist(projects.filter((p) => p.id !== id)); setConfirmDelete(null) }
  function moveStage(id: string, stage: ProjectStage) {
    persist(projects.map((p) => p.id === id ? { ...p, status: stage } : p))
  }
  function clientName(id?: string | null) {
    if (!id) return null
    return clients.find((c) => c.id === id)?.name ?? null
  }

  function addLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return
    setForm(f => ({ ...f, links: [...f.links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] }))
    setNewLinkLabel(''); setNewLinkUrl('')
  }
  function removeLink(i: number) {
    setForm(f => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }))
  }

  function taskCount(p: Project) {
    return allTasks.filter(t => t.projectId === p.id).length
  }
  function projectBilled(p: Project) {
    return invoices.filter(inv => inv.projectId === p.id || inv.projectName === p.name)
      .reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  }
  function projectExpenseTotal(p: Project) {
    return allExpenses.filter(e => e.projectId === p.id).reduce((s, e) => s + e.amount, 0)
  }

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  )
  const byStage = (s: ProjectStage) => filtered.filter((p) => (p.status || 'planning').toLowerCase() === s)
  const dragId = { current: null as string | null }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-header-actions">
          <input className="form-input" style={{ width: 200 }} placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="view-toggle">
            <button className={`view-toggle-btn${view === 'cards' ? ' active' : ''}`} onClick={() => setView('cards')}>Cards</button>
            <button className={`view-toggle-btn${view === 'kanban' ? ' active' : ''}`} onClick={() => setView('kanban')}>Pipeline</button>
          </div>
          <button className="btn-primary" onClick={openAdd}>+ Add Project</button>
        </div>
      </div>

      {/* CARDS VIEW */}
      {view === 'cards' && (
        <div className="card-grid">
          {filtered.map((p) => {
            const cName = clientName(p.clientId)
            const tc = taskCount(p)
            const billed = projectBilled(p)
            const expTotal = projectExpenseTotal(p)
            const budgetPct = p.budget && p.budget > 0 ? Math.min(100, Math.round((billed / p.budget) * 100)) : null
            return (
              <div key={p.id} className="entity-card" style={{ borderTop: `2px solid ${stageColor(p.status)}`, cursor: 'pointer' }} onClick={() => navigate('/projects/' + p.id)}>
                <div className="card-top">
                  <div>
                    <div className="card-name">{p.name}</div>
                    <div className="card-sub">{cName || 'No client'}</div>
                  </div>
                  <span className={`badge ${stageBadge(p.status)}`}>{p.status || 'Planning'}</span>
                </div>
                <div className="card-stats">
                  {p.rate && (
                    <div className="stat-item">
                      <div className="stat-label">Rate</div>
                      <div className="stat-value stat-value-gold">${p.rate}/hr</div>
                    </div>
                  )}
                  {billed > 0 && (
                    <div className="stat-item">
                      <div className="stat-label">Billed</div>
                      <div className="stat-value stat-value-gold">{formatMoney(billed)}</div>
                    </div>
                  )}
                  {p.budget && (
                    <div className="stat-item">
                      <div className="stat-label">Budget</div>
                      <div className="stat-value" style={{ color: budgetPct !== null && budgetPct >= 90 ? '#ef4444' : 'var(--soft)' }}>
                        {formatMoney(p.budget)}{budgetPct !== null ? ` (${budgetPct}%)` : ''}
                      </div>
                    </div>
                  )}
                  {expTotal > 0 && (
                    <div className="stat-item">
                      <div className="stat-label">Expenses</div>
                      <div className="stat-value" style={{ color: '#f87171' }}>{formatMoney(expTotal)}</div>
                    </div>
                  )}
                  <div className="stat-item">
                    <div className="stat-label">Billing</div>
                    <div className="stat-value">{p.billingModel || 'hourly'}</div>
                  </div>
                  {p.startDate && (
                    <div className="stat-item">
                      <div className="stat-label">Started</div>
                      <div className="stat-value">{p.startDate}</div>
                    </div>
                  )}
                  {tc > 0 && (
                    <div className="stat-item">
                      <div className="stat-label">Tasks</div>
                      <div className="stat-value">{tc}</div>
                    </div>
                  )}
                </div>
                {p.notes && <div className="card-detail">{p.notes}</div>}
                {(p.employeeIds ?? []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {(p.employeeIds ?? []).map(eid => {
                      const emp = employees.find(e => e.id === eid)
                      return emp ? (
                        <span key={eid} style={{ fontSize: 11, background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', color: 'var(--muted)' }}>{emp.name}</span>
                      ) : null
                    })}
                  </div>
                )}
                {(p.links ?? []).length > 0 && (
                  <div className="card-links">
                    {(p.links ?? []).map((lk, i) => (
                      <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="card-link-pill">{lk.label}</a>
                    ))}
                  </div>
                )}
                <div className="card-footer">
                  <button className="btn-xs btn-ghost" onClick={ev => { ev.stopPropagation(); navigate('/projects/' + p.id) }}>View Profile</button>
                  <button className="btn-xs btn-ghost" onClick={ev => { ev.stopPropagation(); openEdit(p) }}>Edit</button>
                  <button className="btn-xs btn-danger" onClick={ev => { ev.stopPropagation(); setConfirmDelete(p.id) }}>Remove</button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 14 }}>
              {search ? 'No projects match.' : 'No projects yet. Add your first.'}
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
                {byStage(key).map((p) => (
                  <div key={p.id} className="kanban-card" draggable onDragStart={() => { dragId.current = p.id }}>
                    <div className="kanban-card-name">{p.name}</div>
                    {clientName(p.clientId) && <div className="kanban-card-role">{clientName(p.clientId)}</div>}
                    {p.rate && <div className="kanban-card-meta">${p.rate}/hr</div>}
                    {(p.links ?? []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                        {(p.links ?? []).map((lk, i) => (
                          <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="card-link-pill card-link-pill-sm" onClick={e => e.stopPropagation()}>{lk.label}</a>
                        ))}
                      </div>
                    )}
                    <div className="kanban-card-actions">
                      <button className="btn-xs btn-ghost" onClick={() => openTaskBoard(p)}>Tasks</button>
                      <button className="btn-xs btn-ghost" onClick={() => openExpenses(p)}>Expenses</button>
                      <button className="btn-xs btn-ghost" onClick={() => openEdit(p)}>Edit</button>
                      <button className="btn-xs btn-danger" onClick={() => setConfirmDelete(p.id)}>×</button>
                    </div>
                  </div>
                ))}
                {byStage(key).length === 0 && <div className="kanban-empty">Drop here</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Project form modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{modal === 'add' ? 'Add Project' : 'Edit Project'}</h2>
              <button className="modal-close btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Project Name *</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Project name" />
                </div>
                <div className="form-group">
                  <label className="form-label">Client</label>
                  <select className="form-select" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                    <option value="">— No client —</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Rate ($/hr)</label>
                  <input className="form-input" type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="10" />
                </div>
                <div className="form-group">
                  <label className="form-label">Budget ($)</label>
                  <input className="form-input" type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="Total project budget" />
                </div>
                <div className="form-group">
                  <label className="form-label">Stage</label>
                  <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Billing Model</label>
                  <select className="form-select" value={form.billingModel} onChange={(e) => setForm({ ...form, billingModel: e.target.value })}>
                    <option value="hourly">Hourly</option>
                    <option value="fixed">Fixed</option>
                    <option value="retainer">Retainer</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input className="form-input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date</label>
                  <input className="form-input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>

                {/* Team members — searchable dropdown */}
                {employees.length > 0 && (
                  <div className="form-group form-group-full">
                    <label className="form-label">Assigned Team Members</label>
                    {/* Selected pills */}
                    {form.employeeIds.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {form.employeeIds.map(eid => {
                          const emp = employees.find(e => e.id === eid)
                          return emp ? (
                            <span key={eid} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
                              background: 'rgba(245,181,51,.15)', border: '1px solid var(--gold)',
                              borderRadius: 6, padding: '3px 8px', color: 'var(--soft)',
                            }}>
                              {emp.name}
                              <button
                                type="button"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0, fontSize: 13, lineHeight: 1 }}
                                onClick={() => setForm(f => ({ ...f, employeeIds: f.employeeIds.filter(id => id !== eid) }))}
                              >×</button>
                            </span>
                          ) : null
                        })}
                      </div>
                    )}
                    {/* Search input */}
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        placeholder="Search and add team member..."
                        value={empSearch}
                        onChange={e => { setEmpSearch(e.target.value); setEmpDropOpen(true) }}
                        onFocus={() => setEmpDropOpen(true)}
                        onBlur={() => setTimeout(() => setEmpDropOpen(false), 150)}
                        autoComplete="off"
                      />
                      {empDropOpen && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.4)', maxHeight: 220, overflowY: 'auto',
                        }}>
                          {employees
                            .filter(e =>
                              !form.employeeIds.includes(e.id) &&
                              (empSearch === '' || e.name.toLowerCase().includes(empSearch.toLowerCase()) || ((e as {role?:string}).role || '').toLowerCase().includes(empSearch.toLowerCase()))
                            )
                            .slice(0, 10)
                            .map(emp => (
                              <div
                                key={emp.id}
                                onMouseDown={() => {
                                  setForm(f => ({ ...f, employeeIds: [...f.employeeIds, emp.id] }))
                                  setEmpSearch('')
                                  setEmpDropOpen(false)
                                }}
                                style={{
                                  padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                                  borderBottom: '1px solid var(--border)',
                                  display: 'flex', alignItems: 'center', gap: 8,
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surf2)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              >
                                <span style={{ fontWeight: 600 }}>{emp.name}</span>
                                {(emp as {role?:string}).role && <span style={{ color: 'var(--muted)', fontSize: 11 }}>{(emp as {role?:string}).role}</span>}
                              </div>
                            ))}
                          {employees.filter(e => !form.employeeIds.includes(e.id) && (empSearch === '' || e.name.toLowerCase().includes(empSearch.toLowerCase()))).length === 0 && (
                            <div style={{ padding: '10px 14px', color: 'var(--muted)', fontSize: 12 }}>No matches</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

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
                    <input className="form-input" value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)} placeholder="Label (e.g. Drive)" style={{ flex: 1 }} />
                    <input className="form-input" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..." style={{ flex: 2 }} />
                    <button className="btn-ghost btn-sm" onClick={addLink} disabled={!newLinkLabel.trim() || !newLinkUrl.trim()}>+ Add</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveForm} disabled={!form.name.trim()}>
                {modal === 'add' ? 'Add Project' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expenses Modal */}
      {expenseProject && (
        <div className="modal-overlay" onClick={() => setExpenseProject(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Expenses — {expenseProject.name}</h2>
                {expenseProject.budget != null && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Budget: {formatMoney(expenseProject.budget)} · Billed: {formatMoney(projectBilled(expenseProject))} · Expenses: {formatMoney(expenses.reduce((s,e)=>s+e.amount,0))}
                  </div>
                )}
              </div>
              <button className="modal-close btn-icon" onClick={() => setExpenseProject(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Add expense form */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 2, minWidth: 160 }}>
                  <label className="form-label">Description *</label>
                  <input className="form-input" value={expForm.description} onChange={e => setExpForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Zoom subscription" />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 100 }}>
                  <label className="form-label">Amount ($)</label>
                  <input className="form-input" type="number" value={expForm.amount} onChange={e => setExpForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 120 }}>
                  <label className="form-label">Date</label>
                  <input className="form-input" type="date" value={expForm.date} onChange={e => setExpForm(f=>({...f,date:e.target.value}))} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 120 }}>
                  <label className="form-label">Category</label>
                  <select className="form-select" value={expForm.category} onChange={e => setExpForm(f=>({...f,category:e.target.value}))}>
                    {EXPENSE_CATS.map(c => <option key={c} value={c}>{c || '— None —'}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ alignSelf: 'flex-end', marginBottom: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={expForm.recurring} onChange={e => setExpForm(f=>({...f,recurring:e.target.checked}))} />
                    Recurring
                  </label>
                </div>
                <button className="btn-primary btn-sm" style={{ alignSelf: 'flex-end', marginBottom: 2 }} onClick={addExpense} disabled={!expForm.description.trim() || !expForm.amount}>Add</button>
              </div>

              {/* Expense list */}
              {expenses.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>No expenses logged yet.</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Description</th><th>Category</th><th>Date</th><th>Recurring</th><th style={{textAlign:'right'}}>Amount</th><th></th></tr></thead>
                    <tbody>
                      {expenses.map(ex => (
                        <tr key={ex.id}>
                          <td>{ex.description}</td>
                          <td className="td-muted">{ex.category || '—'}</td>
                          <td className="td-muted">{ex.date}</td>
                          <td className="td-muted">{ex.recurring ? <span style={{color:'#4ade80',fontSize:11}}>● Yes</span> : '—'}</td>
                          <td style={{textAlign:'right',color:'#f87171',fontWeight:700}}>{formatMoney(ex.amount)}</td>
                          <td><button className="btn-icon btn-danger" style={{fontSize:11,padding:'2px 6px'}} onClick={()=>deleteExpense(ex.id)}>×</button></td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={4} style={{fontWeight:700,textAlign:'right',paddingRight:8}}>Total</td>
                        <td style={{textAlign:'right',color:'#f87171',fontWeight:800}}>{formatMoney(expenses.reduce((s,e)=>s+e.amount,0))}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setExpenseProject(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Task Board Modal */}
      {taskProject && (
        <div className="modal-overlay" onClick={closeTaskBoard}>
          <div className="modal" style={{ maxWidth: 860, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Tasks — {taskProject.name}</h2>
              </div>
              <button className="modal-close btn-icon" onClick={closeTaskBoard}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <div className="task-board">
                {TASK_COLS.map(({ key, label }) => (
                  <div key={key} className={`kanban-col kanban-col-${key}`}>
                    <div className="kanban-col-header">
                      <span className="kanban-stage-dot" />
                      <span className="kanban-col-label">{label}</span>
                      <span className="kanban-col-count">{projectTasks(key).length}</span>
                    </div>
                    <div
                      className="kanban-cards"
                      style={{ minHeight: 120 }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (taskDragId.current) { moveTask(taskDragId.current, key); taskDragId.current = null } }}
                    >
                      {projectTasks(key).map((t) => (
                        <div key={t.id} className="kanban-card" draggable onDragStart={() => { taskDragId.current = t.id }}>
                          <div className="kanban-card-name">{t.title}</div>
                          {t.assigneeName && <div className="kanban-card-meta">{t.assigneeName}</div>}
                          {t.dueDate     && <div className="kanban-card-meta" style={{ color: 'var(--gold)', fontSize: 10 }}>Due {t.dueDate}</div>}
                          {t.description && <div className="kanban-card-meta" style={{ marginTop: 4, fontSize: 11, opacity: .8 }}>{t.description}</div>}
                          <div className="kanban-card-actions">
                            <button className="btn-xs btn-danger" onClick={() => deleteTask(t.id)}>×</button>
                          </div>
                        </div>
                      ))}
                      {projectTasks(key).length === 0 && <div className="kanban-empty">Drop here</div>}

                      {/* Inline add */}
                      {taskAddCol === key ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                          <input className="form-input" style={{ fontSize: 12, padding: '6px 10px' }} placeholder="Task title..." value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} autoFocus />
                          <input className="form-input" style={{ fontSize: 12, padding: '6px 10px' }} placeholder="Assignee (optional)" value={taskForm.assigneeName} onChange={e => setTaskForm(f => ({ ...f, assigneeName: e.target.value }))} />
                          <input className="form-input" type="date" style={{ fontSize: 12, padding: '6px 10px' }} value={taskForm.dueDate} onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))} />
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn-primary btn-xs" style={{ flex: 1 }} onClick={() => addTask(key)} disabled={!taskForm.title.trim()}>Add</button>
                            <button className="btn-ghost btn-xs" onClick={() => setTaskAddCol(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn-ghost btn-xs" style={{ marginTop: 4, width: '100%', justifyContent: 'center' }} onClick={() => { setTaskAddCol(key); setTaskForm({ title: '', description: '', assigneeName: '', dueDate: '' }) }}>
                          + Add task
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Remove project?</div>
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
