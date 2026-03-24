import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, Client, Employee, Invoice, InvoiceItem, InvoiceTemplate, Project } from '../data/types'
import {
  loadInvoiceCounter, loadInvoices, loadSettings,
  loadSnapshot, saveInvoiceCounter, saveInvoices,
  loadProjects, saveProjects,
  loadInvoiceTemplates, saveInvoiceTemplates,
} from '../services/storage'

function projectPrefix(name: string): string {
  return name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 5)
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  if (!start || !end) return dates
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end   + 'T12:00:00')
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return dates
  const cur = new Date(s)
  while (cur <= e && dates.length < 31) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

function dateLabel(d: string): string {
  const dt = new Date(d + 'T12:00:00')
  const day = ['Su','Mo','Tu','We','Th','Fr','Sa'][dt.getDay()]
  return `${day}\n${dt.getMonth() + 1}/${dt.getDate()}`
}

/** Parse hours from various formats: "8", "8.5", "8,5", "8:30" → decimal */
function parseHours(val: string): number {
  if (!val) return 0
  const v = val.trim().replace(',', '.')
  if (v.includes(':')) {
    const [h, m] = v.split(':')
    return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60
  }
  return parseFloat(v) || 0
}

type BuilderRow = {
  _id: string
  employeeName: string
  position: string
  rate: string
  hoursManual: string       // used when no date range
  daily: Record<string, string>
}

function rowHours(row: BuilderRow, dates: string[]): number {
  if (dates.length > 0) {
    return dates.reduce((s, d) => s + parseHours(row.daily[d] || ''), 0)
  }
  return parseHours(row.hoursManual)
}

function rowAmount(row: BuilderRow, dates: string[]): number {
  return rowHours(row, dates) * (parseFloat(row.rate) || 0)
}

function emptyRow(): BuilderRow {
  return { _id: uid(), employeeName: '', position: '', rate: '', hoursManual: '', daily: {} }
}

type Props = {
  onCreated: (inv: Invoice) => void
  onCancel: () => void
  initialProjectId?: string
  editInvoice?: Invoice
}

