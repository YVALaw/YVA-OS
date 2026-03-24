import { useEffect, useMemo, useState } from 'react'
import { getAllDataSnapshot } from '../services/dataSnapshot'
import {
  computeReports,
  getCurrentMonthRange,
  getCurrentQuarterRange,
  type DateRange,
} from '../services/reportsService'
import { formatMoney, fmtHoursHM } from '../utils/money'
import { loadSettings, loadGeneralExpenses } from '../services/storage'
import type { AppSettings, DataSnapshot, Expense, Invoice } from '../data/types'

function downloadCSV(filename: string, rows: string[][]): void {
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = rows.map(r => r.map(escape).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function isoThisMonth(): { from: string; to: string } {
  const r = getCurrentMonthRange()
  return { from: r.from, to: r.to }
}
function isoThisYear(): { from: string; to: string } {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

type Preset = 'month' | 'quarter' | 'custom'

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function clampToIso(v: string): string { return (v || '').slice(0, 10) }

function getLast6Months(): { label: string; bucket: string }[] {
  const result = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const bucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleString('en-US', { month: 'short' })
    result.push({ label, bucket })
  }
  return result
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="bar-chart-container">
      <div className="bar-chart">
        {data.map((d) => (
          <div key={d.label} className="bar-col">
            {d.value > 0 && (
              <div className="bar-value">${d.value >= 1000 ? `${(d.value / 1000).toFixed(1)}k` : d.value}</div>
            )}
            <div
              className={`bar-fill${d.value === 0 ? ' bar-fill-zero' : ''}`}
              style={{ height: `${(d.value / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="bar-chart-baseline" />
      <div style={{ display: 'flex', gap: 0 }}>
        {data.map((d) => (
          <div key={d.label} className="bar-label" style={{ flex: 1 }}>{d.label}</div>
        ))}
      </div>
    </div>
  )
}

// ── Invoice history filter state ───────────────────────────
function filterInvoices(
  invoices: Invoice[],
  opts: { client: string; project: string; status: string; from: string; to: string },
): Invoice[] {
  return invoices.filter(inv => {
    if (opts.client && !(inv.clientName || '').toLowerCase().includes(opts.client.toLowerCase())) return false
    if (opts.project && inv.projectName !== opts.project) return false
    if (opts.status && (inv.status || 'draft') !== opts.status) return false
    const d = inv.date || inv.billingEnd || inv.billingStart || ''
    if (opts.from && d < opts.from) return false
    if (opts.to   && d > opts.to)   return false
    return true
  })
}

export default function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('month')
  const [from, setFrom] = useState<string>(getCurrentMonthRange().from)
  const [to, setTo]     = useState<string>(getCurrentMonthRange().to)

  // Invoice history filters
  const [hClient,  setHClient]  = useState('')
  const [hProject, setHProject] = useState('')
  const [hStatus,  setHStatus]  = useState('')
  const [hFrom,    setHFrom]    = useState('')
  const [hTo,      setHTo]      = useState('')

  useEffect(() => {
    if (preset === 'month')   { const r = getCurrentMonthRange();   setFrom(r.from); setTo(r.to) }
    if (preset === 'quarter') { const r = getCurrentQuarterRange(); setFrom(r.from); setTo(r.to) }
  }, [preset])

  const range: DateRange = useMemo(
    () => ({ from: clampToIso(from) || isoToday(), to: clampToIso(to) || isoToday() }),
    [from, to],
  )

  const [settings, setSettings] = useState<AppSettings>({ usdToDop: 0, companyName: 'YVA Staffing', companyEmail: '', emailSignature: '' })
  const [store, setStore] = useState<DataSnapshot>({ employees: [], clients: [], projects: [], invoices: [], invoiceCounter: 1 })
  const [generalExpenses, setGeneralExpenses] = useState<Expense[]>([])

  useEffect(() => {
    void loadSettings().then(setSettings)
    void getAllDataSnapshot().then(setStore)
    void loadGeneralExpenses().then(setGeneralExpenses)
  }, [])

  const computed = useMemo(() => computeReports(store, range), [store, range])
  const topClient = computed.byClient.length ? computed.byClient[0] : null

  // Build bar chart data (last 6 months from ALL invoices, not filtered range)
  const chartData = useMemo(() => {
    const months = getLast6Months()
    const totals: Record<string, number> = {}
    for (const inv of store.invoices) {
      const d = inv.date || inv.billingEnd || inv.billingStart
      if (!d) continue
      const bucket = d.slice(0, 7)
      totals[bucket] = (totals[bucket] || 0) + (Number(inv.subtotal) || 0)
    }
    return months.map(m => ({ label: m.label, value: totals[m.bucket] || 0 }))
  }, [store])

  // Overdue + unpaid attention items
  const overdueInvoices = store.invoices.filter(inv => (inv.status || '').toLowerCase() === 'overdue')
  const draftInvoices   = store.invoices.filter(inv => (inv.status || '').toLowerCase() === 'draft')

  // Employee anniversary alerts — employees hitting a milestone this year (1, 2, 3, 5, 10+ years)
  const anniversaries = useMemo(() => {
    const thisYear = new Date().getFullYear()
    const milestones = new Set([1, 2, 3, 5, 10, 15, 20])
    return store.employees
      .filter(emp => {
        const startYearNum = Number(emp.startYear)
        if (!startYearNum || startYearNum >= thisYear) return false
        const years = thisYear - startYearNum
        return milestones.has(years)
      })
      .map(emp => ({ name: emp.name, years: thisYear - Number(emp.startYear) }))
  }, [store])

  // Contract renewal warnings (within 60 days)
  const expiringContracts = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const in60 = new Date(today); in60.setDate(in60.getDate() + 60)
    return store.clients.filter(c => {
      if (!c.contractEnd) return false
      const d = new Date(c.contractEnd)
      return d >= today && d <= in60
    }).sort((a, b) => new Date(a.contractEnd!).getTime() - new Date(b.contractEnd!).getTime())
  }, [store])

  return (
    <div className="page-wrap">
      {/* Date range controls */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Revenue overview &amp; insights</p>
        </div>
        <div className="page-header-actions">
          <div className="form-group" style={{ margin: 0 }}>
            <select className="form-select" style={{ width: 140 }} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="month">This month</option>
              <option value="quarter">This quarter</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <input className="form-input" type="date" value={from} onChange={(e) => { setPreset('custom'); setFrom(e.target.value) }} />
          <input className="form-input" type="date" value={to} onChange={(e) => { setPreset('custom'); setTo(e.target.value) }} />
        </div>
      </div>

      {/* Monthly revenue goal progress bar */}
      {settings.monthlyGoal && settings.monthlyGoal > 0 && preset === 'month' && (
        <div className="data-card" style={{ marginBottom: 0, padding: '14px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>Monthly Goal</div>
            <div style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>
              {formatMoney(computed.totalBilled)} / {formatMoney(settings.monthlyGoal)}
              <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
                ({Math.round(Math.min((computed.totalBilled / settings.monthlyGoal) * 100, 100))}%)
              </span>
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,.07)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min((computed.totalBilled / settings.monthlyGoal) * 100, 100)}%`,
              background: computed.totalBilled >= settings.monthlyGoal ? '#4ade80' : 'var(--gold)',
              borderRadius: 6,
              transition: 'width .4s ease',
            }} />
          </div>
          {computed.totalBilled >= settings.monthlyGoal && (
            <div style={{ fontSize: 12, color: '#4ade80', marginTop: 6 }}>Goal reached!</div>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total Billed</div>
          <div className="kpi-value">{formatMoney(computed.totalBilled)}</div>
          <div className="kpi-sub">{computed.invoiceCount} invoice{computed.invoiceCount === 1 ? '' : 's'} in range</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Hours</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmtHoursHM(computed.totalHours)}</div>
          <div className="kpi-sub">billed in range</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Est. Payroll</div>
          <div className="kpi-value" style={{ color: '#f87171' }}>{formatMoney(computed.totalPayroll)}</div>
          <div className="kpi-sub">based on employee pay rates</div>
        </div>
        {(() => {
          const rangeExpenses = generalExpenses.filter(e => {
            if (!e.date) return true
            if (from && e.date < from) return false
            if (to && e.date > to) return false
            return true
          })
          const totalExpenses = rangeExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
          const netAfterExpenses = computed.totalNetEarnings - totalExpenses
          return (<>
            <div className="kpi-card">
              <div className="kpi-label">Business Expenses</div>
              <div className="kpi-value" style={{ color: '#fb923c' }}>{formatMoney(totalExpenses)}</div>
              <div className="kpi-sub">{rangeExpenses.length} expense{rangeExpenses.length !== 1 ? 's' : ''} in range</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Net Earnings</div>
              <div className="kpi-value" style={{ color: netAfterExpenses >= 0 ? '#4ade80' : '#f87171' }}>
                {formatMoney(netAfterExpenses)}
              </div>
              <div className="kpi-sub">billed − payroll − expenses</div>
            </div>
          </>)
        })()}
        <div className="kpi-card">
          <div className="kpi-label">Paid</div>
          <div className="kpi-value" style={{ color: '#4ade80' }}>{computed.paidCount}</div>
          <div className="kpi-sub">invoices marked paid</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Unpaid</div>
          <div className="kpi-value kpi-value-warn">{computed.unpaidCount}</div>
          <div className="kpi-sub">awaiting payment</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Top Client</div>
          <div className="kpi-value kpi-value-name">{topClient?.name || '—'}</div>
          <div className="kpi-sub">{topClient ? formatMoney(topClient.total) : 'No data'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Clients</div>
          <div className="kpi-value" style={{ color: '#60a5fa' }}>{store.clients.length}</div>
          <div className="kpi-sub">total in system</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Team</div>
          <div className="kpi-value" style={{ color: '#c084fc' }}>{store.employees.length}</div>
          <div className="kpi-sub">active members</div>
        </div>
      </div>

      {/* Revenue chart + attention */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
        <div className="data-card">
          <div className="data-card-title">Revenue — Last 6 Months</div>
          <BarChart data={chartData} />
        </div>

        <div className="data-card">
          <div className="data-card-title">Needs Attention</div>
          <div className="attention-list">
            {overdueInvoices.length > 0 && (
              <div className="attention-item">
                <div className="attention-item-dot" />
                <div className="attention-item-body">
                  <div className="attention-item-title">{overdueInvoices.length} Overdue Invoice{overdueInvoices.length > 1 ? 's' : ''}</div>
                  <div className="attention-item-sub">Update status in Invoices → Pipeline</div>
                </div>
              </div>
            )}
            {draftInvoices.length > 0 && (
              <div className="attention-item">
                <div className="attention-item-dot attention-item-dot-warn" />
                <div className="attention-item-body">
                  <div className="attention-item-title">{draftInvoices.length} Draft Invoice{draftInvoices.length > 1 ? 's' : ''}</div>
                  <div className="attention-item-sub">Ready to send to clients</div>
                </div>
              </div>
            )}
            {computed.unpaidCount > 0 && (
              <div className="attention-item">
                <div className="attention-item-dot attention-item-dot-warn" />
                <div className="attention-item-body">
                  <div className="attention-item-title">{computed.unpaidCount} Unpaid in Range</div>
                  <div className="attention-item-sub">{formatMoney(computed.totalBilled - (computed.paidCount > 0 ? computed.totalBilled * (computed.paidCount / computed.invoiceCount) : 0))} outstanding</div>
                </div>
              </div>
            )}
            {expiringContracts.map(c => {
              const daysLeft = Math.ceil((new Date(c.contractEnd!).getTime() - Date.now()) / 86400000)
              return (
                <div key={c.id} className="attention-item">
                  <div className="attention-item-dot" style={{ background: daysLeft <= 14 ? '#ef4444' : '#f97316' }} />
                  <div className="attention-item-body">
                    <div className="attention-item-title">Contract Expiring — {c.name}</div>
                    <div className="attention-item-sub">{daysLeft === 0 ? 'Expires today' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left (${c.contractEnd})`}</div>
                  </div>
                </div>
              )
            })}
            {anniversaries.map(a => (
              <div key={a.name} className="attention-item">
                <div className="attention-item-dot" style={{ background: '#a855f7' }} />
                <div className="attention-item-body">
                  <div className="attention-item-title">{a.name} — {a.years} Year{a.years !== 1 ? 's' : ''} Anniversary</div>
                  <div className="attention-item-sub">Celebrating {a.years} year{a.years !== 1 ? 's' : ''} with YVA Staffing in {new Date().getFullYear()}</div>
                </div>
              </div>
            ))}
            {overdueInvoices.length === 0 && draftInvoices.length === 0 && computed.unpaidCount === 0 && expiringContracts.length === 0 && anniversaries.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0', textAlign: 'center' }}>
                All clear — nothing needs attention
              </div>
            )}
          </div>
        </div>
      </div>

      {/* By client + by project */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="data-card">
          <div className="data-card-title">Revenue by Client</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Client</th><th>Invoices</th><th>Total</th><th>Share</th></tr></thead>
              <tbody>
                {computed.byClient.slice(0, 8).map((r) => (
                  <tr key={r.name}>
                    <td className="td-name">{r.name}</td>
                    <td className="td-muted">{r.invoiceCount}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(r.total)}</td>
                    <td className="td-muted">{Math.round(r.share * 100)}%</td>
                  </tr>
                ))}
                {computed.byClient.length === 0 && (
                  <tr><td colSpan={4} className="td-empty">No invoices in range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="data-card">
          <div className="data-card-title">Revenue by Project</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Project</th><th>Hrs</th><th>Total</th></tr></thead>
              <tbody>
                {computed.byProject.slice(0, 8).map((r) => (
                  <tr key={r.name}>
                    <td className="td-name">{r.name}</td>
                    <td className="td-muted">{r.hoursBilled.toFixed(1)}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(r.total)}</td>
                  </tr>
                ))}
                {computed.byProject.length === 0 && (
                  <tr><td colSpan={3} className="td-empty">No invoices in range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Employee Performance */}
      {computed.employeePerformance.length > 0 && (
        <div className="data-card">
          <div className="data-card-title">Employee Performance — In Range</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Hours</th>
                  <th>Billed</th>
                  <th>Payroll Cost</th>
                  <th>Margin</th>
                  <th>Invoices</th>
                </tr>
              </thead>
              <tbody>
                {computed.employeePerformance.map((e) => (
                  <tr key={e.name}>
                    <td className="td-name">{e.name}</td>
                    <td className="td-muted">{fmtHoursHM(e.hours)}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(e.billed)}</td>
                    <td style={{ color: '#f87171' }}>{e.payroll > 0 ? formatMoney(e.payroll) : <span className="td-muted">—</span>}</td>
                    <td style={{ color: e.margin >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                      {e.payroll > 0 ? formatMoney(e.margin) : <span className="td-muted">—</span>}
                    </td>
                    <td className="td-muted">{e.invoiceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All-time: Client analytics */}
      {computed.allTimeByClient.length > 0 && (
        <div className="data-card">
          <div className="data-card-title">Client Analytics — All Time</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Client</th><th>Projects</th><th>Invoices</th><th>Total Billed</th><th>Last Invoice</th></tr>
              </thead>
              <tbody>
                {computed.allTimeByClient.map((c) => (
                  <tr key={c.name}>
                    <td className="td-name">{c.name}</td>
                    <td className="td-muted">{c.projectCount}</td>
                    <td className="td-muted">{c.invoiceCount}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(c.total)}</td>
                    <td className="td-muted">{c.lastDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All-time: Project analytics */}
      {computed.allTimeByProject.length > 0 && (
        <div className="data-card">
          <div className="data-card-title">Project Analytics — All Time</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Project</th><th>Client</th><th>Invoices</th><th>Total Billed</th><th>Hours</th><th>Last Invoice</th></tr>
              </thead>
              <tbody>
                {computed.allTimeByProject.map((p) => (
                  <tr key={p.name}>
                    <td className="td-name">{p.name}</td>
                    <td className="td-muted">{p.client || '—'}</td>
                    <td className="td-muted">{p.invoiceCount}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(p.total)}</td>
                    <td className="td-muted">{fmtHoursHM(p.hours)}</td>
                    <td className="td-muted">{p.lastDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insights */}
      {computed.insights.length > 0 && (
        <div className="data-card">
          <div className="data-card-title">Insights</div>
          <ul className="insights-list">
            {computed.insights.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}

      {/* ── AR Aging ── */}
      {(() => {
        const today = new Date(); today.setHours(0,0,0,0)
        const unpaid = store.invoices.filter(inv => {
          const s = (inv.status || '').toLowerCase()
          return s !== 'paid' && s !== 'draft'
        })
        const buckets = [
          { label: '0–30 days',  min: 0,  max: 30,  color: '#f5b533', invoices: [] as typeof unpaid },
          { label: '31–60 days', min: 31, max: 60,  color: '#f97316', invoices: [] as typeof unpaid },
          { label: '61–90 days', min: 61, max: 90,  color: '#ef4444', invoices: [] as typeof unpaid },
          { label: '90+ days',   min: 91, max: 9999, color: '#7f1d1d', invoices: [] as typeof unpaid },
        ]
        for (const inv of unpaid) {
          const ref = inv.dueDate || inv.date || inv.billingEnd || ''
          if (!ref) continue
          const d = new Date(ref); d.setHours(0,0,0,0)
          const age = Math.floor((today.getTime() - d.getTime()) / 86400000)
          const bucket = buckets.find(b => age >= b.min && age <= b.max)
          if (bucket) bucket.invoices.push(inv)
        }
        const hasAging = buckets.some(b => b.invoices.length > 0)
        if (!hasAging) return null
        return (
          <div className="data-card">
            <div className="data-card-title">Accounts Receivable Aging</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              {buckets.map(b => (
                <div key={b.label} style={{ background: 'var(--surf2)', borderRadius: 12, padding: '14px 16px', borderTop: `2px solid ${b.color}` }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{b.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: b.color }}>{formatMoney(b.invoices.reduce((s,i) => s+(Number(i.subtotal)||0),0))}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{b.invoices.length} invoice{b.invoices.length!==1?'s':''}</div>
                </div>
              ))}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Invoice #</th><th>Client</th><th>Date</th><th>Due</th><th>Status</th><th style={{textAlign:'right'}}>Balance</th></tr></thead>
                <tbody>
                  {unpaid.sort((a,b) => (a.dueDate||a.date||'') < (b.dueDate||b.date||'') ? -1 : 1).map(inv => {
                    const ref = inv.dueDate || inv.date || ''; const d = new Date(ref); d.setHours(0,0,0,0)
                    const age = ref ? Math.floor((today.getTime()-d.getTime())/86400000) : 0
                    const balance = (Number(inv.subtotal)||0) - (Number(inv.amountPaid)||0)
                    const ageColor = age > 90 ? '#7f1d1d' : age > 60 ? '#ef4444' : age > 30 ? '#f97316' : '#f5b533'
                    return (
                      <tr key={inv.id}>
                        <td className="td-name">{inv.number}</td>
                        <td>{inv.clientName||'—'}</td>
                        <td className="td-muted">{inv.date||'—'}</td>
                        <td className="td-muted">{inv.dueDate||'—'}</td>
                        <td><span style={{fontSize:11,fontWeight:600,color:ageColor}}>{age>0?`${age}d overdue`:'Current'}</span></td>
                        <td style={{textAlign:'right',color:'var(--gold)',fontWeight:700}}>{formatMoney(balance)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* ── Revenue Forecasting + Client Retention ── */}
      {(() => {
        // Last 3 months average revenue
        const now = new Date()
        const monthTotals: number[] = []
        for (let i = 3; i >= 1; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const bucket = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
          const total = store.invoices
            .filter(inv => (inv.date || inv.billingEnd || '').startsWith(bucket))
            .reduce((s,inv) => s+(Number(inv.subtotal)||0), 0)
          monthTotals.push(total)
        }
        const avgRevenue = monthTotals.reduce((s,v)=>s+v,0) / 3
        const activeProjects = store.projects.filter(p => (p.status||'').toLowerCase() === 'active').length

        // Client retention — not invoiced in 60+ days
        const todayStr = now.toISOString().slice(0,10)
        const atRisk = store.clients.filter(c => {
          if ((c.status||'').toLowerCase() === 'churned') return false
          const lastInv = store.invoices
            .filter(inv => inv.clientName === c.name)
            .map(inv => inv.date || inv.billingEnd || '')
            .filter(Boolean)
            .sort()
            .pop()
          if (!lastInv) return false
          const daysSince = Math.floor((new Date(todayStr).getTime() - new Date(lastInv).getTime()) / 86400000)
          return daysSince >= 60
        })

        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="data-card">
              <div className="data-card-title">Revenue Forecast</div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>3-Month Average</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--gold)' }}>{formatMoney(avgRevenue)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>per month based on last 3 months</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                {monthTotals.map((v, i) => {
                  const d = new Date(now.getFullYear(), now.getMonth() - (3-i), 1)
                  const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--muted)' }}>{label}</span>
                      <span style={{ fontWeight: 700 }}>{formatMoney(v)}</span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0' }}>
                  <span style={{ color: 'var(--muted)' }}>Active projects</span>
                  <span style={{ fontWeight: 700, color: '#60a5fa' }}>{activeProjects}</span>
                </div>
              </div>
            </div>

            <div className="data-card">
              <div className="data-card-title">Client Retention Watch</div>
              {atRisk.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>
                  All active clients invoiced within 60 days.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: '#f97316', marginBottom: 12 }}>
                    {atRisk.length} client{atRisk.length!==1?'s':''} not invoiced in 60+ days
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Client</th><th>Status</th><th>Last Invoice</th></tr></thead>
                      <tbody>
                        {atRisk.map(c => {
                          const lastInv = store.invoices
                            .filter(inv => inv.clientName === c.name)
                            .map(inv => inv.date || inv.billingEnd || '')
                            .filter(Boolean).sort().pop() || '—'
                          const days = lastInv !== '—'
                            ? Math.floor((new Date(todayStr).getTime()-new Date(lastInv).getTime())/86400000)
                            : null
                          return (
                            <tr key={c.id}>
                              <td className="td-name">{c.name}</td>
                              <td><span style={{fontSize:11,textTransform:'capitalize',color:'var(--muted)'}}>{c.status||'active'}</span></td>
                              <td style={{color:'#f97316',fontSize:12}}>{lastInv}{days!==null?` (${days}d ago)`:''}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Invoice History ── */}
      {(() => {
        const allProjects = [...new Set(store.invoices.map(i => i.projectName || '').filter(Boolean))]
        const histFiltered = filterInvoices(store.invoices, { client: hClient, project: hProject, status: hStatus, from: hFrom, to: hTo })
        const histTotal    = histFiltered.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)

        function exportHistCSV() {
          const headers = ['Invoice #', 'Date', 'Due Date', 'Client', 'Project', 'Status', 'Amount (USD)', 'Hours']
          const rows = histFiltered.map(inv => [
            inv.number || '',
            inv.date || '',
            inv.dueDate || '',
            inv.clientName || '',
            inv.projectName || '',
            inv.status || '',
            String(Number(inv.subtotal) || 0),
            String((inv.items || []).reduce((s, it) => s + (Number(it.hoursTotal) || 0), 0)),
          ])
          downloadCSV('invoice-history.csv', [headers, ...rows])
        }

        function exportPayrollCSV() {
          const dopRate = settings.usdToDop || 0
          const headers = ['Employee', 'Hours', 'Pay Rate (USD)', 'Amount (USD)', 'Amount (DOP)', 'Invoice #', 'Date']
          const rowsOut: string[][] = []
          for (const inv of histFiltered) {
            for (const item of (inv.items || [])) {
              const emp = store.employees.find(e => e.name.toLowerCase() === item.employeeName.toLowerCase())
              const payRate = Number(emp?.payRate) || 0
              const hrs = Number(item.hoursTotal) || 0
              const usd = hrs * payRate
              const dop = dopRate > 0 ? String((usd * dopRate).toFixed(0)) : ''
              rowsOut.push([item.employeeName, String(hrs), String(payRate), String(usd.toFixed(2)), dop, inv.number || '', inv.date || ''])
            }
          }
          downloadCSV('payroll-export.csv', [headers, ...rowsOut])
        }

        return (
          <div className="data-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="data-card-title" style={{ margin: 0 }}>Invoice History</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-ghost btn-sm" onClick={() => { setHFrom(isoThisMonth().from); setHTo(isoThisMonth().to) }}>This Month</button>
                <button className="btn-ghost btn-sm" onClick={() => { setHFrom(isoThisYear().from); setHTo(isoThisYear().to) }}>This Year</button>
                <button className="btn-ghost btn-sm" onClick={() => { setHFrom(''); setHTo(''); setHClient(''); setHProject(''); setHStatus('') }}>Clear</button>
                <button className="btn-ghost btn-sm" onClick={exportHistCSV}>Export CSV</button>
                <button className="btn-ghost btn-sm" onClick={exportPayrollCSV}>Payroll CSV</button>
              </div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
              <input
                className="form-input" style={{ width: 160, fontSize: 12 }}
                placeholder="Search client..."
                value={hClient} onChange={e => setHClient(e.target.value)}
              />
              <select
                className="form-select" style={{ width: 160, fontSize: 12 }}
                value={hProject} onChange={e => setHProject(e.target.value)}
              >
                <option value="">All projects</option>
                {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select
                className="form-select" style={{ width: 130, fontSize: 12 }}
                value={hStatus} onChange={e => setHStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="viewed">Viewed</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
              <input className="form-input" type="date" style={{ width: 140, fontSize: 12 }} value={hFrom} onChange={e => setHFrom(e.target.value)} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>–</span>
              <input className="form-input" type="date" style={{ width: 140, fontSize: 12 }} value={hTo} onChange={e => setHTo(e.target.value)} />
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
                {histFiltered.length} invoice{histFiltered.length !== 1 ? 's' : ''} · <strong style={{ color: 'var(--gold)' }}>{formatMoney(histTotal)}</strong>
              </span>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Due Date</th>
                    <th>Client</th>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Hours</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {histFiltered.slice(0, 200).map(inv => {
                    const hrs = (inv.items || []).reduce((s, it) => s + (Number(it.hoursTotal) || 0), 0)
                    const statusBadge2: Record<string, string> = {
                      paid: '#22c55e', overdue: '#ef4444', sent: '#3b82f6', viewed: '#a855f7',
                    }
                    const sc = statusBadge2[(inv.status || '').toLowerCase()] || '#64748b'
                    return (
                      <tr key={inv.id}>
                        <td className="td-name">{inv.number}</td>
                        <td className="td-muted">{inv.date || '—'}</td>
                        <td className="td-muted">{inv.dueDate || '—'}</td>
                        <td>{inv.clientName || '—'}</td>
                        <td className="td-muted">{inv.projectName || '—'}</td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, color: sc, textTransform: 'capitalize' }}>
                            {inv.status || 'draft'}
                          </span>
                        </td>
                        <td className="td-muted">{hrs > 0 ? fmtHoursHM(hrs) : '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{formatMoney(Number(inv.subtotal) || 0)}</td>
                      </tr>
                    )
                  })}
                  {histFiltered.length === 0 && (
                    <tr><td colSpan={8} className="td-empty">No invoices match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
