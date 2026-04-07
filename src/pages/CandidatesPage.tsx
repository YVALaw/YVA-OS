import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Attachment, Candidate, CandidateStage, Employee } from '../data/types'
import {
  loadCandidates, saveCandidates,
  loadEmployees, saveEmployees,
  loadEmployeeCounter, saveEmployeeCounter,
} from '../services/storage'
import { useRole } from '../context/RoleContext'
import { can } from '../lib/roles'

const ONBOARDING_TASKS = [
  'Set up work email address',
  'Add to payroll system',
  'Add to employee roster in YVA OS',
  'Assign to active project',
  'Schedule onboarding call',
  'Send tools & access credentials',
  'Complete HR paperwork / NDA',
  'Add to team Slack / communication channel',
]

const STAGES: { key: CandidateStage; label: string }[] = [
  { key: 'applied', label: 'Applied' },
  { key: 'screening', label: 'Screening' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'hired', label: 'Hired' },
  { key: 'rejected', label: 'Rejected' },
]

function uid() {
  return crypto.randomUUID()
}

async function generateEmployeeNumber(): Promise<string> {
  const year = String(new Date().getFullYear()).slice(-2)
  const counter = await loadEmployeeCounter()
  void saveEmployeeCounter(counter + 1)
  return `YVA${year}${String(counter).padStart(3, '0')}`
}

const EMPTY_FORM: Omit<Candidate, 'id' | 'updatedAt'> = {
  name: '',
  email: '',
  phone: '',
  role: '',
  source: '',
  stage: 'applied',
  notes: '',
  resumeUrl: '',
  linkedinUrl: '',
  appliedAt: new Date().toISOString().slice(0, 10),
}

type EmployeeFormData = {
  name: string
  email: string
  phone: string
  payRate: string
  role: string
  employmentType: string
  location: string
  timezone: string
  startYear: string
  status: string
  notes: string
}

const EMPLOYMENT_TYPES = ['', 'Full-time', 'Part-time', 'Project-based']
const EMPLOYEE_STATUS_OPTIONS = ['Active', 'Onboarding', 'Trial', 'On hold', 'Inactive']

const EMPTY_EMPLOYEE_FORM: EmployeeFormData = {
  name: '',
  email: '',
  phone: '',
  payRate: '',
  role: '',
  employmentType: '',
  location: '',
  timezone: '',
  startYear: String(new Date().getFullYear()),
  status: 'Onboarding',
  notes: '',
}

