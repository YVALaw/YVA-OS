import { useEffect, useState } from 'react'
import type { Expense } from '../data/types'
import { loadGeneralExpenses, saveGeneralExpenses } from '../services/storage'
import { formatMoney } from '../utils/money'

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

const CATEGORIES = ['', 'Software', 'Hardware', 'Marketing', 'Office', 'Payroll', 'Legal', 'Accounting', 'Travel', 'Utilities', 'Insurance', 'Other']

export default function GeneralExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  useEffect(() => { loadGeneralExpenses().then(setExpenses) }, [])
  const [form, setForm] = useState({ description: '', amount: '', date: new Date().toISOString().slice(0, 10), category: '', recurring: false })
  const [filterMonth, setFilterMonth] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  function persist(next: Expense[]) { setExpenses(next); void saveGeneralExpenses(next) }

  function addExpense() {
    if (!form.description.trim() || !form.amount) return
    const entry: Expense = {
      id: uid(), projectId: '',
      description: form.description.trim(),
      amount: parseFloat(form.amount) || 0,
      date: form.date,
      category: form.category || undefined,
      recurring: form.recurring || undefined,
      createdAt: Date.now(),
    }
    persist([entry, ...expenses])
    setForm(f => ({ ...f, description: '', amount: '', recurring: false }))
  }

  function doDelete(id: string) { persist(expenses.filter(e => e.id !== id)); setConfirmDelete(null) }

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
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">General Expenses</h1>
          <p className="page-sub">Agency operating costs not tied to any project or client</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-label">All-Time Total</div>
          <div className="kpi-value" style={{ color: '#f87171' }}>{formatMoney(allTotal)}</div>
          <div className="kpi-sub">{expenses.length} entries</div>
        </div>
        {monthlyArr.slice(0, 1).map(([m, amt]) => (
          <div key={m} className="kpi-card">
            <div className="kpi-label">This Month ({m})</div>
            <div className="kpi-value" style={{ color: '#f87171' }}>{formatMoney(amt)}</div>
          </div>
        ))}
        {catArr.slice(0, 1).map(([c, amt]) => (
          <div key={c} className="kpi-card">
            <div className="kpi-label">Top Category</div>
            <div className="kpi-value" style={{ color: 'var(--gold)', fontSize: 18 }}>{c}</div>
            <div className="kpi-sub">{formatMoney(amt)}</div>
          </div>
        ))}
      </div>

      {/* Add expense form */}
      <div className="data-card" style={{ marginBottom: 20 }}>
        <div className="data-card-title">Add Expense</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 3, minWidth: 180 }}>
            <label className="form-label">Description *</label>
            <input className="form-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Zoom subscription, Office supplies..." onKeyDown={e => e.key === 'Enter' && addExpense()} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 110 }}>
            <label className="form-label">Amount ($)</label>
            <input className="form-input" type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 130 }}>
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">Category</label>
            <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c || '— None —'}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ alignSelf: 'flex-end', marginBottom: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={form.recurring} onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))} />
              Recurring
            </label>
          </div>
          <button className="btn-primary btn-sm" style={{ alignSelf: 'flex-end', marginBottom: 2 }}
            onClick={addExpense} disabled={!form.description.trim() || !form.amount}>Add</button>
        </div>
      </div>

      {/* Filters + table */}
      <div className="data-card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="data-card-title" style={{ flex: 1, margin: 0 }}>
            {filtered.length} expense{filtered.length !== 1 ? 's' : ''} · {formatMoney(filteredTotal)}
          </div>
          <select className="form-select" style={{ width: 150, fontSize: 12 }} value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="form-select" style={{ width: 150, fontSize: 12 }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.slice(1).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {(filterMonth || filterCat) && (
            <button className="btn-ghost btn-sm" onClick={() => { setFilterMonth(''); setFilterCat('') }}>Clear</button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 13 }}>
            {expenses.length === 0 ? 'No expenses logged yet. Add your first above.' : 'No expenses match the current filters.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th>Recurring</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(ex => (
                  <tr key={ex.id}>
                    <td className="td-name">{ex.description}</td>
                    <td className="td-muted">{ex.category || '—'}</td>
                    <td className="td-muted">{ex.date}</td>
                    <td className="td-muted">{ex.recurring ? <span style={{ color: '#4ade80', fontSize: 11 }}>● Yes</span> : '—'}</td>
                    <td style={{ textAlign: 'right', color: '#f87171', fontWeight: 700 }}>{formatMoney(ex.amount)}</td>
                    <td>
                      <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '2px 6px' }}
                        onClick={() => setConfirmDelete(ex.id)}>×</button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 8, fontSize: 12, color: 'var(--muted)' }}>
                    {filterMonth || filterCat ? 'Filtered Total' : 'Total'}
                  </td>
                  <td style={{ textAlign: 'right', color: '#f87171', fontWeight: 800 }}>{formatMoney(filteredTotal)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly + category breakdown */}
      {expenses.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div className="data-card">
            <div className="data-card-title">By Month</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Month</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  {monthlyArr.map(([m, amt]) => (
                    <tr key={m}>
                      <td className="td-name">{m}</td>
                      <td style={{ textAlign: 'right', color: '#f87171', fontWeight: 700 }}>{formatMoney(amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="data-card">
            <div className="data-card-title">By Category</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  {catArr.map(([c, amt]) => (
                    <tr key={c}>
                      <td className="td-name">{c}</td>
                      <td style={{ textAlign: 'right', color: '#f87171', fontWeight: 700 }}>{formatMoney(amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete expense?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => doDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
