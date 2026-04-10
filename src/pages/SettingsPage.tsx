import { useEffect, useRef, useState } from 'react'
import type { AppSettings, DataSnapshot } from '../data/types'
import {
  loadCandidates, loadSettings, saveSettings,
  loadSnapshot, loadExpenses, loadGeneralExpenses,
  saveEmployees, saveClients, saveProjects, saveInvoices,
  saveCandidates, saveInvoiceCounter,
  deleteTimesheetImportBatch, loadInvoices, loadTimesheetImportBatches, loadUserRoles, upsertUserRole, type UserRoleRow,
} from '../services/storage'
import { supabase } from '../lib/supabase'
import { initiateGmailAuth, disconnectGmail, isGmailConnected, sendEmail } from '../services/gmail'
import { importTimesheetCsv } from '../services/timesheetAutomation'
import { useRole } from '../context/RoleContext'
import { can, ROLE_LABELS, ROLE_OPTIONS } from '../lib/roles'

type InfoDolarBhdResponse = {
  provider: string
  entity: string
  buy: number
  sell: number
  timestamp?: string
  sourceUrl: string
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getLastBillingWeek(): { start: string; end: string } {
  const today = new Date()
  const currentDay = today.getDay() // 0=Sun
  const daysSinceMonday = (currentDay + 6) % 7
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() - daysSinceMonday)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday)
  lastSunday.setDate(thisMonday.getDate() - 1)
  return { start: isoDate(lastMonday), end: isoDate(lastSunday) }
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

function formatHourOption(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM'
  const normalized = hour % 12 || 12
  return `${normalized}:00 ${period}`
}

function formatMinuteOption(minute: number): string {
  return String(minute).padStart(2, '0')
}

type SettingsTab = 'company' | 'email' | 'integrations' | 'currency' | 'notifications' | 'data' | 'access'

const SHOW_TIMESHEET_IMPORT_UI = false

const ALL_TABS: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
  { id: 'company',       label: 'Company' },
  { id: 'email',         label: 'Email' },
  { id: 'integrations',  label: 'Integrations' },
  { id: 'currency',      label: 'Currency' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'data',          label: 'Data' },
  { id: 'access',        label: 'Team Access', adminOnly: true },
]

