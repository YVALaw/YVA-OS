import { useEffect, useState } from 'react'
import type { Expense } from '../data/types'
import { loadGeneralExpenses, saveGeneralExpenses } from '../services/storage'
import { formatMoney } from '../utils/money'

function uid() { return crypto.randomUUID() }

const CATEGORIES = ['', 'Software', 'Hardware', 'Marketing', 'Office', 'Payroll', 'Legal', 'Accounting', 'Travel', 'Utilities', 'Insurance', 'Other']

export default function GeneralExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  useEffect(() => { loadGeneralExpenses().then(setExpenses) }, [])
  const [form, setForm] = useState({ description: '', amount: '', date: new Date().toISOString().slice(0, 10), category: '', recurring: false })
  const [filterMonth, setFilterMonth] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function persist(next: Expense[]) {
    const previous = expenses
    setExpenses(next)
    try {
      await saveGeneralExpenses(next)
    } catch (error) {
      setExpenses(previous)
      alert(error instanceof Error ? error.message : 'Expense could not be saved.')
    }
  }

  function addExpense() {
    if (!form.description.trim() || !form.amount) return
    const entry: Expense = {
      id: uid(),
      projectId: '',
      description: form.description.trim(),
      amount: parseFloat(form.amount) || 0,
      date: form.date,
      category: form.category || undefined,
      recurring: form.recurring || undefined,
      recurrenceAnchorDate: form.recurring ? form.date : undefined,
      recurrenceIntervalMonths: form.recurring ? 1 : undefined,
      createdAt: Date.now(),
    }
    persist([entry, ...expenses])
    setForm(f => ({ ...f, description: '', amount: '', recurring: false }))
  }

  function doDelete(id: string) {
    const target = expenses.find(expense => expense.id === id)
    if (!target) {
      setConfirmDelete(null)
      return
    }
    const next = target.recurring && !target.recurrenceSourceId
      ? expenses.filter(expense => expense.id !== id && expense.recurrenceSourceId !== id)
      : expenses.filter(expense => expense.id !== id)
    persist(next)
    setConfirmDelete(null)
  }

  const filtered = expenses.filter(e => {
    if (filterMonth && !e.date.startsWith(filterMonth)) return false
    if (filterCat && e.category !== filterCat) return false
    return true
  })

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0)
  const allTotal      = expenses.reduce((s, e) => s + e.amount, 0)

  // Monthly totals for summary
  const monthlyMap = new Map<string, number>()
  for (const e of expenses) {
    const m = e.date.slice(0, 7)
    monthlyMap.set(m, (monthlyMap.get(m) || 0) + e.amount)
  }
  const monthlyArr = Array.from(monthlyMap.entries()).sort(([a],[b]) => b.localeCompare(a)).slice(0, 6)

  // Category totals
  const catMap = new Map<string, number>()
  for (const e of expenses) {
    const c = e.category || 'Uncategorized'
    catMap.set(c, (catMap.get(c) || 0) + e.amount)
  }
  const catArr = Array.from(catMap.entries()).sort(([,a],[,b]) => b - a)

  // Available months for filter
  const months = Array.from(new Set(expenses.map(e => e.date.slice(0, 7)))).sort((a, b) => b.localeCompare(a))

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row">
          <div>
            <div className="proto-eyebrow" style={{ color: 'var(--gold)', marginBottom: 8 }}>Finance · Expenses</div>
            <h1 className="page-title">Expenses</h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>{filtered.length} entries · {formatMoney(filteredTotal)} visible spend</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="proto-btn proto-btn-primary" onClick={addExpense} disabled={!form.description.trim() || !form.amount}>ADD EXPENSE</button>
          </div>
        </div>
      </div>

      <div className="proto-page-body">
        <div className="proto-kpi-grid-4" style={{ marginBottom: 14 }}>
          {[
            { label: 'All-time total', value: formatMoney(allTotal), sub: `${expenses.length} entries`, color: '#f87171' },
            { label: 'Filtered total', value: formatMoney(filteredTotal), sub: filterMonth || filterCat ? 'Current filters' : 'All records', color: '#22d3ee' },
            { label: 'Top category', value: catArr[0]?.[0] || '—', sub: catArr[0] ? formatMoney(catArr[0][1]) : 'No data', color: '#f5b533' },
            { label: 'Latest month', value: monthlyArr[0]?.[0] || '—', sub: monthlyArr[0] ? formatMoney(monthlyArr[0][1]) : 'No data', color: '#60a5fa' },
          ].map(metric => (
            <div key={metric.label} className="proto-kpi">
              <div className="proto-kpi-accent" style={{ background: metric.color }} />
              <div className="proto-kpi-label">{metric.label}</div>
              <div className="proto-kpi-value" style={{ marginTop: 8, fontSize: typeof metric.value === 'string' && metric.value.length > 10 ? 20 : 26 }}>{metric.value}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>{metric.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="proto-section-title" style={{ marginBottom: 12 }}>Add Expense</div>
            <div className="form-grid-2">
              <div className="form-group form-group-full">
                <label className="form-label">Description</label>
                <input className="form-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Zoom subscription, office supplies…" />
              </div>
              <div className="form-group">
                <label className="form-label">Amount ($)</label>
                <input className="form-input" type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(category => <option key={category} value={category}>{category || '— None —'}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
                  <input type="checkbox" checked={form.recurring} onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))} />
                  Recurring
                </label>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div className="proto-section-title" style={{ marginBottom: 12 }}>Filters</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <select className="form-select" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                <option value="">All months</option>
                {months.map(month => <option key={month} value={month}>{month}</option>)}
              </select>
              <select className="form-select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.slice(1).map(category => <option key={category} value={category}>{category}</option>)}
              </select>
              {(filterMonth || filterCat) ? <button type="button" className="proto-btn" onClick={() => { setFilterMonth(''); setFilterCat('') }}>Clear Filters</button> : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14, marginTop: 14 }}>
          <div className="card proto-list-card">
            <div className="proto-list-card-head">
              <div className="proto-section-title">Entries</div>
              <div className="proto-mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{filtered.length} visible</div>
            </div>
            {filtered.length === 0 ? (
              <div className="proto-empty">{expenses.length === 0 ? 'No expenses logged yet.' : 'No expenses match the current filters.'}</div>
            ) : (
              <table className="proto-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Date</th>
                    <th>Recurring</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(expense => (
                    <tr key={expense.id}>
                      <td style={{ fontWeight: 700, color: 'var(--text)' }}>{expense.description}</td>
                      <td style={{ color: 'var(--muted)' }}>{expense.category || '—'}</td>
                      <td className="proto-mono" style={{ color: 'var(--muted)' }}>{expense.date}</td>
                      <td style={{ color: 'var(--muted)' }}>{expense.recurring ? 'Yes' : '—'}</td>
                      <td className="proto-mono" style={{ textAlign: 'right', color: '#f87171', fontWeight: 700 }}>{formatMoney(expense.amount)}</td>
                      <td style={{ textAlign: 'right' }}><button type="button" className="proto-btn proto-btn-danger" style={{ height: 28 }} onClick={() => setConfirmDelete(expense.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="proto-sidebar-stack">
            <div className="card" style={{ padding: 18 }}>
              <div className="proto-section-title" style={{ marginBottom: 12 }}>By Category</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {catArr.map(([category, amount]) => {
                  const pct = allTotal > 0 ? amount / allTotal : 0
                  return (
                    <div key={category}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--text-soft)', fontWeight: 700 }}>{category}</span>
                        <span className="proto-mono" style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 700 }}>{formatMoney(amount)}</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--surf2)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--gold)' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div className="proto-section-title" style={{ marginBottom: 12 }}>By Month</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {monthlyArr.map(([month, amount]) => (
                  <div key={month} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--text)' }}>{month}</span>
                    <span className="proto-mono" style={{ color: '#f87171', fontWeight: 700 }}>{formatMoney(amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="proto-modal-scrim" onClick={() => setConfirmDelete(null)}>
          <div className="proto-modal-panel" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <div className="proto-modal-head">
              <div>
                <div className="proto-modal-title">Delete expense?</div>
                <div className="proto-modal-subtitle">This removes the selected operating expense entry.</div>
              </div>
            </div>
            <div className="proto-modal-foot">
              <button className="proto-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="proto-btn proto-btn-danger" onClick={() => doDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
