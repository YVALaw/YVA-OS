import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Attachment, Candidate, CandidateStage } from '../data/types'
import { loadCandidates, saveCandidates } from '../services/storage'
import { uploadFile, deleteFile } from '../services/fileStorage'

function uid() { return crypto.randomUUID() }

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

const STAGES: { key: CandidateStage; label: string }[] = [
  { key: 'applied',   label: 'Applied' },
  { key: 'screening', label: 'Screening' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer',     label: 'Offer' },
  { key: 'hired',     label: 'Hired' },
  { key: 'rejected',  label: 'Rejected' },
]

function stageBadge(s: CandidateStage): string {
  switch (s) {
    case 'hired':    return 'badge-green'
    case 'offer':    return 'badge-teal'
    case 'interview': return 'badge-blue'
    case 'rejected': return 'badge-red'
    case 'screening': return 'badge-yellow'
    default:         return 'badge-gray'
  }
}

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

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [candidates, setCandidatesState] = useState<Candidate[]>([])
  useEffect(() => { loadCandidates().then(setCandidatesState) }, [])

  const candidate = candidates.find(c => c.id === id)

  const [editing, setEditing]   = useState(false)
  const [form, setForm]         = useState({
    name: '', email: '', phone: '', role: '', source: '',
    stage: 'applied' as CandidateStage, notes: '', resumeUrl: '', linkedinUrl: '', appliedAt: '',
  })
  const [attachments, setAttachments]   = useState<Attachment[]>([])

  // Sync form from candidate once data loads (only when not actively editing)
  useEffect(() => {
    if (candidate && !editing) {
      setForm({
        name:        candidate.name ?? '',
        email:       candidate.email ?? '',
        phone:       candidate.phone ?? '',
        role:        candidate.role ?? '',
        source:      candidate.source ?? '',
        stage:       candidate.stage ?? 'applied',
        notes:       candidate.notes ?? '',
        resumeUrl:   candidate.resumeUrl ?? '',
        linkedinUrl: candidate.linkedinUrl ?? '',
        appliedAt:   candidate.appliedAt ?? '',
      })
      setAttachments(candidate.attachments ?? [])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [checkedTasks, setCheckedTasks]   = useState<Set<number>>(new Set())

  if (!candidate) {
    return (
      <div className="page-wrap">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          Candidate not found.
          <br /><button className="btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/candidates')}>← Back to Candidates</button>
        </div>
      </div>
    )
  }

  // candidate is guaranteed non-null here (early return above handles null case)
  const candidateNN = candidate!

  function persistUpdate(updated: Candidate) {
    const next = candidates.map(c => c.id === updated.id ? updated : c)
    setCandidatesState(next)
    void saveCandidates(next)
  }

  function handleSave() {
    if (!form.name.trim()) return
    const updated: Candidate = {
      ...candidateNN,
      name:        form.name,
      email:       form.email || undefined,
      phone:       form.phone || undefined,
      role:        form.role || undefined,
      source:      form.source || undefined,
      stage:       form.stage,
      notes:       form.notes || undefined,
      resumeUrl:   form.resumeUrl || undefined,
      linkedinUrl: form.linkedinUrl || undefined,
      appliedAt:   form.appliedAt || undefined,
      updatedAt:   Date.now(),
      attachments,
    }
    persistUpdate(updated)
    setEditing(false)
  }

  function handleCancel() {
    setForm({
      name:       candidateNN.name,
      email:      candidateNN.email ?? '',
      phone:      candidateNN.phone ?? '',
      role:       candidateNN.role ?? '',
      source:     candidateNN.source ?? '',
      stage:      candidateNN.stage,
      notes:      candidateNN.notes ?? '',
      resumeUrl:  candidateNN.resumeUrl ?? '',
      linkedinUrl: candidateNN.linkedinUrl ?? '',
      appliedAt:  candidateNN.appliedAt ?? '',
    })
    setAttachments(candidateNN.attachments ?? [])
    setEditing(false)
  }

  function handleDelete() {
    const next = candidates.filter(c => c.id !== candidateNN.id)
    setCandidatesState(next)
    void saveCandidates(next)
    navigate('/candidates')
  }

  function moveStage(stage: CandidateStage) {
    persistUpdate({ ...candidateNN, stage, updatedAt: Date.now() })
    setForm(f => ({ ...f, stage }))
  }

  function handleFileUpload(file: File) {
    if (file.size > 200 * 1024 * 1024) { alert('File too large (max 200 MB).'); return }
    void (async () => {
      try {
        const { storageUrl, storagePath } = await uploadFile(file, `candidates/${candidateNN.id}`)
        const att: Attachment = {
          id: uid(), name: file.name, mimeType: file.type,
          size: file.size, dataUrl: storageUrl, storageUrl, storagePath, uploadedAt: Date.now(),
        }
        setAttachments(prev => {
          const next = [...prev, att]
          persistUpdate({ ...candidateNN, attachments: next })
          return next
        })
      } catch (e) {
        console.error('Upload failed', e)
        alert('Upload failed. Please try again.')
      }
    })()
  }

  function removeAttachment(attId: string) {
    const att = attachments.find(a => a.id === attId)
    if (att?.storagePath) void deleteFile(att.storagePath)
    setAttachments(prev => {
      const next = prev.filter(a => a.id !== attId)
      persistUpdate({ ...candidateNN, attachments: next })
      return next
    })
  }

  function toggleOnboarding(i: number) {
    setCheckedTasks(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const color = avatarColor(candidateNN.name)

  return (
    <div className="page-wrap" style={{ maxWidth: 860 }}>
      <button className="btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/candidates')}>
        ← Back to Candidates
      </button>

      {/* Header */}
      <div className="profile-header">
        <div className="profile-header-left">
          <div className="avatar profile-avatar" style={{ background: color }}>{initials(candidateNN.name)}</div>
          <div>
            {editing
              ? <input className="form-input profile-name-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              : <h1 className="profile-name">{candidateNN.name}</h1>
            }
            <div className="profile-sub">
              {candidateNN.role && <span style={{ color: 'var(--muted)' }}>{candidateNN.role}</span>}
              {candidateNN.role && candidateNN.source && <span style={{ color: 'var(--muted)' }}> · </span>}
              {candidateNN.source && <span style={{ color: 'var(--muted)' }}>via {candidateNN.source}</span>}
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
              <span className={`badge ${stageBadge(candidateNN.stage)}`} style={{ fontSize: 13 }}>{candidateNN.stage}</span>
              <select
                className="form-select"
                style={{ width: 130, height: 30, fontSize: 12 }}
                value={candidateNN.stage}
                onChange={e => moveStage(e.target.value as CandidateStage)}
              >
                {STAGES.map(s => <option key={s.key} value={s.key}>→ {s.label}</option>)}
              </select>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit Profile</button>
              <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="profile-grid">
        {/* Left - info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="data-card">
            <div className="data-card-title">Candidate Information</div>
            <div className="profile-fields">
              {editing ? (
                <>
                  <div className="profile-field">
                    <span className="profile-field-label">Stage</span>
                    <select className="form-select form-input-sm" value={form.stage} onChange={e => setForm(f => ({...f, stage: e.target.value as CandidateStage}))}>
                      {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Role</span>
                    <input className="form-input form-input-sm" value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} placeholder="Position applied for" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Email</span>
                    <input className="form-input form-input-sm" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Phone</span>
                    <input className="form-input form-input-sm" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Source</span>
                    <input className="form-input form-input-sm" value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))} placeholder="LinkedIn, referral, etc." />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Applied Date</span>
                    <input className="form-input form-input-sm" type="date" value={form.appliedAt} onChange={e => setForm(f => ({...f, appliedAt: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Resume URL</span>
                    <input className="form-input form-input-sm" value={form.resumeUrl} onChange={e => setForm(f => ({...f, resumeUrl: e.target.value}))} placeholder="https://..." />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">LinkedIn</span>
                    <input className="form-input form-input-sm" value={form.linkedinUrl} onChange={e => setForm(f => ({...f, linkedinUrl: e.target.value}))} placeholder="https://linkedin.com/in/..." />
                  </div>
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Notes</span>
                    <textarea className="form-textarea" rows={4} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Interview notes, impressions..." />
                  </div>
                </>
              ) : (
                <>
                  {[
                    { label: 'Stage',       value: candidateNN.stage },
                    { label: 'Role',        value: candidateNN.role },
                    { label: 'Email',       value: candidateNN.email },
                    { label: 'Phone',       value: candidateNN.phone },
                    { label: 'Source',      value: candidateNN.source },
                    { label: 'Applied',     value: candidateNN.appliedAt },
                    { label: 'Resume URL',  value: candidateNN.resumeUrl },
                    { label: 'LinkedIn',    value: candidateNN.linkedinUrl },
                  ].map(({ label, value }) => value ? (
                    <div key={label} className="profile-field">
                      <span className="profile-field-label">{label}</span>
                      {label === 'Resume URL' || label === 'LinkedIn'
                        ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)', fontSize: 13 }}>{value}</a>
                        : <span className="profile-field-value">{value}</span>}
                    </div>
                  ) : null)}
                  {candidateNN.notes && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Notes</span>
                      <span className="profile-field-value" style={{ whiteSpace: 'pre-wrap' }}>{candidateNN.notes}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Attachments */}
          <div className="data-card">
            <div className="data-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Attachments
              <button className="btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>+ Upload</button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*,video/*"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
            {attachments.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>No files yet. Upload CV, voice notes, videos, or documents.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {attachments.map(att => (
                  <div key={att.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surf3)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{att.mimeType.startsWith('image') ? '🖼' : att.mimeType.startsWith('audio') ? '🎵' : att.mimeType.startsWith('video') ? '🎬' : '📄'}</span>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{att.size >= 1024*1024 ? (att.size/1024/1024).toFixed(1)+' MB' : (att.size/1024).toFixed(1)+' KB'} · {new Date(att.uploadedAt).toLocaleDateString()}</div>
                      </div>
                      {att.mimeType.startsWith('audio') && <audio controls src={att.storageUrl || att.dataUrl} style={{ height: 28, maxWidth: 140 }} />}
                      <a href={att.storageUrl || att.dataUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 8px' }}>↓</a>
                      <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => removeAttachment(att.id)}>×</button>
                    </div>
                    {att.mimeType.startsWith('video') && (
                      <video controls src={att.storageUrl || att.dataUrl} style={{ width: '100%', maxHeight: 200, borderRadius: 6, marginTop: 2 }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — Onboarding checklist (if hired) */}
        {candidateNN.stage === 'hired' && (
          <div className="data-card" style={{ alignSelf: 'start' }}>
            <div className="data-card-title">Onboarding Checklist</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              {checkedTasks.size} / {ONBOARDING_TASKS.length} complete
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ONBOARDING_TASKS.map((task, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={checkedTasks.has(i)} onChange={() => toggleOnboarding(i)} />
                  <span style={{ fontSize: 14, textDecoration: checkedTasks.has(i) ? 'line-through' : 'none', color: checkedTasks.has(i) ? 'var(--muted)' : 'var(--text)' }}>
                    {task}
                  </span>
                </label>
              ))}
            </div>
            {checkedTasks.size === ONBOARDING_TASKS.length && (
              <div style={{ marginTop: 16, background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 8, padding: 12, textAlign: 'center', color: '#4ade80', fontWeight: 600 }}>
                All onboarding tasks complete!
              </div>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete {candidateNN.name}?</div>
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