export default function CandidatesPage() {
  const navigate = useNavigate()
  const { role } = useRole()
  const hiredOnly = can.viewHiredOnly(role)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  useEffect(() => {
    loadCandidates().then(all => setCandidates(hiredOnly ? all.filter(c => c.stage === 'hired') : all))
    loadEmployees().then(setEmployees)
  }, [hiredOnly])
  const [modal, setModal] = useState<null | 'add'>(null)
  const [form, setForm] = useState<Omit<Candidate, 'id' | 'updatedAt'>>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [onboardingCandidate, setOnboardingCandidate] = useState<Candidate | null>(null)
  const [hireCandidate, setHireCandidate] = useState<Candidate | null>(null)
  const [employeeForm, setEmployeeForm] = useState<EmployeeFormData>(EMPTY_EMPLOYEE_FORM)
  const [hireAttachments, setHireAttachments] = useState<Attachment[]>([])
  const [checkedTasks, setCheckedTasks] = useState<Set<number>>(new Set())
  const dragId = useRef<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hireFileInputRef = useRef<HTMLInputElement>(null)

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

  function persist(next: Candidate[]) {
    setCandidates(next)
    void saveCandidates(next)
  }

  function persistEmployees(next: Employee[]) {
    setEmployees(next)
    void saveEmployees(next)
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM, appliedAt: new Date().toISOString().slice(0, 10) })
    setAttachments([])
    setModal('add')
  }

  function saveForm() {
    if (!form.name.trim()) return
    const next = [...candidates, { ...form, id: uid(), updatedAt: Date.now(), attachments }]
    persist(next)
    setModal(null)
  }

  function deleteCandidate(id: string) {
    persist(candidates.filter((c) => c.id !== id))
    setConfirmDelete(null)
  }

  function buildEmployeeForm(candidate: Candidate): EmployeeFormData {
    return {
      name: candidate.name || '',
      email: candidate.email || '',
      phone: candidate.phone || '',
      payRate: '',
      role: candidate.role || '',
      employmentType: '',
      location: '',
      timezone: '',
      startYear: String(new Date().getFullYear()),
      status: 'Onboarding',
      notes: candidate.notes || '',
    }
  }

  function employeeAlreadyExists(candidate: Candidate) {
    const email = candidate.email?.trim().toLowerCase()
    const name = candidate.name.trim().toLowerCase()
    return employees.some(employee => {
      const employeeEmail = employee.email?.trim().toLowerCase()
      const employeeName = employee.name.trim().toLowerCase()
      return (email && employeeEmail === email) || employeeName === name
    })
  }

  function startHire(candidate: Candidate) {
    if (employeeAlreadyExists(candidate)) {
      const next: Candidate[] = candidates.filter(c => c.id !== candidate.id)
      persist(next)
      setOnboardingCandidate({ ...candidate, stage: 'hired', updatedAt: Date.now() })
      setCheckedTasks(new Set())
      return
    }
    setHireCandidate(candidate)
    setEmployeeForm(buildEmployeeForm(candidate))
    setHireAttachments(candidate.attachments || [])
  }

  function moveStage(id: string, stage: CandidateStage) {
    const candidate = candidates.find(c => c.id === id)
    if (!candidate) return
    if (stage === 'hired') {
      startHire(candidate)
      return
    }
    persist(candidates.map((c) => (c.id === id ? { ...c, stage, updatedAt: Date.now() } : c)))
  }

  function closeHireModal() {
    setHireCandidate(null)
    setEmployeeForm(EMPTY_EMPLOYEE_FORM)
    setHireAttachments([])
  }

  async function confirmHire() {
    if (!hireCandidate || !employeeForm.name.trim()) return

    const hiredCandidate: Candidate = {
      ...hireCandidate,
      name: employeeForm.name.trim(),
      email: employeeForm.email.trim() || undefined,
      phone: employeeForm.phone.trim() || undefined,
      role: employeeForm.role.trim() || undefined,
      notes: employeeForm.notes.trim() || undefined,
      stage: 'hired',
      attachments: hireAttachments,
      updatedAt: Date.now(),
    }

    const employeeNumber = await generateEmployeeNumber()
    const nextEmployee: Employee = {
      id: uid(),
      employeeNumber,
      name: employeeForm.name.trim(),
      email: employeeForm.email.trim() || undefined,
      phone: employeeForm.phone.trim() || undefined,
      payRate: employeeForm.payRate.trim() || undefined,
      role: employeeForm.role.trim() || undefined,
      employmentType: employeeForm.employmentType || undefined,
      location: employeeForm.location.trim() || undefined,
      timezone: employeeForm.timezone.trim() || undefined,
      startYear: employeeForm.startYear.trim() || undefined,
      status: employeeForm.status || 'Onboarding',
      notes: employeeForm.notes.trim() || undefined,
      attachments: hireAttachments,
    }

    const nextCandidates = candidates.filter(candidate => candidate.id !== hireCandidate.id)
    const nextEmployees = [...employees, nextEmployee]

    setCandidates(nextCandidates)
    setEmployees(nextEmployees)

    try {
      await Promise.all([
        saveCandidates(nextCandidates),
        saveEmployees(nextEmployees),
      ])
      closeHireModal()
      setOnboardingCandidate(hiredCandidate)
      setCheckedTasks(new Set())
    } catch (error) {
      setCandidates(candidates)
      setEmployees(employees)
      alert(error instanceof Error ? error.message : 'Failed to hire candidate')
    }
  }

  function handleHireFileUpload(file: File) {
    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) { alert('File too large (max 5 MB). For videos, paste a link in Resume URL instead.'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const att: Attachment = {
        id: uid(), name: file.name, mimeType: file.type,
        size: file.size, dataUrl: ev.target?.result as string, uploadedAt: Date.now(),
      }
      setHireAttachments(prev => [...prev, att])
    }
    reader.readAsDataURL(file)
  }

  // drag and drop
  function onDragStart(id: string) {
    dragId.current = id
  }

  function onDrop(stage: CandidateStage) {
    if (dragId.current) {
      moveStage(dragId.current, stage)
      dragId.current = null
    }
  }

  const byStage = (stage: CandidateStage) => candidates.filter((c) => c.stage === stage)

  if (hiredOnly) {
    return (
      <div className="page-wrap">
        <div className="page-header">
          <div className="page-header-left">
            <h1 className="page-title">Hired Staff</h1>
            <p className="page-sub">Candidates who have been hired — for payroll reference</p>
          </div>
        </div>
        <div className="card-grid">
          {candidates.map(c => (
            <div key={c.id} className="entity-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/candidates/' + c.id)}>
              <div className="card-avatar avatar" style={{ background: '#22c55e', fontWeight: 800 }}>
                {c.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="card-info">
                <div className="card-name">{c.name}</div>
                {c.role && <div className="card-meta">{c.role}</div>}
                {c.email && <div className="card-meta">{c.email}</div>}
              </div>
            </div>
          ))}
          {candidates.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20 }}>No hired candidates yet.</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Candidates</h1>
          <p className="page-sub">Hiring pipeline — drag cards between stages</p>
        </div>
        <button className="btn-primary" onClick={openAdd}>+ Add Candidate</button>
      </div>

      <div className="kanban-board">
        {STAGES.map(({ key, label }) => (
          <div
            key={key}
            className={`kanban-col kanban-col-${key}`}
            style={{ minWidth: 0 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(key)}
          >
            <div className="kanban-col-header">
              <span className={`kanban-stage-dot kanban-stage-dot-${key}`} />
              <span className="kanban-col-label">{label}</span>
              <span className="kanban-col-count">{byStage(key).length}</span>
            </div>

            <div className="kanban-cards">
              {byStage(key).map((c) => (
                <div
                  key={c.id}
                  className="kanban-card"
                  draggable
                  onDragStart={() => onDragStart(c.id)}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate('/candidates/' + c.id)}
                >
                  <div className="kanban-card-name">{c.name}</div>
                  {c.role && <div className="kanban-card-role">{c.role}</div>}
                  {c.email && <div className="kanban-card-meta">{c.email}</div>}
                  {c.source && <div className="kanban-card-source">{c.source}</div>}
                  <div className="kanban-card-actions">
                    <button className="btn-xs btn-ghost" onClick={ev => { ev.stopPropagation(); navigate('/candidates/' + c.id) }}>View</button>
                    <button className="btn-xs btn-danger" onClick={ev => { ev.stopPropagation(); setConfirmDelete(c.id) }}>Remove</button>
                  </div>
                </div>
              ))}
              {byStage(key).length === 0 && (
                <div className="kanban-empty">Drop here</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add Candidate</h2>
              <button className="modal-close btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label className="form-label">Role / Position</label>
                  <input className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Virtual Assistant" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Stage</label>
                  <select className="form-select" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as CandidateStage })}>
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Source</label>
                  <input className="form-input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. LinkedIn, Referral" />
                </div>
                <div className="form-group">
                  <label className="form-label">Applied Date</label>
                  <input className="form-input" type="date" value={form.appliedAt} onChange={(e) => setForm({ ...form, appliedAt: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">LinkedIn URL</label>
                  <input className="form-input" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/..." />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Resume URL</label>
                  <input className="form-input" value={form.resumeUrl} onChange={(e) => setForm({ ...form, resumeUrl: e.target.value })} placeholder="https://drive.google.com/..." />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Interview notes, comments..." />
                </div>
              </div>

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
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No files. Accepts images, PDFs, audio (max 5 MB each). For videos, paste a link in Resume URL.</div>
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
                Add Candidate
              </button>
            </div>
          </div>
        </div>
      )}

      {hireCandidate && (
        <div className="modal-overlay" onClick={closeHireModal}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Hire Candidate</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Complete the missing employee details for {hireCandidate.name}
                </div>
              </div>
              <button className="modal-close btn-icon" onClick={closeHireModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Full Name *</label>
                  <input className="form-input" value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label className="form-label">Role / Position</label>
                  <input className="form-input" value={employeeForm.role} onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })} placeholder="e.g. Intake Specialist" />
                </div>
                <div className="form-group">
                  <label className="form-label">Employment Type</label>
                  <select className="form-select" value={employeeForm.employmentType} onChange={(e) => setEmployeeForm({ ...employeeForm, employmentType: e.target.value })}>
                    {EMPLOYMENT_TYPES.map(type => <option key={type} value={type}>{type || '— Not set —'}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Pay Rate ($/hr)</label>
                  <input className="form-input" type="number" value={employeeForm.payRate} onChange={(e) => setEmployeeForm({ ...employeeForm, payRate: e.target.value })} placeholder="4.50" />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={employeeForm.status} onChange={(e) => setEmployeeForm({ ...employeeForm, status: e.target.value })}>
                    {EMPLOYEE_STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={employeeForm.email} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} placeholder="name@example.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={employeeForm.phone} onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Location</label>
                  <input className="form-input" value={employeeForm.location} onChange={(e) => setEmployeeForm({ ...employeeForm, location: e.target.value })} placeholder="Santo Domingo, DO" />
                </div>
                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <input className="form-input" value={employeeForm.timezone} onChange={(e) => setEmployeeForm({ ...employeeForm, timezone: e.target.value })} placeholder="EST / AST" />
                </div>
                <div className="form-group">
                  <label className="form-label">Hire Year</label>
                  <input className="form-input" value={employeeForm.startYear} onChange={(e) => setEmployeeForm({ ...employeeForm, startYear: e.target.value })} placeholder="2025" />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Internal Notes</label>
                  <textarea className="form-textarea" rows={2} value={employeeForm.notes} onChange={(e) => setEmployeeForm({ ...employeeForm, notes: e.target.value })} placeholder="Performance notes, schedule preferences, etc." />
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                Candidate info is preserved in the pipeline and this will create the linked employee profile details.
              </div>

              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>
                    Files &amp; Documents {hireAttachments.length > 0 && `(${hireAttachments.length})`}
                  </div>
                  <button className="btn-ghost btn-xs" onClick={() => hireFileInputRef.current?.click()}>+ Upload</button>
                  <input ref={hireFileInputRef} type="file" accept="image/*,.pdf,audio/*" style={{ display: 'none' }}
                    onChange={e => { const file = e.target.files?.[0]; if (file) handleHireFileUpload(file); e.target.value = '' }} />
                </div>
                {hireAttachments.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No files. Candidate attachments will carry over and you can add more here.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {hireAttachments.map(att => (
                      <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px' }}>
                        <span style={{ fontSize: 16 }}>{att.mimeType.startsWith('image/') ? '🖼' : att.mimeType === 'application/pdf' ? '📄' : att.mimeType.startsWith('audio/') ? '🎵' : '📎'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{(att.size / 1024).toFixed(0)} KB</div>
                        </div>
                        <a href={att.dataUrl} download={att.name} className="btn-ghost btn-xs">↓</a>
                        <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setHireAttachments(prev => prev.filter(a => a.id !== att.id))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={closeHireModal}>Cancel</button>
              <button className="btn-primary" onClick={() => { void confirmHire() }} disabled={!employeeForm.name.trim()}>
                Hire And Create Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Checklist */}
      {onboardingCandidate && (
        <div className="modal-overlay" onClick={() => setOnboardingCandidate(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Onboarding — {onboardingCandidate.name}</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{onboardingCandidate.role || 'New hire'}</div>
              </div>
              <button className="modal-close btn-icon" onClick={() => setOnboardingCandidate(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                Complete the following steps to onboard {onboardingCandidate.name.split(' ')[0]}:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ONBOARDING_TASKS.map((task, i) => (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                    background: checkedTasks.has(i) ? 'rgba(34,197,94,.08)' : 'var(--surf2)',
                    borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                    border: `1px solid ${checkedTasks.has(i) ? 'rgba(34,197,94,.3)' : 'var(--border)'}`,
                    textDecoration: checkedTasks.has(i) ? 'line-through' : 'none',
                    color: checkedTasks.has(i) ? 'var(--muted)' : 'var(--soft)',
                  }}>
                    <input
                      type="checkbox"
                      style={{ width: 16, height: 16, accentColor: '#22c55e' }}
                      checked={checkedTasks.has(i)}
                      onChange={() => setCheckedTasks(prev => {
                        const next = new Set(prev)
                        next.has(i) ? next.delete(i) : next.add(i)
                        return next
                      })}
                    />
                    {task}
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                {checkedTasks.size} / {ONBOARDING_TASKS.length} completed
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setOnboardingCandidate(null)}>Close</button>
              {checkedTasks.size === ONBOARDING_TASKS.length && (
                <button className="btn-primary" onClick={() => setOnboardingCandidate(null)}>All Done!</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Remove candidate?</div>
            <div className="confirm-body">This action cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => deleteCandidate(confirmDelete)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
