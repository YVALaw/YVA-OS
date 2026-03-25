import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Attachment, Candidate, CandidateStage } from '../data/types'
import { loadCandidates, saveCandidates } from '../services/storage'
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

export default function CandidatesPage() {
  const navigate = useNavigate()
  const { role } = useRole()
  const hiredOnly = can.viewHiredOnly(role)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  useEffect(() => { loadCandidates().then(all => setCandidates(hiredOnly ? all.filter(c => c.stage === 'hired') : all)) }, [hiredOnly])
  const [modal, setModal] = useState<null | 'add'>(null)
  const [form, setForm] = useState<Omit<Candidate, 'id' | 'updatedAt'>>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [onboardingCandidate, setOnboardingCandidate] = useState<Candidate | null>(null)
  const [checkedTasks, setCheckedTasks] = useState<Set<number>>(new Set())
  const dragId = useRef<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function moveStage(id: string, stage: CandidateStage) {
    persist(candidates.map((c) => (c.id === id ? { ...c, stage, updatedAt: Date.now() } : c)))
    if (stage === 'hired') {
      const cand = candidates.find(c => c.id === id)
      if (cand) { setOnboardingCandidate(cand); setCheckedTasks(new Set()) }
    }
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