export default function SettingsPage() {
  const { role: currentRole, loading: roleLoading } = useRole()
  const TABS = roleLoading ? ALL_TABS.filter(t => !t.adminOnly) : ALL_TABS.filter(t => !t.adminOnly || can.manageRoles(currentRole))
  const fileRef = useRef<HTMLInputElement>(null)
  const [settings, setSettingsState] = useState<AppSettings>({
    usdToDop: 0, companyName: 'YVA Staffing', companyEmail: '', emailSignature: '',
  })
  const [stats, setStats] = useState([
    { label: 'Employees',  count: 0 },
    { label: 'Clients',    count: 0 },
    { label: 'Projects',   count: 0 },
    { label: 'Invoices',   count: 0 },
    { label: 'Candidates', count: 0 },
    { label: 'Expenses',   count: 0 },
  ])
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [timesheetStatus, setTimesheetStatus] = useState<string | null>(null)
  const [timesheetReminderStatus, setTimesheetReminderStatus] = useState<string | null>(null)
  const [testingTimesheetReminder, setTestingTimesheetReminder] = useState(false)
  const [timesheetBatches, setTimesheetBatches] = useState<Awaited<ReturnType<typeof loadTimesheetImportBatches>>>([])
  const [billingWeekStart, setBillingWeekStart] = useState(() => getLastBillingWeek().start)
  const [billingWeekEnd, setBillingWeekEnd] = useState(() => getLastBillingWeek().end)
  const [confirmClear, setConfirmClear] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [fetchingRate, setFetchingRate] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const timesheetFileRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('company')
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState<string | undefined>()
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([])
  const [rateSourceMeta, setRateSourceMeta] = useState<InfoDolarBhdResponse | null>(null)

  useEffect(() => {
    void loadSettings().then(setSettingsState)
    void isGmailConnected().then(setGmailConnected)
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setGmailEmail(user?.user_metadata?.gmailEmail as string | undefined)
    })
  }, [])

  useEffect(() => {
    if (activeTab === 'access' && can.manageRoles(currentRole)) {
      void loadUserRoles().then(setUserRoles)
    }
  }, [activeTab, currentRole])

  useEffect(() => {
    if (activeTab !== 'data') return
    void (async () => {
      const [snap, candidates, expenses, generalExpenses] = await Promise.all([
        loadSnapshot(), loadCandidates(), loadExpenses(), loadGeneralExpenses(),
      ])
      setStats([
        { label: 'Employees',  count: snap.employees.length },
        { label: 'Clients',    count: snap.clients.length },
        { label: 'Projects',   count: snap.projects.length },
        { label: 'Invoices',   count: snap.invoices.length },
        { label: 'Candidates', count: candidates.length },
        { label: 'Expenses',   count: expenses.length + generalExpenses.length },
      ])
      const batches = await loadTimesheetImportBatches(10)
      setTimesheetBatches(batches)
    })()
  }, [activeTab])

  function updateSettings(partial: Partial<AppSettings>) {
    const next = { ...settings, ...partial }
    setSettingsState(next)
    void saveSettings(next)
  }

  async function handleFetchRate() {
    setFetchingRate(true)
    setFetchMsg(null)
    let payload: InfoDolarBhdResponse | null = null
    try {
      const res = await fetch('/.netlify/functions/infodolar-bhd')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFetchingRate(false)
        setFetchMsg(data?.error || 'Could not auto-fetch from InfoDolar BHD.')
        return
      }
      payload = data as InfoDolarBhdResponse
    } catch {
      setFetchingRate(false)
      setFetchMsg('Could not auto-fetch from InfoDolar BHD. Try again or enter the rate manually.')
      return
    }
    setFetchingRate(false)
    if (payload?.sell) {
      updateSettings({ usdToDop: payload.sell })
      setRateSourceMeta(payload)
      setFetchMsg(`Rate updated from ${payload.entity} via ${payload.provider}: RD$${payload.sell} / $1 USD`)
    } else {
      setFetchMsg('Could not auto-fetch from InfoDolar BHD. Try again or enter the rate manually.')
    }
  }

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return
    const perm = await Notification.requestPermission()
    setNotifPerm(perm)
    if (perm === 'granted') {
      checkAndNotify()
    }
  }

  function checkAndNotify() {
    void loadInvoices().then(invoices => {
      const overdue = invoices.filter(i => (i.status || '').toLowerCase() === 'overdue')
      const drafts  = invoices.filter(i => (i.status || '').toLowerCase() === 'draft')
      if (overdue.length > 0) {
        new Notification('YVA OS — Overdue Invoices', {
          body: `${overdue.length} invoice${overdue.length > 1 ? 's are' : ' is'} overdue. Open the Invoices pipeline to review.`,
          icon: '/yva-logo.png',
        })
      }
      if (drafts.length > 0) {
        new Notification('YVA OS — Draft Invoices', {
          body: `${drafts.length} draft invoice${drafts.length > 1 ? 's are' : ' is'} ready to send to clients.`,
          icon: '/yva-logo.png',
        })
      }
      if (overdue.length === 0 && drafts.length === 0) {
        new Notification('YVA OS', { body: 'All clear — no pending actions.', icon: '/yva-logo.png' })
      }
    })
  }

  function handleImport(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as Partial<DataSnapshot & { candidates: unknown[]; invoiceCounter: number }>
        void (async () => {
          let count = 0
          if (Array.isArray(data.employees)) { await saveEmployees(data.employees); count++ }
          if (Array.isArray(data.projects))  { await saveProjects(data.projects);   count++ }
          if (Array.isArray(data.clients))   { await saveClients(data.clients);     count++ }
          if (Array.isArray(data.invoices))  { await saveInvoices(data.invoices);   count++ }
          if (typeof data.invoiceCounter === 'number') { await saveInvoiceCounter(data.invoiceCounter); count++ }
          if (Array.isArray(data.candidates)) { await saveCandidates(data.candidates as Parameters<typeof saveCandidates>[0]); count++ }
          setImportStatus(`Imported ${count} data set${count !== 1 ? 's' : ''} successfully. Reload the page to see changes.`)
        })()
      } catch { setImportStatus('Import failed — invalid JSON file.') }
    }
    reader.readAsText(file)
  }

  function handleTimesheetImport(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const rawCsv = String(e.target?.result || '')
      void (async () => {
        try {
          setTimesheetStatus('Importing Logwork CSV and creating draft invoices...')
          const result = await importTimesheetCsv({
            rawCsv,
            source: 'logwork',
            sourceFilename: file.name,
            billingWeekStart,
            billingWeekEnd,
            rawPayload: {
              source: 'manual-upload',
              fileName: file.name,
            },
          })
          const notifyTo = (settings.timesheetNotifyEmail || settings.companyEmail || '').trim()
          let notifyMsg = ''
          if (notifyTo) {
            try {
              if (await isGmailConnected()) {
                const subject = `Draft invoices ready: ${billingWeekStart} to ${billingWeekEnd}`
                const body = [
                  `The Logwork import ${file.name} completed successfully.`,
                  '',
                  `Draft invoices created: ${result.invoices.length}`,
                  `Timesheet rows processed: ${result.rows.length}`,
                  result.warnings.length ? `Warnings: ${result.warnings.join(' | ')}` : '',
                  '',
                  'Open the Invoices screen to review the new drafts before sending.',
                ].filter(Boolean).join('\n')
                const sendResult = await sendEmail(notifyTo, subject, body)
                notifyMsg = sendResult.mode === 'gmail'
                  ? ' Notification email sent.'
                  : ` Notification email opened in your mail client.`
              } else {
                notifyMsg = ' Notification email skipped because Gmail is not connected.'
              }
            } catch (notifyError) {
              notifyMsg = ` Notification email failed: ${notifyError instanceof Error ? notifyError.message : 'Unknown error'}`
            }
          }
          setTimesheetStatus(
            (result.invoices.length > 0
              ? `Created ${result.invoices.length} draft invoice${result.invoices.length !== 1 ? 's' : ''} from ${result.rows.length} timesheet row${result.rows.length !== 1 ? 's' : ''}.${result.warnings.length ? ` ${result.warnings.join(' | ')}` : ''}`
              : `Imported ${result.rows.length} timesheet row${result.rows.length !== 1 ? 's' : ''}, but no draft invoices were created.${result.warnings.length ? ` ${result.warnings.join(' | ')}` : ''}`) + notifyMsg
          )
          const batches = await loadTimesheetImportBatches(10)
          setTimesheetBatches(batches)
        } catch (error) {
          setTimesheetStatus(`Import failed — ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      })()
    }
    reader.readAsText(file)
  }

  async function handleSendTimesheetReminderTest() {
    setTestingTimesheetReminder(true)
    setTimesheetReminderStatus(null)
    try {
      const res = await fetch('/.netlify/functions/timesheet-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTimesheetReminderStatus(`Test reminder failed — ${data?.error || 'Unknown server error'}`)
      } else {
        setTimesheetReminderStatus(data?.message || 'Test reminder sent.')
        const nextSettings = await loadSettings()
        setSettingsState(nextSettings)
      }
    } catch (error) {
      setTimesheetReminderStatus(`Test reminder failed — ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setTestingTimesheetReminder(false)
    }
  }

  async function handleDeleteTimesheetBatch(batchId: string) {
    const confirmed = window.confirm('Delete this uploaded timesheet batch from history? This removes the stored CSV and import record, but does not delete invoices that were already created.')
    if (!confirmed) return
    try {
      await deleteTimesheetImportBatch(batchId)
      const batches = await loadTimesheetImportBatches(10)
      setTimesheetBatches(batches)
      setTimesheetStatus('Timesheet batch deleted from import history.')
    } catch (error) {
      setTimesheetStatus(`Import cleanup failed — ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  function exportData() {
    void (async () => {
      const [snap, candidates, invoiceCounter] = await Promise.all([
        loadSnapshot(), loadCandidates(),
        supabase.from('counters').select('value').eq('key', 'invoice').single().then(r => (r.data?.value as number) ?? 1),
      ])
      const data = {
        employees: snap.employees,
        clients: snap.clients,
        projects: snap.projects,
        invoices: snap.invoices,
        candidates,
        invoiceCounter,
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `yva-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
    })()
  }

  function doClear() {
    void (async () => {
      // Server-side verification: only CEO may wipe data
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: roleRow } = await supabase.from('user_roles').select('role').eq('user_id', user.id).single()
      if (roleRow?.role !== 'ceo') return

      const tables = ['employees', 'clients', 'projects', 'invoices', 'tasks', 'expenses', 'activity_log', 'candidates', 'invoice_templates']
      await Promise.all(tables.map(t => supabase.from(t).delete().neq('id', '')))
      await supabase.from('counters').update({ value: 1 }).eq('key', 'invoice')
      await supabase.from('counters').update({ value: 1 }).eq('key', 'employee')
      setConfirmClear(false); setCleared(true)
      setTimeout(() => setCleared(false), 4000)
    })()
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">App preferences, integrations &amp; data management</p>
        </div>
        <div className="page-header-right">
          <button
            className="btn-ghost btn-sm"
            style={{ color: '#f87171' }}
            onClick={() => void supabase.auth.signOut()}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="settings-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`settings-tab${activeTab === t.id ? ' settings-tab-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Company ── */}
      {activeTab === 'company' && (
        <div className="settings-section">
          <div className="settings-section-title">Company Info</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Name</div>
              <div className="settings-row-sub">Shown on invoice PDF exports</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              value={settings.companyName || ''}
              onChange={(e) => updateSettings({ companyName: e.target.value })}
              placeholder="YVA Staffing"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Email</div>
              <div className="settings-row-sub">Pre-filled in email drafts &amp; invoices</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              type="email"
              value={settings.companyEmail || ''}
              onChange={(e) => updateSettings({ companyEmail: e.target.value })}
              placeholder="Contact@yvastaffing.net"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Address</div>
              <div className="settings-row-sub">Shown on invoice PDFs</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              value={settings.companyAddress || ''}
              onChange={(e) => updateSettings({ companyAddress: e.target.value })}
              placeholder="Santo Domingo, Dominican Republic"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Phone</div>
              <div className="settings-row-sub">Shown on invoice PDFs</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              value={settings.companyPhone || ''}
              onChange={(e) => updateSettings({ companyPhone: e.target.value })}
              placeholder="+1 (717) 281-8676"
            />
          </div>
          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Email Signature</div>
              <div className="settings-row-sub">Appended to all email invoice drafts</div>
            </div>
            <textarea
              className="form-textarea" rows={3}
              value={settings.emailSignature || ''}
              onChange={(e) => updateSettings({ emailSignature: e.target.value })}
              placeholder="Best regards,&#10;YVA Staffing Team&#10;yvastaffing.net"
            />
          </div>
          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Monthly Revenue Goal</div>
              <div className="settings-row-sub">Shown as a progress bar on the Dashboard</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>$</span>
              <input
                className="form-input" style={{ width: 120 }}
                type="number" min="0" step="100"
                value={settings.monthlyGoal || ''}
                onChange={(e) => updateSettings({ monthlyGoal: parseFloat(e.target.value) || undefined })}
                placeholder="10000"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Email Templates ── */}
      {activeTab === 'email' && (
        <div className="settings-section">
          <div className="settings-section-title">Email Templates</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.7 }}>
            Use{' '}
            {['{clientName}', '{invoiceNumber}', '{amount}', '{period}', '{dueDate}', '{companyName}', '{employeeName}'].map(p => (
              <code key={p} style={{ background: 'rgba(255,255,255,.07)', padding: '1px 6px', borderRadius: 4, marginRight: 4 }}>{p}</code>
            ))}
            {' '}as placeholders.
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Invoice Email</div>
              <div className="settings-row-sub">Sent when emailing an invoice to a client</div>
            </div>
            <textarea
              className="form-textarea" rows={6}
              value={settings.invoiceEmailTemplate || ''}
              onChange={(e) => updateSettings({ invoiceEmailTemplate: e.target.value })}
              placeholder={`Hi {clientName},\n\nPlease find attached invoice {invoiceNumber} for {amount}.\n\nBilling period: {period}\n{dueDate}\nPlease don't hesitate to reach out with any questions.\n\n{companyName}`}
            />
            {settings.invoiceEmailTemplate && (
              <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => updateSettings({ invoiceEmailTemplate: undefined })}>
                Reset to default
              </button>
            )}
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 20 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Employee Statement Email</div>
              <div className="settings-row-sub">Sent from the Statements panel in Team page</div>
            </div>
            <textarea
              className="form-textarea" rows={6}
              value={settings.statementEmailTemplate || ''}
              onChange={(e) => updateSettings({ statementEmailTemplate: e.target.value })}
              placeholder={`Hi {employeeName},\n\nHere is your earnings summary for the period {period}.\n\nTotal Hours: ...\nTotal Earned: ...\n\nPlease reach out if you have any questions.\n\n{companyName}`}
            />
            {settings.statementEmailTemplate && (
              <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => updateSettings({ statementEmailTemplate: undefined })}>
                Reset to default
              </button>
            )}
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 20 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Payment Reminder Email</div>
              <div className="settings-row-sub">Sent via Remind button on overdue/unpaid invoices</div>
            </div>
            <textarea
              className="form-textarea" rows={6}
              value={settings.reminderEmailTemplate || ''}
              onChange={(e) => updateSettings({ reminderEmailTemplate: e.target.value })}
              placeholder={`Hi {clientName},\n\nThis is a friendly reminder that invoice {invoiceNumber} for {amount} is past due.\n\nOriginal due date: {dueDate}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n{companyName}`}
            />
            {settings.reminderEmailTemplate && (
              <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => updateSettings({ reminderEmailTemplate: undefined })}>
                Reset to default
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Integrations ── */}
      {activeTab === 'integrations' && (
        <div className="settings-section">
          <div className="settings-section-title">Gmail</div>

          {gmailConnected ? (
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Connected Account</div>
                <div className="settings-row-sub" style={{ color: '#22c55e' }}>
                  ✓ Emails sent via Gmail as <strong>{gmailEmail}</strong>
                </div>
              </div>
              <button className="btn-ghost btn-sm" style={{ color: '#f87171' }}
                onClick={() => void disconnectGmail().then(() => { setGmailConnected(false); setGmailEmail(undefined) })}>
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Google OAuth Client ID</div>
                  <div className="settings-row-sub">
                    From Google Cloud Console → APIs &amp; Services → Credentials → OAuth 2.0 Client ID (Web application).<br />
                    Authorized Redirect URI:{' '}
                    <code style={{ background: 'rgba(255,255,255,.07)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>{window.location.origin}/oauth-callback</code>
                  </div>
                </div>
                <input
                  className="form-input"
                  style={{ width: 320, fontSize: 12 }}
                  placeholder="123456789-abc123.apps.googleusercontent.com"
                  value={settings.gmailClientId || ''}
                  onChange={e => updateSettings({ gmailClientId: e.target.value })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Connect Gmail</div>
              <div className="settings-row-sub">
                Uses OAuth with PKCE. All emails (invoices, statements, reminders) will be sent directly via your Gmail.
              </div>
            </div>
                <button
                  className="btn-primary btn-sm"
                  disabled={!settings.gmailClientId?.trim()}
                  onClick={() => initiateGmailAuth(settings.gmailClientId!)}
                >
                  Connect Gmail →
                </button>
              </div>
              <div style={{ background: 'rgba(245,181,51,.05)', borderRadius: 8, padding: '12px 16px', marginTop: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--gold)' }}>Setup guide:</strong>{' '}
                Go to <strong>console.cloud.google.com</strong> → New Project → Enable <strong>Gmail API</strong> →
                Create <strong>OAuth 2.0 Client ID</strong> (Web application) → add the redirect URI above →
                paste the Client ID here → add the matching <strong>client secret</strong> in Netlify env var <code style={{ background: 'rgba(255,255,255,.07)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>GMAIL_CLIENT_SECRET</code> → deploy → click Connect.
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Currency ── */}
      {activeTab === 'currency' && (
        <div className="settings-section">
          <div className="settings-section-title">Currency — USD / DOP</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Exchange Rate (USD → DOP)</div>
              <div className="settings-row-sub">
                Auto-fetched from InfoDolar Banco BHD sell rate. Click Auto-fetch or enter manually.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="form-input" style={{ width: 100 }}
                type="number" step="0.01"
                value={settings.usdToDop || ''}
                onChange={(e) => updateSettings({ usdToDop: parseFloat(e.target.value) || 0 })}
                placeholder="59.50"
              />
              <button className="btn-ghost btn-sm" onClick={handleFetchRate} disabled={fetchingRate}>
                {fetchingRate ? 'Fetching…' : 'Auto-fetch'}
              </button>
            </div>
          </div>
          {rateSourceMeta && (
            <div className="settings-row" style={{ alignItems: 'flex-start' }}>
              <div className="settings-row-info">
                <div className="settings-row-label">Latest Source</div>
                <div className="settings-row-sub">
                  {rateSourceMeta.entity} · Compra RD${rateSourceMeta.buy} · Venta RD${rateSourceMeta.sell}
                  {rateSourceMeta.timestamp ? ` · ${rateSourceMeta.timestamp}` : ''}
                </div>
              </div>
              <a className="btn-ghost btn-sm" href={rateSourceMeta.sourceUrl} target="_blank" rel="noreferrer">Open Source</a>
            </div>
          )}
          {fetchMsg && (
            <div className={`settings-notice ${fetchMsg.startsWith('Could') ? 'settings-notice-error' : 'settings-notice-success'}`}>
              {fetchMsg}
            </div>
          )}
          {settings.usdToDop > 0 && (
            <div className="settings-notice settings-notice-success">
              Active rate: $1 USD = RD${settings.usdToDop} · DOP amounts shown on invoice cards
            </div>
          )}
        </div>
      )}

      {/* ── Notifications ── */}
      {activeTab === 'notifications' && (
        <div className="settings-section">
          <div className="settings-section-title">Browser Notifications</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Notifications</div>
              <div className="settings-row-sub">
                {notifPerm === 'granted'
                  ? 'Enabled. Click to send a test check for overdue &amp; draft invoices.'
                  : notifPerm === 'denied'
                  ? 'Blocked by browser — enable in browser site settings.'
                  : 'Allow YVA OS to send reminders for overdue &amp; draft invoices.'}
              </div>
            </div>
            {notifPerm === 'granted' ? (
              <button className="btn-ghost btn-sm" onClick={checkAndNotify}>Check Now</button>
            ) : (
              <button className="btn-primary btn-sm" onClick={requestNotifications} disabled={notifPerm === 'denied'}>
                Enable
              </button>
            )}
          </div>

          {notifPerm === 'granted' && (
            <div className="settings-row" style={{ marginTop: 12 }}>
              <div className="settings-row-info">
                <div className="settings-row-label">Weekly Invoice Reminder</div>
                <div className="settings-row-sub">
                  Automatically checks for unpaid invoices on the selected day when the app is opened.
                </div>
              </div>
              <select
                className="form-select"
                style={{ width: 140 }}
                value={settings.reminderDay ?? ''}
                onChange={e => {
                  const val = e.target.value === '' ? undefined : Number(e.target.value)
                  updateSettings({ reminderDay: val })
                }}
              >
                <option value="">Off</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
                <option value="0">Sunday</option>
              </select>
            </div>
          )}

          <div className="settings-row" style={{ marginTop: 12 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Weekly Draft Reminder Email</div>
              <div className="settings-row-sub">
                Sends you an email on the selected weekly schedule to remind you to draft invoices for the completed billing week.
              </div>
            </div>
            <button
              className={settings.timesheetReminderEnabled ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => updateSettings({ timesheetReminderEnabled: !settings.timesheetReminderEnabled })}
            >
              {settings.timesheetReminderEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Reminder email</div>
              <div className="settings-row-sub">Where the weekly draft reminder should go. Leave blank to use the company email.</div>
            </div>
            <input
              className="form-input"
              style={{ width: 320, fontSize: 12 }}
              type="email"
              placeholder="you@company.com"
              value={settings.timesheetNotifyEmail || ''}
              onChange={e => updateSettings({ timesheetNotifyEmail: e.target.value })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Reminder schedule</div>
              <div className="settings-row-sub">The server checks every 5 minutes and sends the reminder on your selected day and time.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                className="form-select"
                style={{ width: 150 }}
                value={settings.timesheetReminderDay ?? 1}
                onChange={e => updateSettings({ timesheetReminderDay: Number(e.target.value) })}
              >
                {WEEKDAY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ width: 140 }}
                value={settings.timesheetReminderHour ?? 9}
                onChange={e => updateSettings({ timesheetReminderHour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>{formatHourOption(hour)}</option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ width: 90 }}
                value={settings.timesheetReminderMinute ?? 0}
                onChange={e => updateSettings({ timesheetReminderMinute: Number(e.target.value) })}
              >
                {Array.from({ length: 12 }, (_, step) => step * 5).map(minute => (
                  <option key={minute} value={minute}>:{formatMinuteOption(minute)}</option>
                ))}
              </select>
              <button className="btn-ghost btn-sm" onClick={handleSendTimesheetReminderTest} disabled={testingTimesheetReminder}>
                {testingTimesheetReminder ? 'Sending...' : 'Send Test'}
              </button>
            </div>
          </div>

          {settings.timesheetReminderLastSentAt && (
            <div className="settings-row-sub" style={{ marginTop: 8 }}>
              Last reminder sent: {new Date(settings.timesheetReminderLastSentAt).toLocaleString()}
            </div>
          )}
          {timesheetReminderStatus && (
            <div className={`settings-notice ${timesheetReminderStatus.startsWith('Test reminder failed') ? 'settings-notice-error' : 'settings-notice-success'}`} style={{ marginTop: 12 }}>
              {timesheetReminderStatus}
            </div>
          )}
        </div>
      )}

      {/* ── Data ── */}
        {activeTab === 'data' && (
          <>
            <div className="settings-section">
              <div className="settings-section-title">Data Overview</div>
            <div className="settings-stats-grid">
              {stats.map((s) => (
                <div key={s.label} className="settings-stat-card">
                  <div className="settings-stat-count">{s.count}</div>
                  <div className="settings-stat-label">{s.label}</div>
                </div>
              ))}
            </div>
            </div>

            {SHOW_TIMESHEET_IMPORT_UI && (
            <div className="settings-section">
              <div className="settings-section-title">Timesheet Import</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Import tracking enabled</div>
                  <div className="settings-row-sub">Store raw Logwork CSV files, dedupe imports, and create draft invoices by project.</div>
                </div>
                <button
                  className={settings.timesheetAutomationEnabled ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                  onClick={() => updateSettings({ timesheetAutomationEnabled: !settings.timesheetAutomationEnabled })}
                >
                  {settings.timesheetAutomationEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Manual import reminder</div>
                  <div className="settings-row-sub">Emails you only when the last completed Monday-Sunday billing week still has not been imported.</div>
                </div>
                <button
                  className={settings.timesheetReminderEnabled ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                  onClick={() => updateSettings({ timesheetReminderEnabled: !settings.timesheetReminderEnabled })}
                >
                  {settings.timesheetReminderEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Notification email</div>
                  <div className="settings-row-sub">Where draft-ready notices should go. Leave blank to use the company email.</div>
                </div>
                <input
                  className="form-input"
                  style={{ width: 320, fontSize: 12 }}
                  type="email"
                  placeholder="you@company.com"
                  value={settings.timesheetNotifyEmail || ''}
                  onChange={e => updateSettings({ timesheetNotifyEmail: e.target.value })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Reminder schedule</div>
                  <div className="settings-row-sub">The server checks every 5 minutes and sends the reminder on your selected day and time.</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    className="form-select"
                    style={{ width: 150 }}
                    value={settings.timesheetReminderDay ?? 1}
                    onChange={e => updateSettings({ timesheetReminderDay: Number(e.target.value) })}
                  >
                    {WEEKDAY_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select
                    className="form-select"
                    style={{ width: 140 }}
                    value={settings.timesheetReminderHour ?? 9}
                    onChange={e => updateSettings({ timesheetReminderHour: Number(e.target.value) })}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>{formatHourOption(hour)}</option>
                    ))}
                  </select>
                  <select
                    className="form-select"
                    style={{ width: 90 }}
                    value={settings.timesheetReminderMinute ?? 0}
                    onChange={e => updateSettings({ timesheetReminderMinute: Number(e.target.value) })}
                  >
                    {Array.from({ length: 12 }, (_, step) => step * 5).map(minute => (
                      <option key={minute} value={minute}>:{formatMinuteOption(minute)}</option>
                    ))}
                  </select>
                  <button className="btn-ghost btn-sm" onClick={handleSendTimesheetReminderTest} disabled={testingTimesheetReminder}>
                    {testingTimesheetReminder ? 'Sending...' : 'Send Test'}
                  </button>
                </div>
              </div>
              {settings.timesheetReminderLastSentAt && (
                <div className="settings-row-sub" style={{ marginTop: 8 }}>
                  Last reminder sent: {new Date(settings.timesheetReminderLastSentAt).toLocaleString()}
                </div>
              )}
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Billing week</div>
                  <div className="settings-row-sub">The invoice period is always Monday to Sunday for the selected timesheet batch.</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    className="form-input"
                    style={{ width: 140, fontSize: 12 }}
                    type="date"
                    value={billingWeekStart}
                    onChange={e => setBillingWeekStart(e.target.value)}
                  />
                  <input
                    className="form-input"
                    style={{ width: 140, fontSize: 12 }}
                    type="date"
                    value={billingWeekEnd}
                    onChange={e => setBillingWeekEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Import Logwork CSV</div>
                  <div className="settings-row-sub">Creates draft invoices only. You review and send them from the invoice screen later.</div>
                </div>
                <button className="btn-primary btn-sm" onClick={() => timesheetFileRef.current?.click()}>Choose CSV</button>
                <input
                  ref={timesheetFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleTimesheetImport(file)
                    e.target.value = ''
                  }}
                />
              </div>
              <div className="settings-row-sub" style={{ marginTop: 8 }}>
                Export the Logwork CSV manually, upload it here, and review the draft invoices before sending.
              </div>
              {timesheetReminderStatus && (
                <div className={`settings-notice ${timesheetReminderStatus.startsWith('Test reminder failed') ? 'settings-notice-error' : 'settings-notice-success'}`} style={{ marginTop: 12 }}>
                  {timesheetReminderStatus}
                </div>
              )}
              {timesheetStatus && (
                <div className={`settings-notice ${timesheetStatus.startsWith('Import failed') ? 'settings-notice-error' : 'settings-notice-success'}`} style={{ marginTop: 12 }}>
                  {timesheetStatus}
                </div>
              )}
              {timesheetBatches.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="settings-row-label" style={{ marginBottom: 10 }}>Recent imports</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {timesheetBatches.map(batch => (
                      <div key={batch.id} className="settings-row" style={{ alignItems: 'flex-start' }}>
                        <div className="settings-row-info">
                          <div className="settings-row-label">{batch.sourceFilename || 'Logwork CSV'}</div>
                          <div className="settings-row-sub">
                            {batch.billingWeekStart} to {batch.billingWeekEnd} · {batch.status} · {batch.rowCount} rows · {batch.invoiceCount} draft{batch.invoiceCount === 1 ? '' : 's'}
                          </div>
                          {batch.errorMessage && <div className="settings-row-sub" style={{ color: '#f59e0b' }}>{batch.errorMessage}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => {
                              const blob = new Blob([batch.rawCsv], { type: 'text/csv;charset=utf-8' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = batch.sourceFilename || `timesheet-${batch.billingWeekStart}.csv`
                              a.click()
                              URL.revokeObjectURL(url)
                            }}
                          >
                            Download CSV
                          </button>
                          <button
                            className="btn-ghost btn-sm"
                            style={{ color: '#f87171' }}
                            onClick={() => void handleDeleteTimesheetBatch(batch.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            <div className="settings-section">
              <div className="settings-section-title">Backup &amp; Restore</div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Export all data</div>
                <div className="settings-row-sub">Download a full JSON backup you can re-import at any time.</div>
              </div>
              <button className="btn-primary btn-sm" onClick={exportData}>Export JSON</button>
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Restore from backup</div>
                <div className="settings-row-sub">Import a previously exported file. Existing data will be overwritten.</div>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>Choose File</button>
              <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = '' }} />
            </div>
            {importStatus && (
              <div className={`settings-notice ${importStatus.startsWith('Import failed') ? 'settings-notice-error' : 'settings-notice-success'}`}>
                {importStatus}
              </div>
            )}
          </div>

          <div className="settings-section settings-section-danger">
            <div className="settings-section-title">Danger Zone</div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Clear all data</div>
                <div className="settings-row-sub">Permanently deletes everything from this browser. Export first.</div>
              </div>
              <button className="btn-danger btn-sm" onClick={() => setConfirmClear(true)}>Clear All</button>
            </div>
            {cleared && <div className="settings-notice settings-notice-success">All data cleared. Reload the page.</div>}
          </div>
        </>
      )}

      {/* ── Team Access ── */}
      {activeTab === 'access' && can.manageRoles(currentRole) && (
        <div className="settings-section">
          <div className="settings-section-title">Team Access</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            Manage what each user can see. New users default to Recruiter until assigned a role.
          </div>
          {userRoles.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '16px 0' }}>No users found. Users appear here after they first log in.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {userRoles.map(u => (
                    <tr key={u.user_id}>
                      <td className="td-name">{u.email || '—'}</td>
                      <td>
                        <select
                          className="form-select"
                          style={{ width: 160, fontSize: 12 }}
                          value={u.role}
                          onChange={async e => {
                            const newRole = e.target.value
                            await upsertUserRole(u.user_id, u.email, newRole)
                            setUserRoles(prev => prev.map(r => r.user_id === u.user_id ? { ...r, role: newRole } : r))
                          }}
                        >
                          {ROLE_OPTIONS.map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className="badge badge-blue" style={{ fontSize: 10 }}>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmClear && (
        <div className="modal-overlay" onClick={() => setConfirmClear(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Clear all data?</div>
            <div className="confirm-body">This will permanently delete all employees, clients, projects, invoices, and candidates from the database. This cannot be undone. Export a backup first.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="btn-danger" onClick={doClear}>Yes, clear everything</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