export default function InvoiceBuilder({ onCreated, onCancel, initialProjectId, editInvoice }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [settings,  setSettings]  = useState<AppSettings>({ usdToDop: 0, companyName: '', companyEmail: '', emailSignature: '' })

  useEffect(() => {
    void loadSnapshot().then(snap => {
      setEmployees(snap.employees)
      setClients(snap.clients)
      setProjects(snap.projects)
    })
    void loadInvoiceTemplates().then(setTemplates)
    void loadSettings().then(setSettings)
  }, [])

  const [clientId,     setClientId]     = useState('')
  const [projectId,    setProjectId]    = useState(initialProjectId || '')

  // Once projects load, auto-set clientId from initialProjectId
  useEffect(() => {
    if (initialProjectId && projects.length > 0 && !clientId) {
      const proj = projects.find(p => p.id === initialProjectId)
      if (proj?.clientId) setClientId(proj.clientId)
    }
  }, [projects])

  // Populate all fields when editing an existing invoice
  const editLoaded = useRef(false)
  useEffect(() => {
    if (!editInvoice || editLoaded.current || clients.length === 0) return
    editLoaded.current = true
    setDate(editInvoice.date || new Date().toISOString().slice(0, 10))
    setDueDate(editInvoice.dueDate || '')
    setBillingStart(editInvoice.billingStart || '')
    setBillingEnd(editInvoice.billingEnd || '')
    setNotes(editInvoice.notes || '')
    if (editInvoice.projectId) setProjectId(editInvoice.projectId)
    const client = clients.find(c => c.name === editInvoice.clientName)
    if (client) setClientId(client.id)
    if (editInvoice.items && editInvoice.items.length > 0) {
      setRows(editInvoice.items.map(it => ({
        _id: uid(),
        employeeName: it.employeeName,
        position: it.position || '',
        rate: String(it.rate),
        hoursManual: String(it.hoursTotal),
        daily: it.daily ? { ...it.daily } : {},
      })))
    }
  }, [clients.length, editInvoice])
  const [date,         setDate]         = useState(new Date().toISOString().slice(0, 10))
  const [dueDate,      setDueDate]      = useState('')

  function handleClientChange(newClientId: string) {
    setClientId(newClientId)
    // Auto-select first project linked to this client
    const clientProjects = projects.filter(p => p.clientId === newClientId)
    setProjectId(clientProjects.length > 0 ? clientProjects[0].id : '')
    // Auto-fill due date from payment terms (e.g. "Net 30" → +30 days)
    if (!dueDate) {
      const client = clients.find(c => c.id === newClientId)
      const match = (client?.paymentTerms || '').match(/(\d+)/)
      if (match) {
        const d = new Date()
        d.setDate(d.getDate() + parseInt(match[1]))
        setDueDate(d.toISOString().slice(0, 10))
      }
    }
  }
  const [billingStart, setBillingStart] = useState('')
  const [billingEnd,   setBillingEnd]   = useState('')
  const [notes,        setNotes]        = useState('')
  const [rows,         setRows]         = useState<BuilderRow[]>([emptyRow()])
  const [saving,       setSaving]       = useState(false)
  const [saveTemplateModal, setSaveTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [loadTemplateModal, setLoadTemplateModal] = useState(false)

  const dates = useMemo(() => generateDateRange(billingStart, billingEnd), [billingStart, billingEnd])

  const selectedClient  = clients.find(c => c.id === clientId)
  const selectedProject = projects.find(p => p.id === projectId)

  const grandTotal = rows.reduce((s, r) => s + rowAmount(r, dates), 0)

  function updateRow(id: string, patch: Partial<BuilderRow>) {
    setRows(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r))
  }

  function updateDaily(rowId: string, date: string, val: string) {
    setRows(prev => prev.map(r => r._id === rowId ? { ...r, daily: { ...r.daily, [date]: val } } : r))
  }

  function handleEmpSelect(rowId: string, name: string) {
    const emp = employees.find(e => e.name === name)
    updateRow(rowId, {
      employeeName: name,
      rate: emp?.payRate != null ? String(emp.payRate) : '',
    })
  }

  function addRow() { setRows(prev => [...prev, emptyRow()]) }
  function removeRow(id: string) { setRows(prev => prev.filter(r => r._id !== id)) }

  function loadTemplate(t: InvoiceTemplate) {
    setClientId(t.clientId ?? '')
    setProjectId(t.projectId ?? '')
    setBillingStart(t.billingStart ?? '')
    setBillingEnd(t.billingEnd ?? '')
    setNotes(t.notes ?? '')
    setRows(t.rows.map(r => ({ ...r, _id: uid() })))
    setLoadTemplateModal(false)
  }

  function saveTemplate() {
    if (!templateName.trim()) return
    const t: InvoiceTemplate = {
      id: uid(),
      name: templateName.trim(),
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      billingStart: billingStart || undefined,
      billingEnd: billingEnd || undefined,
      notes: notes || undefined,
      rows: rows.map(({ _id: _, ...rest }) => rest),
      createdAt: Date.now(),
    }
    const next = [t, ...templates]
    void saveInvoiceTemplates(next)
    setTemplates(next)
    setTemplateName('')
    setSaveTemplateModal(false)
    alert(`Template "${t.name}" saved!`)
  }

  function deleteTemplate(id: string) {
    const next = templates.filter(t => t.id !== id)
    void saveInvoiceTemplates(next)
    setTemplates(next)
  }

  function createInvoice() {
    if (!selectedClient && !rows.some(r => r.employeeName)) return
    setSaving(true)
    void (async () => {
      const items: InvoiceItem[] = rows
        .filter(r => r.employeeName.trim())
        .map(r => ({
          employeeName: r.employeeName,
          position:     r.position || undefined,
          hoursTotal:   rowHours(r, dates),
          rate:         parseFloat(r.rate) || 0,
          daily:        dates.length > 0 ? { ...r.daily } : undefined,
        }))

      if (editInvoice) {
        // Update existing invoice
        const inv: Invoice = {
          ...editInvoice,
          date,
          dueDate:       dueDate || undefined,
          clientName:    selectedClient?.name    || editInvoice.clientName || '',
          clientEmail:   selectedClient?.email   || editInvoice.clientEmail || '',
          clientAddress: selectedClient?.address || editInvoice.clientAddress || '',
          billingStart:  billingStart || undefined,
          billingEnd:    billingEnd   || undefined,
          projectId:     selectedProject?.id   ?? editInvoice.projectId ?? null,
          projectName:   selectedProject?.name ?? editInvoice.projectName ?? '',
          subtotal:      grandTotal,
          notes:         notes || undefined,
          items,
          updatedAt:     Date.now(),
        }
        const existing = await loadInvoices()
        await saveInvoices(existing.map(i => i.id === inv.id ? inv : i))
        setSaving(false)
        onCreated(inv)
        return
      }

      // Create new invoice
      let invNumber: string
      if (selectedProject) {
        const allProjects = await loadProjects()
        const projIdx = allProjects.findIndex(p => p.id === selectedProject.id)
        const proj = projIdx >= 0 ? allProjects[projIdx] : selectedProject
        const seq = (proj.nextInvoiceSeq ?? 1)
        const prefix = projectPrefix(selectedProject.name)
        invNumber = `${prefix}${String(seq).padStart(4, '0')}`
        if (projIdx >= 0) {
          allProjects[projIdx] = { ...proj, nextInvoiceSeq: seq + 1 }
          void saveProjects(allProjects)
        }
      } else {
        const counter = await loadInvoiceCounter()
        invNumber = `INV-${String(counter).padStart(3, '0')}`
        void saveInvoiceCounter(counter + 1)
      }

      const inv: Invoice = {
        id:            uid(),
        number:        invNumber,
        date,
        dueDate:       dueDate || undefined,
        clientName:    selectedClient?.name    || '',
        clientEmail:   selectedClient?.email   || '',
        clientAddress: selectedClient?.address || '',
        billingStart:  billingStart || undefined,
        billingEnd:    billingEnd   || undefined,
        projectId:     selectedProject?.id   || null,
        projectName:   selectedProject?.name || '',
        status:        'draft',
        subtotal:      grandTotal,
        notes:         notes || undefined,
        items,
        createdAt:     Date.now(),
        updatedAt:     Date.now(),
      }

      const existing = await loadInvoices()
      await saveInvoices([inv, ...existing])
      setSaving(false)
      onCreated(inv)
    })()
  }

  const dopStr = settings.usdToDop > 0
    ? ` · RD$${(grandTotal * settings.usdToDop).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : ''

  return (
    <div className="invoice-builder">

      {/* ── Template bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
        {templates.length > 0 && (
          <button className="btn-ghost btn-sm" onClick={() => setLoadTemplateModal(true)}>Load Template</button>
        )}
        <button className="btn-ghost btn-sm" onClick={() => setSaveTemplateModal(true)}>Save as Template</button>
      </div>

      {/* ── Header Info ── */}
      <div className="builder-section">
        <div className="builder-section-title">Invoice Details</div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">Client *</label>
            <select className="form-select" value={clientId} onChange={e => handleClientChange(e.target.value)}>
              <option value="">— Select client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Project</label>
            <select className="form-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">— No project —</option>
              {projects
                .filter(p => !clientId || p.clientId === clientId)
                .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Invoice Date</label>
            <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>

        {/* From / Bill To preview */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div style={{ background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>From</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--soft)' }}>{settings.companyName || 'YVA Staffing'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{settings.companyAddress || 'Santo Domingo, Dominican Republic'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{settings.companyEmail || 'Contact@yvastaffing.net'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{settings.companyPhone || '+1 (717) 281-8676'}</div>
          </div>
          <div style={{ background: 'var(--surf2)', border: `1px solid ${selectedClient ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Bill To</div>
            {selectedClient ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--soft)' }}>{selectedClient.name}</div>
                {selectedClient.email   && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{selectedClient.email}</div>}
                {selectedClient.address && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{selectedClient.address}</div>}
                {selectedProject && (
                  <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4 }}>
                    Next #: {projectPrefix(selectedProject.name)}{String(selectedProject.nextInvoiceSeq ?? 1).padStart(4, '0')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Select a client above</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Billing Period ── */}
      <div className="builder-section">
        <div className="builder-section-title">Billing Period <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(optional — enables daily hours grid)</span></div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">From</label>
            <input className="form-input" type="date" value={billingStart} onChange={e => setBillingStart(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">To</label>
            <input className="form-input" type="date" value={billingEnd} onChange={e => setBillingEnd(e.target.value)} />
          </div>
        </div>
        {billingStart && billingEnd && dates.length === 0 && (
          <div className="settings-notice settings-notice-error" style={{ marginTop: 8 }}>Invalid date range.</div>
        )}
        {dates.length > 0 && (
          <div className="settings-notice settings-notice-success" style={{ marginTop: 8 }}>
            {dates.length}-day billing period · Enter hours per day in the grid below. (Formats: 8, 8.5, 8:30)
          </div>
        )}
      </div>

      {/* ── Line Items ── */}
      <div className="builder-section">
        <div className="builder-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Services / Team Members</span>
          <button className="btn-ghost btn-xs" onClick={addRow}>+ Add Row</button>
        </div>

        {/* Daily grid mode */}
        {dates.length > 0 ? (
          <div className="builder-daily-wrap">
            <table className="builder-daily-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>Employee</th>
                  <th style={{ minWidth: 120 }}>Position</th>
                  <th style={{ minWidth: 72 }}>Rate/hr</th>
                  {dates.map(d => (
                    <th key={d} style={{ minWidth: 46, whiteSpace: 'pre-line', textAlign: 'center', fontSize: 10, padding: '4px 2px' }}>
                      {dateLabel(d)}
                    </th>
                  ))}
                  <th style={{ minWidth: 64, textAlign: 'right' }}>Hours</th>
                  <th style={{ minWidth: 90, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 28 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const hrs = rowHours(row, dates)
                  const amt = rowAmount(row, dates)
                  return (
                    <tr key={row._id}>
                      <td>
                        <select
                          className="form-select"
                          style={{ fontSize: 12, padding: '5px 8px' }}
                          value={row.employeeName}
                          onChange={e => handleEmpSelect(row._id, e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          className="form-input"
                          style={{ fontSize: 12, padding: '5px 8px' }}
                          value={row.position}
                          onChange={e => updateRow(row._id, { position: e.target.value })}
                          placeholder="Role..."
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          style={{ fontSize: 12, padding: '5px 8px', width: 64 }}
                          type="number"
                          value={row.rate}
                          onChange={e => updateRow(row._id, { rate: e.target.value })}
                          placeholder="0"
                        />
                      </td>
                      {dates.map(d => (
                        <td key={d} style={{ padding: '2px 1px' }}>
                          <input
                            className="daily-cell"
                            type="text"
                            inputMode="decimal"
                            value={row.daily[d] || ''}
                            onChange={e => updateDaily(row._id, d, e.target.value)}
                            placeholder="—"
                          />
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, paddingRight: 8 }}>
                        {hrs > 0 ? hrs.toFixed(1) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--gold)', fontSize: 13, paddingRight: 8 }}>
                        {amt > 0 ? `$${amt.toFixed(2)}` : '—'}
                      </td>
                      <td>
                        {rows.length > 1 && (
                          <button className="btn-icon btn-danger" style={{ fontSize: 12, padding: '3px 6px' }} onClick={() => removeRow(row._id)}>×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Simple total hours mode */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(row => {
              const hrs = rowHours(row, dates)
              const amt = rowAmount(row, dates)
              return (
                <div key={row._id} className="builder-simple-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    {rows.indexOf(row) === 0 && <label className="form-label">Employee</label>}
                    <select className="form-select" value={row.employeeName} onChange={e => handleEmpSelect(row._id, e.target.value)}>
                      <option value="">— Select employee —</option>
                      {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 2 }}>
                    {rows.indexOf(row) === 0 && <label className="form-label">Position</label>}
                    <input className="form-input" value={row.position} onChange={e => updateRow(row._id, { position: e.target.value })} placeholder="Role / position" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    {rows.indexOf(row) === 0 && <label className="form-label">Rate/hr</label>}
                    <input className="form-input" type="number" value={row.rate} onChange={e => updateRow(row._id, { rate: e.target.value })} placeholder="0" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    {rows.indexOf(row) === 0 && <label className="form-label">Total Hrs</label>}
                    <input className="form-input" type="text" inputMode="decimal" value={row.hoursManual} onChange={e => updateRow(row._id, { hoursManual: e.target.value })} placeholder="0" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    {rows.indexOf(row) === 0 && <label className="form-label">Amount</label>}
                    <div className="builder-amount-display">{amt > 0 ? `$${amt.toFixed(2)}` : '—'}</div>
                  </div>
                  <div style={{ alignSelf: 'flex-end', paddingBottom: 2 }}>
                    {rows.length > 1 && (
                      <button className="btn-icon btn-danger btn-xs" onClick={() => removeRow(row._id)}>×</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      <div className="builder-section">
        <div className="builder-section-title">Notes / Message to Client</div>
        <textarea
          className="form-textarea"
          rows={3}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Payment instructions, thank you note, or any additional info..."
        />
      </div>

      {/* ── Grand Total ── */}
      <div className="builder-total-bar">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 }}>Total Due</div>
          <div className="builder-total-amount">${grandTotal.toFixed(2)}</div>
          {dopStr && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{dopStr}</div>}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary"
          onClick={createInvoice}
          disabled={saving || grandTotal === 0 || !clientId}
        >
          {saving ? 'Saving…' : (editInvoice ? 'Update Invoice' : 'Create Invoice')}
        </button>
      </div>

      {/* ── Save Template Modal ── */}
      {saveTemplateModal && (
        <div className="modal-overlay" onClick={() => setSaveTemplateModal(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Save as Template</h2>
              <button className="modal-close btn-icon" onClick={() => setSaveTemplateModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Template Name *</label>
                <input className="form-input" value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Standard Law Assist Invoice" autoFocus />
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                Saves current client, project, billing period, notes, and all employee rows (without daily hours).
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setSaveTemplateModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveTemplate} disabled={!templateName.trim()}>Save Template</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Load Template Modal ── */}
      {loadTemplateModal && (
        <div className="modal-overlay" onClick={() => setLoadTemplateModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Load Template</h2>
              <button className="modal-close btn-icon" onClick={() => setLoadTemplateModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              {templates.length === 0 ? (
                <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No templates saved yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {templates.map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.rows.length} employee{t.rows.length !== 1 ? 's' : ''} · {new Date(t.createdAt).toLocaleDateString()}</div>
                      </div>
                      <button className="btn-ghost btn-sm" onClick={() => loadTemplate(t)}>Load</button>
                      <button className="btn-icon btn-danger" style={{ fontSize: 12, padding: '3px 6px' }} onClick={() => deleteTemplate(t.id)}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setLoadTemplateModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
