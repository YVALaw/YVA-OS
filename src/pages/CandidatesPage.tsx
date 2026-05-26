import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Attachment, Candidate, CandidateStage, Employee } from '../data/types'
import {
  loadCandidates,
  loadEmployeeCounter,
  loadEmployees,
  saveCandidates,
  saveEmployeeCounter,
  saveEmployees,
} from '../services/storage'
import { useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import {
  Avatar,
  Drawer,
  KanbanColumn,
  KanbanItem,
  Modal,
  ProtoIcon,
  SearchField,
  colorFromString,
  protoDateShort,
  useKanbanDnd,
} from '../components/PrototypeKit'

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

const STAGES: { key: CandidateStage; label: string; color: string }[] = [
  { key: 'applied', label: 'Applied', color: '#3b82f6' },
  { key: 'screening', label: 'Screening', color: '#a855f7' },
  { key: 'interview', label: 'Interview', color: '#f97316' },
  { key: 'offer', label: 'Offer', color: '#22d3ee' },
  { key: 'hired', label: 'Hired', color: '#22c55e' },
  { key: 'rejected', label: 'Rejected', color: '#64748b' },
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
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<null | 'add'>(null)
  const [form, setForm] = useState<Omit<Candidate, 'id' | 'updatedAt'>>(EMPTY_FORM)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [hireCandidate, setHireCandidate] = useState<Candidate | null>(null)
  const [employeeForm, setEmployeeForm] = useState<EmployeeFormData>(EMPTY_EMPLOYEE_FORM)
  const [hireAttachments, setHireAttachments] = useState<Attachment[]>([])
  const [checkedTasks, setCheckedTasks] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hireFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadCandidates().then(all => setCandidates(hiredOnly ? all.filter(candidate => candidate.stage === 'hired') : all))
    loadEmployees().then(setEmployees)
  }, [hiredOnly])

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
    persist([...candidates, { ...form, id: uid(), updatedAt: Date.now(), attachments }])
    setModal(null)
  }

  function deleteCandidate(id: string) {
    persist(candidates.filter(candidate => candidate.id !== id))
    setConfirmDelete(null)
    if (selectedCandidateId === id) setSelectedCandidateId(null)
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
      const next = candidates.filter(item => item.id !== candidate.id)
      persist(next)
      setSelectedCandidateId(candidate.id)
      return
    }
    setHireCandidate(candidate)
    setEmployeeForm(buildEmployeeForm(candidate))
    setHireAttachments(candidate.attachments || [])
  }

  function moveStage(id: string, stage: CandidateStage) {
    const candidate = candidates.find(item => item.id === id)
    if (!candidate) return
    if (stage === 'hired') {
      persist(candidates.map(item => (item.id === id ? { ...item, stage, updatedAt: Date.now() } : item)))
      return
    }
    persist(candidates.map(item => (item.id === id ? { ...item, stage, updatedAt: Date.now() } : item)))
  }

  function openCandidate(candidateId: string) {
    setSelectedCandidateId(candidateId)
    setCheckedTasks(new Set())
  }

  function onDragStart(id: string) {
    // handled by useKanbanDnd
    return id
  }

  function handleFileUpload(file: File) {
    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) {
      alert('File too large (max 5 MB). For videos, paste a link in Resume URL instead.')
      return
    }
    const reader = new FileReader()
    reader.onload = event => {
      const att: Attachment = {
        id: uid(),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl: event.target?.result as string,
        uploadedAt: Date.now(),
      }
      setAttachments(prev => [...prev, att])
    }
    reader.readAsDataURL(file)
  }

  function handleHireFileUpload(file: File) {
    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) {
      alert('File too large (max 5 MB). For videos, paste a link in Resume URL instead.')
      return
    }
    const reader = new FileReader()
    reader.onload = event => {
      const att: Attachment = {
        id: uid(),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl: event.target?.result as string,
        uploadedAt: Date.now(),
      }
      setHireAttachments(prev => [...prev, att])
    }
    reader.readAsDataURL(file)
  }

  function closeHireModal() {
    setHireCandidate(null)
    setEmployeeForm(EMPTY_EMPLOYEE_FORM)
    setHireAttachments([])
  }

  async function confirmHire() {
    if (!hireCandidate || !employeeForm.name.trim()) return

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
      await Promise.all([saveCandidates(nextCandidates), saveEmployees(nextEmployees)])
      closeHireModal()
      setSelectedCandidateId(null)
    } catch (error) {
      setCandidates(candidates)
      setEmployees(employees)
      alert(error instanceof Error ? error.message : 'Failed to hire candidate')
    }
  }

  const query = search.trim().toLowerCase()
  const filtered = candidates.filter(candidate => {
    if (!query) return true
    return [
      candidate.name,
      candidate.role || '',
      candidate.source || '',
      candidate.email || '',
    ].join(' ').toLowerCase().includes(query)
  })

  const byStage: Record<CandidateStage, Candidate[]> = {
    applied: [],
    screening: [],
    interview: [],
    offer: [],
    hired: [],
    rejected: [],
  }
  filtered.forEach(candidate => byStage[candidate.stage].push(candidate))

  const dnd = useKanbanDnd<Candidate>(candidates, setCandidates, (candidate, newStage) => ({ ...candidate, stage: newStage as CandidateStage, updatedAt: Date.now() }))
  const selectedCandidate = selectedCandidateId ? candidates.find(candidate => candidate.id === selectedCandidateId) || null : null
  const pipelineCount = candidates.filter(candidate => !['hired', 'rejected'].includes(candidate.stage)).length
  const offerCount = candidates.filter(candidate => candidate.stage === 'offer').length
  const hiredCount = candidates.filter(candidate => candidate.stage === 'hired').length
  const rejectedCount = candidates.filter(candidate => candidate.stage === 'rejected').length

  if (hiredOnly) {
    return (
      <div className="proto-page">
        <div className="proto-page-head">
          <div className="proto-page-head-row">
            <div>
              <div className="proto-eyebrow">Grow · Recruiting</div>
              <h1 className="page-title">Hired Staff</h1>
              <p className="page-sub">Candidates who were hired and remain available for payroll reference.</p>
            </div>
          </div>
        </div>
        <div className="proto-page-body">
          <div className="proto-kpi-grid-4" style={{ marginBottom: 16 }}>
            {[
              { label: 'Visible Hires', value: candidates.length, color: 'var(--emerald)' },
              { label: 'Open pipeline', value: pipelineCount, color: 'var(--blue)' },
              { label: 'Offers', value: offerCount, color: 'var(--gold)' },
              { label: 'Rejected', value: rejectedCount, color: 'var(--dim)' },
            ].map(card => (
              <div key={card.label} className="proto-kpi">
                <div className="proto-kpi-accent" style={{ background: card.color }} />
                <div className="proto-kpi-label">{card.label}</div>
                <div className="proto-kpi-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="card-grid">
            {candidates.map(candidate => (
              <button key={candidate.id} type="button" className="proto-plain-button" onClick={() => openCandidate(candidate.id)} style={{ justifyContent: 'flex-start', padding: 14 }}>
                <Avatar name={candidate.name} color={colorFromString(candidate.name)} size="md" />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{candidate.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{candidate.role || 'No role set'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <Drawer open={Boolean(selectedCandidate)} onClose={() => setSelectedCandidateId(null)} width={560}>
          {selectedCandidate && <CandidateDrawer candidate={selectedCandidate} onClose={() => setSelectedCandidateId(null)} onAdvance={moveStage} onHire={startHire} onDelete={() => setConfirmDelete(selectedCandidate.id)} checkedTasks={checkedTasks} setCheckedTasks={setCheckedTasks} />}
        </Drawer>
      </div>
    )
  }

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="proto-eyebrow">Grow · Recruiting</div>
            <h1 className="page-title">Candidates</h1>
            <p className="page-sub">
              <strong>{pipelineCount}</strong> in pipeline · <strong>{offerCount}</strong> in offer · <strong>{hiredCount}</strong> hired this month
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="proto-btn proto-btn-ghost" onClick={() => fileInputRef.current?.click()}>
              <ProtoIcon name="download" size={13} />
              Import CSV
            </button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={openAdd}>
              <ProtoIcon name="plus" size={13} />
              Add Candidate
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*,video/*,.mp4,.mov,.avi,.webm,.mkv,.m4v,.wmv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
          </div>
        </div>

        <div className="proto-page-head-row" style={{ alignItems: 'center' }}>
          <SearchField value={search} onChange={setSearch} placeholder="Search by name or role..." minWidth={280} />
          <div className="proto-mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
            Drag cards between columns to change stage
          </div>
        </div>
      </div>

      <div className="proto-page-body">
        <div className="proto-kpi-grid-4" style={{ marginBottom: 16 }}>
          {[
            { label: 'Visible Candidates', value: candidates.length, color: 'var(--blue)' },
            { label: 'Interview / Offer', value: candidates.filter(candidate => candidate.stage === 'interview' || candidate.stage === 'offer').length, color: 'var(--purple)' },
            { label: 'Converted To Hire', value: hiredCount, color: 'var(--emerald)' },
            { label: 'Closed Out', value: rejectedCount, color: 'var(--red)' },
          ].map(card => (
            <div key={card.label} className="proto-kpi">
              <div className="proto-kpi-accent" style={{ background: card.color }} />
              <div className="proto-kpi-label">{card.label}</div>
              <div className="proto-kpi-value">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="kanban" style={{ '--kanban-cols': STAGES.length } as React.CSSProperties}>
          {STAGES.map(stage => (
            <KanbanColumn<Candidate>
              key={stage.key}
              column={{ id: stage.key, label: stage.label, items: byStage[stage.key] }}
              dnd={dnd}
              accent={stage.color}
              headerRight={<button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={openAdd}><ProtoIcon name="plus" size={12} /></button>}
            >
              {byStage[stage.key].map(candidate => (
                <KanbanItem
                  key={candidate.id}
                  item={candidate}
                  dnd={dnd}
                  accent={stage.color}
                  sourceColumnId={stage.key}
                  onClick={() => openCandidate(candidate.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Avatar name={candidate.name} color={colorFromString(candidate.name)} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="kanban-card-name">{candidate.name}</div>
                      <div className="kanban-card-role">{candidate.role || 'No role set'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>{candidate.source || 'Manual'}</span>
                    <span className="proto-mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{candidate.appliedAt ? `${Math.abs(new Date(`${candidate.appliedAt}T12:00:00`).getTime() - Date.now()) / 86400000 | 0}d` : '—'}</span>
                  </div>
                </KanbanItem>
              ))}
            </KanbanColumn>
          ))}
        </div>
      </div>

      <Drawer open={Boolean(selectedCandidate)} onClose={() => setSelectedCandidateId(null)} width={580}>
        {selectedCandidate && <CandidateDrawer candidate={selectedCandidate} onClose={() => setSelectedCandidateId(null)} onAdvance={moveStage} onHire={startHire} onDelete={() => setConfirmDelete(selectedCandidate.id)} checkedTasks={checkedTasks} setCheckedTasks={setCheckedTasks} />}
      </Drawer>

      <Modal
        open={modal === 'add'}
        onClose={() => setModal(null)}
        title="Add Candidate"
        subtitle="Capture the profile, source, and supporting material in the new recruiting layout."
        width={760}
        footer={(
          <>
            <button type="button" className="proto-btn proto-btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={saveForm} disabled={!form.name.trim()}>Add Candidate</button>
          </>
        )}
      >
        <div className="proto-two-col" style={{ gap: 14 }}>
          <div className="proto-list-card">
            <div className="proto-list-card-head"><span>Candidate Profile</span></div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Name *</label>
              <input className="proto-input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Full name" />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Role</label>
              <input className="proto-input" value={form.role} onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))} placeholder="e.g. Virtual Assistant" />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Email</label>
              <input className="proto-input" type="email" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="name@example.com" />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Phone</label>
              <input className="proto-input" value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+1 555 000 0000" />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Stage</label>
              <select className="proto-input" value={form.stage} onChange={e => setForm(prev => ({ ...prev, stage: e.target.value as CandidateStage }))}>
                {STAGES.map(stage => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
              </select>
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Source</label>
              <input className="proto-input" value={form.source} onChange={e => setForm(prev => ({ ...prev, source: e.target.value }))} placeholder="LinkedIn, referral, etc." />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Applied date</label>
              <input className="proto-input" type="date" value={form.appliedAt} onChange={e => setForm(prev => ({ ...prev, appliedAt: e.target.value }))} />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">LinkedIn</label>
              <input className="proto-input" value={form.linkedinUrl} onChange={e => setForm(prev => ({ ...prev, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/..." />
            </div>
            <div className="proto-profile-row">
              <label className="proto-profile-label">Resume URL</label>
              <input className="proto-input" value={form.resumeUrl} onChange={e => setForm(prev => ({ ...prev, resumeUrl: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="proto-profile-row" style={{ alignItems: 'flex-start' }}>
              <label className="proto-profile-label">Notes</label>
              <textarea className="proto-input" rows={3} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
            </div>
          </div>

          <div className="proto-sidebar-stack">
            <div className="proto-list-card">
              <div className="proto-list-card-head"><span>Files & Documents</span></div>
              <button type="button" className="proto-btn proto-btn-ghost" onClick={() => fileInputRef.current?.click()}>
                <ProtoIcon name="plus" size={12} />
                Upload
              </button>
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); e.target.value = '' }} />
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {attachments.length === 0 ? (
                  <div className="proto-empty">No files yet.</div>
                ) : attachments.map(att => (
                  <div key={att.id} className="proto-list-row" style={{ alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{att.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(att.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => setAttachments(prev => prev.filter(item => item.id !== att.id))}>
                      <ProtoIcon name="close" size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {hireCandidate && (
        <Modal
          open={Boolean(hireCandidate)}
          onClose={closeHireModal}
          title="Hire Candidate"
          subtitle={`Complete the employee record for ${hireCandidate.name}`}
          width={760}
          footer={(
            <>
              <button type="button" className="proto-btn proto-btn-ghost" onClick={closeHireModal}>Cancel</button>
              <button type="button" className="proto-btn proto-btn-primary" onClick={() => void confirmHire()} disabled={!employeeForm.name.trim()}>
                Hire And Create Profile
              </button>
            </>
          )}
        >
          <div className="proto-two-col" style={{ gap: 14 }}>
            <div className="proto-list-card">
              <div className="proto-list-card-head"><span>Employee Details</span></div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Full Name *</label>
                <input className="proto-input" value={employeeForm.name} onChange={e => setEmployeeForm(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Role</label>
                <input className="proto-input" value={employeeForm.role} onChange={e => setEmployeeForm(prev => ({ ...prev, role: e.target.value }))} />
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Employment Type</label>
                <select className="proto-input" value={employeeForm.employmentType} onChange={e => setEmployeeForm(prev => ({ ...prev, employmentType: e.target.value }))}>
                  {EMPLOYMENT_TYPES.map(type => <option key={type} value={type}>{type || 'Not set'}</option>)}
                </select>
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Pay Rate</label>
                <input className="proto-input" type="number" value={employeeForm.payRate} onChange={e => setEmployeeForm(prev => ({ ...prev, payRate: e.target.value }))} />
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Status</label>
                <select className="proto-input" value={employeeForm.status} onChange={e => setEmployeeForm(prev => ({ ...prev, status: e.target.value }))}>
                  {EMPLOYEE_STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Email</label>
                <input className="proto-input" type="email" value={employeeForm.email} onChange={e => setEmployeeForm(prev => ({ ...prev, email: e.target.value }))} />
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Phone</label>
                <input className="proto-input" value={employeeForm.phone} onChange={e => setEmployeeForm(prev => ({ ...prev, phone: e.target.value }))} />
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Location</label>
                <input className="proto-input" value={employeeForm.location} onChange={e => setEmployeeForm(prev => ({ ...prev, location: e.target.value }))} />
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Timezone</label>
                <input className="proto-input" value={employeeForm.timezone} onChange={e => setEmployeeForm(prev => ({ ...prev, timezone: e.target.value }))} />
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Hire Year</label>
                <input className="proto-input" value={employeeForm.startYear} onChange={e => setEmployeeForm(prev => ({ ...prev, startYear: e.target.value }))} />
              </div>
              <div className="proto-profile-row" style={{ alignItems: 'flex-start' }}>
                <label className="proto-profile-label">Notes</label>
                <textarea className="proto-input" rows={3} value={employeeForm.notes} onChange={e => setEmployeeForm(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            </div>

            <div className="proto-sidebar-stack">
              <div className="proto-list-card">
                <div className="proto-list-card-head"><span>Attachments</span></div>
                <button type="button" className="proto-btn proto-btn-ghost" onClick={() => hireFileInputRef.current?.click()}>
                  <ProtoIcon name="plus" size={12} />
                  Upload
                </button>
                <input ref={hireFileInputRef} type="file" accept="image/*,.pdf,audio/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) handleHireFileUpload(file); e.target.value = '' }} />
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                  {hireAttachments.length === 0 ? (
                    <div className="proto-empty">No attachments yet.</div>
                  ) : hireAttachments.map(att => (
                    <div key={att.id} className="proto-list-row">
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{att.name}</span>
                      <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => setHireAttachments(prev => prev.filter(item => item.id !== att.id))}>
                        <ProtoIcon name="close" size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <Drawer open={Boolean(selectedCandidate)} onClose={() => setSelectedCandidateId(null)} width={580}>
        {selectedCandidate && (
          <CandidateDrawer
            candidate={selectedCandidate}
            onClose={() => setSelectedCandidateId(null)}
            onAdvance={moveStage}
            onHire={startHire}
            onDelete={() => setConfirmDelete(selectedCandidate.id)}
            checkedTasks={checkedTasks}
            setCheckedTasks={setCheckedTasks}
          />
        )}
      </Drawer>

      {confirmDelete ? (
        <Modal
          open={Boolean(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
          title="Remove candidate?"
          subtitle="This action cannot be undone."
          width={420}
          footer={(
            <>
              <button type="button" className="proto-btn proto-btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button type="button" className="proto-btn proto-btn-danger" onClick={() => deleteCandidate(confirmDelete)}>Remove</button>
            </>
          )}
        >
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Removing a candidate deletes them from the recruiting pipeline.</p>
        </Modal>
      ) : null}
    </div>
  )
}

function CandidateDrawer({
  candidate,
  onClose,
  onAdvance,
  onHire,
  onDelete,
  checkedTasks,
  setCheckedTasks,
}: {
  candidate: Candidate
  onClose: () => void
  onAdvance: (id: string, stage: CandidateStage) => void
  onHire: (candidate: Candidate) => void
  onDelete: () => void
  checkedTasks: Set<number>
  setCheckedTasks: Dispatch<SetStateAction<Set<number>>>
}) {
  const daysAgo = candidate.appliedAt ? Math.max(0, Math.round((Date.now() - new Date(`${candidate.appliedAt}T12:00:00`).getTime()) / 86400000)) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Avatar name={candidate.name} color={colorFromString(candidate.name)} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{candidate.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {candidate.role || 'No role set'}
              {candidate.source ? ` · via ${candidate.source}` : ''}
              {candidate.appliedAt ? ` · Applied ${protoDateShort(candidate.appliedAt)}` : ''}
            </div>
          </div>
        </div>
        <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={onClose}>
          <ProtoIcon name="close" size={14} />
        </button>
      </div>

      <div style={{ padding: 22, overflow: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <button type="button" className="proto-btn proto-btn-primary" onClick={() => onAdvance(candidate.id, 'screening')}>
            <ProtoIcon name="arrowR" size={12} />
            Advance
          </button>
          <button type="button" className="proto-btn proto-btn-ghost" onClick={() => onHire(candidate)}>
            <ProtoIcon name="plus" size={12} />
            Hire
          </button>
          <button type="button" className="proto-btn proto-btn-ghost" onClick={() => onAdvance(candidate.id, 'interview')}>
            <ProtoIcon name="send" size={12} />
            Schedule
          </button>
          <button type="button" className="proto-btn proto-btn-danger" onClick={onDelete}>
            <ProtoIcon name="trash" size={12} />
            Reject
          </button>
        </div>

        <div className="proto-list-card" style={{ marginBottom: 14 }}>
          <div className="proto-list-card-head">
            <span>Onboarding checklist</span>
          </div>
          <div className="proto-checklist">
            {ONBOARDING_TASKS.map((task, index) => (
              <button
                key={task}
                type="button"
                className={`proto-checklist-row${checkedTasks.has(index) ? ' done' : ''}`}
                onClick={() => setCheckedTasks(prev => {
                  const next = new Set(prev)
                  next.has(index) ? next.delete(index) : next.add(index)
                  return next
                })}
              >
                <span className={`proto-check${checkedTasks.has(index) ? ' done' : ''}`} />
                <span style={{ textDecoration: checkedTasks.has(index) ? 'line-through' : 'none' }}>{task}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
            {checkedTasks.size} / {ONBOARDING_TASKS.length} completed
          </div>
        </div>

        <div className="proto-list-card">
          <div className="proto-list-card-head">
            <span>Notes</span>
            <span className="proto-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{daysAgo != null ? `${daysAgo}d ago` : '—'}</span>
          </div>
          <textarea className="proto-input" rows={5} defaultValue={candidate.notes || ''} placeholder="Add private notes..." />
        </div>
      </div>
    </div>
  )
}
