import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Client, Employee, Expense, Invoice, Project, Task, TaskStatus } from '../data/types'
import { loadSnapshot, saveProjects, loadTasks, saveTasks, loadExpenses, saveExpenses } from '../services/storage'
import { formatMoney } from '../utils/money'

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

function stageBadge(s?: string): string {
  switch ((s || 'planning').toLowerCase()) {
    case 'active':    return 'badge-green'
    case 'review':    return 'badge-purple'
    case 'completed': return 'badge-teal'
    case 'on-hold':   return 'badge-yellow'
    default:          return 'badge-blue'
  }
}

const STAGES = ['planning','active','review','completed','on-hold']
const BILLING_MODELS = ['hourly','fixed','retainer']
const TASK_COLS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: 'To Do' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
]
const EXPENSE_CATS = ['', 'Software', 'Hardware', 'Contractor', 'Travel', 'Marketing', 'Other']

type LinkEntry = { label: string; url: string }

export default function ProjectProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [projects,  setProjectsState] = useState<Project[]>([])
  const [clients,   setClients]       = useState<Client[]>([])
  const [employees, setEmployees]     = useState<Employee[]>([])
  const [invoices,  setInvoices]      = useState<Invoice[]>([])
  const [tasks,     setTasks]         = useState<Task[]>([])
  const [expenses,  setExpenses]      = useState<Expense[]>([])

  useEffect(() => {
    loadSnapshot().then(snap => {
      setProjectsState(snap.projects)
      setClients(snap.clients)
      setEmployees(snap.employees)
      setInvoices(snap.invoices)
    })
    loadTasks().then(all => setTasks(all.filter(t => t.projectId === id)))
    loadExpenses().then(all => setExpenses(all.filter(e => e.projectId === id)))
  }, [id])

  const project = projects.find(p => p.id === id)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: '', rate: '', budget: '', clientId: '', status: 'planning',
    billingModel: 'hourly', startDate: '', endDate: '', notes: '',
    links: [] as LinkEntry[], employeeIds: [] as string[],
  })
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl,   setNewLinkUrl]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Sync form from project once data loads
  useEffect(() => {
    if (project && !editing) {
      setForm({
        name:         project.name ?? '',
        rate:         project.rate != null ? String(project.rate) : '',
        budget:       project.budget != null ? String(project.budget) : '',
        clientId:     project.clientId ?? '',
        status:       project.status ?? 'planning',
        billingModel: project.billingModel ?? 'hourly',
        startDate:    project.startDate ?? '',
        endDate:      project.endDate ?? '',
        notes:        project.notes ?? '',
        links:        (project.links ?? []) as LinkEntry[],
        employeeIds:  project.employeeIds ?? [],
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  const [taskForm, setTaskForm] = useState({ title: '', assigneeName: '', dueDate: '' })
  const [taskAddCol, setTaskAddCol] = useState<TaskStatus | null>(null)
  const taskDragId = { current: null as string | null }

  const [expForm, setExpForm] = useState({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: '' })

  if (!project) {
    return (
      <div className="page-wrap">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          Project not found.
          <br /><button className="btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/projects')}>← Back to Projects</button>
        </div>
      </div>
    )
  }

  // project is guaranteed non-null here (early return above handles null case)
  const projectNN = project!
  const clientName = clients.find(c => c.id === projectNN.clientId)?.name || null
  const projectInvoices = invoices.filter(inv => inv.projectId === projectNN.id || inv.projectName === projectNN.name)
  const totalBilled = projectInvoices.reduce((s, inv) => s + (Number(inv.subtotal)||0), 0)
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const assignedEmps = employees.filter(e => (projectNN.employeeIds||[]).includes(e.id))

  function persistProject(updated: Project) {
    const next = projects.map(p => p.id === updated.id ? updated : p)
    setProjectsState(next)
    void saveProjects(next)
  }

  function handleSave() {
    if (!form.name.trim()) return
    const updated: Project = {
      ...projectNN,
      name: form.name,
      rate: form.rate ? Number(form.rate) : undefined,
      budget: form.budget ? Number(form.budget) : undefined,
      clientId: form.clientId || null,
      status: form.status,
      billingModel: form.billingModel,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      notes: form.notes || undefined,
      links: form.links.length > 0 ? form.links : undefined,
      employeeIds: form.employeeIds,
    }
    persistProject(updated)
    setEditing(false)
  }

  function handleCancel() {
    setForm({
      name: projectNN.name,
      rate: projectNN.rate != null ? String(projectNN.rate) : '',
      budget: projectNN.budget != null ? String(projectNN.budget) : '',
      clientId: projectNN.clientId ?? '',
      status: projectNN.status ?? 'planning',
      billingModel: projectNN.billingModel ?? 'hourly',
      startDate: projectNN.startDate ?? '',
      endDate: projectNN.endDate ?? '',
      notes: projectNN.notes ?? '',
      links: projectNN.links ?? [],
      employeeIds: projectNN.employeeIds ?? [],
    })
    setEditing(false)
  }

  function handleDelete() {
    const next = projects.filter(p => p.id !== projectNN.id)
    setProjectsState(next)
    void saveProjects(next)
    navigate('/projects')
  }

  function addLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return
    setForm(f => ({ ...f, links: [...f.links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] }))
    setNewLinkLabel(''); setNewLinkUrl('')
  }
  function removeLink(i: number) {
    setForm(f => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }))
  }

  function toggleEmployee(empId: string) {
    setForm(f => ({
      ...f,
      employeeIds: f.employeeIds.includes(empId)
        ? f.employeeIds.filter(id => id !== empId)
        : [...f.employeeIds, empId],
    }))
  }

  // Tasks
  function persistTasks(next: Task[]) {
    setTasks(next)
    loadTasks().then(all => {
      void saveTasks([...all.filter(t => t.projectId !== id), ...next])
    })
  }
  function addTask(status: TaskStatus) {
    if (!taskForm.title.trim()) return
    const t: Task = {
      id: uid(), projectId: projectNN.id, title: taskForm.title.trim(),
      assigneeName: taskForm.assigneeName || undefined,
      dueDate: taskForm.dueDate || undefined,
      status, createdAt: Date.now(),
    }
    persistTasks([...tasks, t])
    setTaskForm({ title: '', assigneeName: '', dueDate: '' })
    setTaskAddCol(null)
  }
  function moveTask(taskId: string, status: TaskStatus) {
    persistTasks(tasks.map(t => t.id === taskId ? { ...t, status } : t))
  }
  function deleteTask(taskId: string) { persistTasks(tasks.filter(t => t.id !== taskId)) }
  function colTasks(status: TaskStatus) { return tasks.filter(t => t.status === status) }

  // Expenses
  function addExpense() {
    if (!expForm.description.trim() || !expForm.amount) return
    const entry: Expense = {
      id: uid(), projectId: projectNN.id,
      description: expForm.description.trim(),
      amount: parseFloat(expForm.amount) || 0,
      date: expForm.date,
      category: expForm.category || undefined,
      createdAt: Date.now(),
    }
    loadExpenses().then(all => { void saveExpenses([entry, ...all]) })
    setExpenses([entry, ...expenses])
    setExpForm({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: '' })
  }
  function deleteExpense(expId: string) {
    loadExpenses().then(all => { void saveExpenses(all.filter(e => e.id !== expId)) })
    setExpenses(expenses.filter(e => e.id !== expId))
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 1100 }}>
      <button className="btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/projects')}>
        ← Back to Projects
      </button>

      {/* Header */}
      <div className="profile-header">
        <div className="profile-header-left">
          <div className="avatar profile-avatar" style={{ background: '#3b82f6', fontSize: 20, fontWeight: 800 }}>
            {projectNN.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div>
            {editing
              ? <input className="form-input profile-name-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              : <h1 className="profile-name">{projectNN.name}</h1>
            }
            <div className="profile-sub">
              {clientName && <span style={{ color: 'var(--muted)' }}>Client: {clientName}</span>}
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
              <span className={`badge ${stageBadge(projectNN.status)}`} style={{ fontSize: 13 }}>{projectNN.status || 'Planning'}</span>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit Project</button>
              <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
        </div>
      </div>

      {/* KPIs */}
      {!editing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Total Billed', value: formatMoney(totalBilled), color: 'var(--gold)' },
            { label: 'Budget', value: projectNN.budget ? formatMoney(projectNN.budget) : '—', color: 'var(--text)' },
            { label: 'Expenses', value: totalExpenses > 0 ? formatMoney(totalExpenses) : '$0', color: '#f87171' },
            { label: 'Team Size', value: String(assignedEmps.length), color: '#c084fc' },
          ].map(({ label, value, color }) => (
            <div key={label} className="settings-stat-card">
              <div className="settings-stat-count" style={{ color, fontSize: 18 }}>{value}</div>
              <div className="settings-stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left - details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="data-card">
            <div className="data-card-title">Project Details</div>
            <div className="profile-fields">
              {editing ? (
                <>
                  <div className="profile-field">
                    <span className="profile-field-label">Client</span>
                    <select className="form-select form-input-sm" value={form.clientId} onChange={e => setForm(f => ({...f, clientId: e.target.value}))}>
                      <option value="">— No client —</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Status</span>
                    <select className="form-select form-input-sm" value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                      {STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Billing Model</span>
                    <select className="form-select form-input-sm" value={form.billingModel} onChange={e => setForm(f => ({...f, billingModel: e.target.value}))}>
                      {BILLING_MODELS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Rate ($/hr)</span>
                    <input className="form-input form-input-sm" type="number" value={form.rate} onChange={e => setForm(f => ({...f, rate: e.target.value}))} placeholder="8.50" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Budget ($)</span>
                    <input className="form-input form-input-sm" type="number" value={form.budget} onChange={e => setForm(f => ({...f, budget: e.target.value}))} placeholder="5000" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Start Date</span>
                    <input className="form-input form-input-sm" type="date" value={form.startDate} onChange={e => setForm(f => ({...f, startDate: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">End Date</span>
                    <input className="form-input form-input-sm" type="date" value={form.endDate} onChange={e => setForm(f => ({...f, endDate: e.target.value}))} />
                  </div>
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Notes</span>
                    <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
                  </div>
                  {/* Links */}
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Links</span>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {form.links.map((lk, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <a href={lk.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, color: 'var(--gold)' }}>{lk.label}</a>
                          <button className="btn-icon btn-danger" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => removeLink(i)}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="form-input form-input-sm" value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)} placeholder="Label" style={{ flex: 1 }} />
                        <input className="form-input form-input-sm" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..." style={{ flex: 2 }} />
                        <button className="btn-ghost btn-sm" onClick={addLink} disabled={!newLinkLabel.trim() || !newLinkUrl.trim()}>+</button>
                      </div>
                    </div>
                  </div>
                  {/* Team assignment */}
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Team</span>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                      {employees.map(e => (
                        <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                          <input type="checkbox" checked={form.employeeIds.includes(e.id)} onChange={() => toggleEmployee(e.id)} />
                          {e.name}
                          {e.role && <span style={{ color: 'var(--muted)', fontSize: 11 }}>{e.role}</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {[
                    { label: 'Client',         value: clientName },
                    { label: 'Status',         value: projectNN.status || 'Planning' },
                    { label: 'Billing Model',  value: projectNN.billingModel || 'hourly' },
                    { label: 'Rate',           value: projectNN.rate ? `$${projectNN.rate}/hr` : undefined },
                    { label: 'Budget',         value: projectNN.budget ? formatMoney(projectNN.budget) : undefined },
                    { label: 'Start Date',     value: projectNN.startDate },
                    { label: 'End Date',       value: projectNN.endDate },
                  ].map(({ label, value }) => value ? (
                    <div key={label} className="profile-field">
                      <span className="profile-field-label">{label}</span>
                      <span className="profile-field-value">{value}</span>
                    </div>
                  ) : null)}
                  {projectNN.notes && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Notes</span>
                      <span className="profile-field-value" style={{ whiteSpace: 'pre-wrap' }}>{projectNN.notes}</span>
                    </div>
                  )}
                  {(projectNN.links ?? []).length > 0 && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Links</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(projectNN.links ?? []).map((lk, i) => (
                          <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="card-link-pill">{lk.label}</a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Team */}
          {assignedEmps.length > 0 && !editing && (
            <div className="data-card">
              <div className="data-card-title">Team</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                {assignedEmps.map(e => (
                  <button key={e.id} className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start', fontSize: 13 }}
                    onClick={() => navigate('/employees/' + e.id)}>
                    {e.name}
                    {e.role && <span style={{ marginLeft: 6, color: 'var(--muted)', fontSize: 11 }}>{e.role}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Invoice history */}
          {projectInvoices.length > 0 && (
            <div className="data-card">
              <div className="data-card-title">Invoices</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
                  <tbody>
                    {projectInvoices.slice(0, 8).map(inv => (
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

        {/* Right - Tasks + Expenses */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Task Board */}
          <div className="data-card">
            <div className="data-card-title">Task Board ({tasks.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              {TASK_COLS.map(({ key, label }) => (
                <div key={key} style={{ background: 'var(--surf3)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>
                    {label} <span style={{ color: 'var(--gold)' }}>({colTasks(key).length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 40 }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => { if (taskDragId.current) { moveTask(taskDragId.current, key); taskDragId.current = null } }}>
                    {colTasks(key).map(t => (
                      <div key={t.id} draggable
                        onDragStart={() => { taskDragId.current = t.id }}
                        style={{ background: 'var(--surf2)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--border)', cursor: 'grab' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                        {t.assigneeName && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t.assigneeName}</div>}
                        {t.dueDate && <div style={{ fontSize: 11, color: '#f5b533', marginTop: 2 }}>Due: {t.dueDate}</div>}
                        <button className="btn-icon btn-danger" style={{ fontSize: 10, padding: '1px 5px', marginTop: 4, opacity: .6 }} onClick={() => deleteTask(t.id)}>×</button>
                      </div>
                    ))}
                  </div>
                  {taskAddCol === key ? (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <input className="form-input form-input-sm" placeholder="Task title" value={taskForm.title}
                        onChange={e => setTaskForm(f => ({...f, title: e.target.value}))}
                        onKeyDown={e => { if (e.key === 'Enter') addTask(key) }}
                        autoFocus />
                      <input className="form-input form-input-sm" placeholder="Assignee" value={taskForm.assigneeName}
                        onChange={e => setTaskForm(f => ({...f, assigneeName: e.target.value}))} />
                      <input className="form-input form-input-sm" type="date" value={taskForm.dueDate}
                        onChange={e => setTaskForm(f => ({...f, dueDate: e.target.value}))} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-primary btn-sm" onClick={() => addTask(key)} disabled={!taskForm.title.trim()}>Add</button>
                        <button className="btn-ghost btn-sm" onClick={() => setTaskAddCol(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn-ghost btn-sm" style={{ width: '100%', marginTop: 6, fontSize: 12 }} onClick={() => { setTaskAddCol(key); setTaskForm({ title: '', assigneeName: '', dueDate: '' }) }}>
                      + Add task
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Expenses */}
          <div className="data-card">
            <div className="data-card-title">Expenses — {formatMoney(totalExpenses)} total</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <input className="form-input form-input-sm" placeholder="Description" value={expForm.description}
                onChange={e => setExpForm(f => ({...f, description: e.target.value}))} />
              <input className="form-input form-input-sm" type="number" placeholder="Amount" style={{ width: 90 }}
                value={expForm.amount} onChange={e => setExpForm(f => ({...f, amount: e.target.value}))} />
              <select className="form-select form-input-sm" style={{ width: 110 }} value={expForm.category}
                onChange={e => setExpForm(f => ({...f, category: e.target.value}))}>
                {EXPENSE_CATS.map(c => <option key={c} value={c}>{c || 'Category'}</option>)}
              </select>
              <button className="btn-primary btn-sm" onClick={addExpense} disabled={!expForm.description.trim() || !expForm.amount}>Add</button>
            </div>
            {expenses.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No expenses yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Description</th><th>Category</th><th>Date</th><th>Amount</th><th></th></tr></thead>
                  <tbody>
                    {expenses.map(exp => (
                      <tr key={exp.id}>
                        <td className="td-name">{exp.description}</td>
                        <td className="td-muted">{exp.category || '—'}</td>
                        <td className="td-muted">{exp.date}</td>
                        <td style={{ color: '#f87171', fontWeight: 700 }}>{formatMoney(exp.amount)}</td>
                        <td><button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '2px 5px' }} onClick={() => deleteExpense(exp.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete {projectNN.name}?</div>
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
