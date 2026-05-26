import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Attachment, Candidate, CandidateStage } from '../data/types'
import { loadCandidates, saveCandidates } from '../services/storage'
import { uploadFile, deleteFile } from '../services/fileStorage'
import {
  Avatar,
  Modal,
  ProtoIcon,
  StatusChip,
  colorFromString,
  protoDateShort,
} from '../components/PrototypeKit'

function uid() {
  return crypto.randomUUID()
}

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', 'wmv', '3gp']
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma']

function fileExt(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function isVideo(att: Attachment) {
  return att.mimeType.startsWith('video') || VIDEO_EXTS.includes(fileExt(att.name))
}

function isAudio(att: Attachment) {
  return att.mimeType.startsWith('audio') || AUDIO_EXTS.includes(fileExt(att.name))
}

function attIcon(att: Attachment) {
  if (att.mimeType.startsWith('image')) return '🖼'
  if (isVideo(att)) return '🎬'
  if (isAudio(att)) return '🎵'
  return '📄'
}

function stageOptions(): { key: CandidateStage; label: string }[] {
  return [
    { key: 'applied', label: 'Applied' },
    { key: 'screening', label: 'Screening' },
    { key: 'interview', label: 'Interview' },
    { key: 'offer', label: 'Offer' },
    { key: 'hired', label: 'Hired' },
    { key: 'rejected', label: 'Rejected' },
  ]
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

function daysSince(date?: string) {
  if (!date) return null
  const diff = Date.now() - new Date(`${date}T12:00:00`).getTime()
  return Math.max(0, Math.round(diff / 86400000))
}

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [checkedTasks, setCheckedTasks] = useState<Set<number>>(new Set())
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: '',
    source: '',
    stage: 'applied' as CandidateStage,
    notes: '',
    resumeUrl: '',
    linkedinUrl: '',
    appliedAt: '',
  })

  useEffect(() => {
    loadCandidates().then(setCandidates)
  }, [id])

  const candidate = candidates.find(item => item.id === id) as Candidate

  useEffect(() => {
    if (!candidate || editing) return
    setForm({
      name: candidate.name || '',
      email: candidate.email || '',
      phone: candidate.phone || '',
      role: candidate.role || '',
      source: candidate.source || '',
      stage: candidate.stage || 'applied',
      notes: candidate.notes || '',
      resumeUrl: candidate.resumeUrl || '',
      linkedinUrl: candidate.linkedinUrl || '',
      appliedAt: candidate.appliedAt || '',
    })
    setAttachments(candidate.attachments || [])
  }, [candidate, editing])

  if (!candidate) {
    return (
      <div className="proto-page">
        <div className="proto-page-body">
          <div className="proto-empty" style={{ padding: 60 }}>Candidate not found.</div>
        </div>
      </div>
    )
  }

  async function persist(next: Candidate[]) {
    const previous = candidates
    setCandidates(next)
    setSaveError(null)
    try {
      await saveCandidates(next)
    } catch (error) {
      setCandidates(previous)
      setSaveError(error instanceof Error ? error.message : 'Candidate could not be saved.')
    }
  }

  function beginEditing() {
    setEditing(true)
    setSaveError(null)
  }

  function cancelEditing() {
    setForm({
      name: candidate.name || '',
      email: candidate.email || '',
      phone: candidate.phone || '',
      role: candidate.role || '',
      source: candidate.source || '',
      stage: candidate.stage || 'applied',
      notes: candidate.notes || '',
      resumeUrl: candidate.resumeUrl || '',
      linkedinUrl: candidate.linkedinUrl || '',
      appliedAt: candidate.appliedAt || '',
    })
    setAttachments(candidate.attachments || [])
    setEditing(false)
    setSaveError(null)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const nextCandidate: Candidate = {
      ...candidate,
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      role: form.role.trim() || undefined,
      source: form.source.trim() || undefined,
      stage: form.stage,
      notes: form.notes.trim() || undefined,
      resumeUrl: form.resumeUrl.trim() || undefined,
      linkedinUrl: form.linkedinUrl.trim() || undefined,
      appliedAt: form.appliedAt || undefined,
      updatedAt: Date.now(),
      attachments,
    }
    await persist(candidates.map(item => item.id === nextCandidate.id ? nextCandidate : item))
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    const next = candidates.filter(item => item.id !== candidate.id)
    await persist(next)
    navigate('/candidates')
  }

  async function moveStage(stage: CandidateStage) {
    const next = { ...candidate, stage, updatedAt: Date.now(), attachments }
    await persist(candidates.map(item => item.id === next.id ? next : item))
    setForm(prev => ({ ...prev, stage }))
  }

  async function downloadAttachment(url: string, name: string) {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const forceBlob = new Blob([blob], { type: 'application/octet-stream' })
      const blobUrl = URL.createObjectURL(forceBlob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
    } catch {
      window.open(url, '_blank')
    }
  }

  function handleFileUpload(file: File) {
    if (file.size > 200 * 1024 * 1024) {
      alert('File too large (max 200 MB).')
      return
    }
    void (async () => {
      try {
        const { storageUrl, storagePath } = await uploadFile(file, `candidates/${candidate.id}`)
        const att: Attachment = {
          id: uid(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: storageUrl,
          storageUrl,
          storagePath,
          uploadedAt: Date.now(),
        }
        setAttachments(prev => {
          const next = [...prev, att]
          void persist(candidates.map(item => item.id === candidate.id ? { ...candidate, attachments: next } : item))
          return next
        })
      } catch (error) {
        console.error(error)
        alert('Upload failed. Please try again.')
      }
    })()
  }

  function removeAttachment(attId: string) {
    const att = attachments.find(item => item.id === attId)
    if (att?.storagePath) void deleteFile(att.storagePath)
    setAttachments(prev => {
      const next = prev.filter(item => item.id !== attId)
      void persist(candidates.map(item => item.id === candidate.id ? { ...candidate, attachments: next } : item))
      return next
    })
  }

  const color = colorFromString(candidate.name)
  const appliedDays = daysSince(candidate.appliedAt)
  const attachmentCount = attachments.length
  const docsCount = attachments.length + (candidate.resumeUrl ? 1 : 0) + (candidate.linkedinUrl ? 1 : 0)

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row" style={{ alignItems: 'flex-start' }}>
          <button type="button" className="proto-back-link" onClick={() => navigate('/candidates')}>
            <ProtoIcon name="chevronL" size={12} />
            All candidates
          </button>
          <div className="proto-profile-head" style={{ width: '100%' }}>
            <div className="proto-profile-row" style={{ width: '100%' }}>
              <Avatar name={candidate.name} color={color} size="lg" />
              <div className="proto-profile-main">
                {editing ? (
                  <input className="proto-input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
                ) : (
                  <div className="proto-profile-title">{candidate.name}</div>
                )}
                <div className="proto-profile-meta">
                  <span>{candidate.role || 'No role set'}</span>
                  {candidate.source ? <span>via {candidate.source}</span> : null}
                  {candidate.appliedAt ? <span>Applied {protoDateShort(candidate.appliedAt)}</span> : null}
                </div>
                <div className="proto-tag-row">
                  <StatusChip status={candidate.stage} filled />
                  {candidate.email ? <span className="proto-tag">{candidate.email}</span> : null}
                  {candidate.phone ? <span className="proto-tag">{candidate.phone}</span> : null}
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
                    Edit Profile
                  </button>
                  <select className="proto-input" style={{ width: 140 }} value={candidate.stage} onChange={e => void moveStage(e.target.value as CandidateStage)}>
                    {stageOptions().map(stage => <option key={stage.key} value={stage.key}>→ {stage.label}</option>)}
                  </select>
                  <button type="button" className="proto-btn proto-btn-danger" onClick={() => setConfirmDelete(true)}>
                    <ProtoIcon name="trash" size={12} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {saveError ? <div className="settings-notice settings-notice-error">{saveError}</div> : null}
      </div>

      <div className="proto-page-body">
        <div className="proto-kpi-grid-4" style={{ marginBottom: 16 }}>
          {[
            { label: 'Stage', value: candidate.stage.toUpperCase(), color: 'var(--accent)' },
            { label: 'Attachments', value: attachmentCount, color: 'var(--blue)' },
            { label: 'Docs', value: docsCount, color: 'var(--emerald)' },
            { label: 'Applied', value: appliedDays != null ? `${appliedDays}d ago` : '—', color: 'var(--gold)' },
          ].map(card => (
            <div key={card.label} className="proto-kpi">
              <div className="proto-kpi-accent" style={{ background: card.color }} />
              <div className="proto-kpi-label">{card.label}</div>
              <div className="proto-kpi-value">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="proto-two-col">
          <div className="proto-sidebar-stack">
            <div className="proto-list-card">
              <div className="proto-list-card-head">
                <span>Candidate Information</span>
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Stage</label>
                {editing ? (
                  <select className="proto-input" value={form.stage} onChange={e => setForm(prev => ({ ...prev, stage: e.target.value as CandidateStage }))}>
                    {stageOptions().map(stage => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                  </select>
                ) : <span className="proto-profile-value"><StatusChip status={candidate.stage} /></span>}
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Role</label>
                {editing ? (
                  <input className="proto-input" value={form.role} onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))} />
                ) : <span className="proto-profile-value">{candidate.role || '—'}</span>}
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Email</label>
                {editing ? (
                  <input className="proto-input" type="email" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} />
                ) : <span className="proto-profile-value">{candidate.email || '—'}</span>}
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Phone</label>
                {editing ? (
                  <input className="proto-input" value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} />
                ) : <span className="proto-profile-value">{candidate.phone || '—'}</span>}
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Source</label>
                {editing ? (
                  <input className="proto-input" value={form.source} onChange={e => setForm(prev => ({ ...prev, source: e.target.value }))} />
                ) : <span className="proto-profile-value">{candidate.source || '—'}</span>}
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Applied date</label>
                {editing ? (
                  <input className="proto-input" type="date" value={form.appliedAt} onChange={e => setForm(prev => ({ ...prev, appliedAt: e.target.value }))} />
                ) : <span className="proto-profile-value">{protoDateShort(candidate.appliedAt)}</span>}
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">Resume URL</label>
                {editing ? (
                  <input className="proto-input" value={form.resumeUrl} onChange={e => setForm(prev => ({ ...prev, resumeUrl: e.target.value }))} />
                ) : <span className="proto-profile-value">{candidate.resumeUrl || '—'}</span>}
              </div>
              <div className="proto-profile-row">
                <label className="proto-profile-label">LinkedIn</label>
                {editing ? (
                  <input className="proto-input" value={form.linkedinUrl} onChange={e => setForm(prev => ({ ...prev, linkedinUrl: e.target.value }))} />
                ) : <span className="proto-profile-value">{candidate.linkedinUrl || '—'}</span>}
              </div>
              <div className="proto-profile-row" style={{ alignItems: 'flex-start' }}>
                <label className="proto-profile-label">Notes</label>
                {editing ? (
                  <textarea className="proto-input" rows={4} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
                ) : (
                  <span className="proto-profile-value" style={{ whiteSpace: 'pre-wrap' }}>{candidate.notes || '—'}</span>
                )}
              </div>
            </div>

            <div className="proto-list-card">
              <div className="proto-list-card-head">
                <span>Attachments</span>
                {editing ? (
                  <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={() => fileInputRef.current?.click()}>
                    <ProtoIcon name="plus" size={12} />
                  </button>
                ) : null}
              </div>
              {editing ? (
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*,video/*,.mp4,.mov,.avi,.webm,.mkv,.m4v,.wmv" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); e.target.value = '' }} />
              ) : null}
              <div style={{ display: 'grid', gap: 8 }}>
                {attachments.length === 0 ? (
                  <div className="proto-empty">No files yet.</div>
                ) : attachments.map(att => (
                  <div key={att.id} className="proto-list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{attIcon(att)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{att.size >= 1024 * 1024 ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : `${(att.size / 1024).toFixed(0)} KB`} · {new Date(att.uploadedAt).toLocaleDateString()}</div>
                      </div>
                      {isAudio(att) ? <audio controls src={att.storageUrl || att.dataUrl} style={{ height: 28, maxWidth: 140 }} /> : null}
                      <button type="button" className="proto-btn proto-btn-ghost" onClick={() => void downloadAttachment(att.storageUrl || att.dataUrl, att.name)}>Download</button>
                      {editing ? (
                        <button type="button" className="proto-btn proto-btn-danger proto-btn-icon" onClick={() => removeAttachment(att.id)}>
                          <ProtoIcon name="close" size={10} />
                        </button>
                      ) : null}
                    </div>
                    {isVideo(att) ? <VideoPlayer url={att.storageUrl || att.dataUrl} /> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="proto-sidebar-stack">
            <div className="proto-list-card">
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
          </div>
        </div>
      </div>

      {confirmDelete ? (
        <Modal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={`Delete ${candidate.name}?`}
          subtitle="This cannot be undone."
          width={420}
          footer={(
            <>
              <button type="button" className="proto-btn proto-btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button type="button" className="proto-btn proto-btn-danger" onClick={() => void handleDelete()}>Delete</button>
            </>
          )}
        >
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Deleting the candidate removes it from the recruiting pipeline.</p>
        </Modal>
      ) : null}
    </div>
  )
}

function VideoPlayer({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])
  async function load() {
    setLoading(true)
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      setBlobUrl(URL.createObjectURL(blob))
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }
  if (blobUrl) return <video controls autoPlay src={blobUrl} style={{ width: '100%', maxHeight: 220, borderRadius: 6, marginTop: 4 }} />
  return (
    <button type="button" onClick={load} disabled={loading} className="proto-btn proto-btn-ghost" style={{ width: '100%' }}>
      {loading ? 'Loading video…' : 'Click to load video'}
    </button>
  )
}
