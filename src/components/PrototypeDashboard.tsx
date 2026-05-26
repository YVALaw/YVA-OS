import { useMemo, useState } from 'react'
import type { Candidate, DataSnapshot, Expense, Invoice } from '../data/types'
import { invoiceItemHours } from '../utils/invoiceHours'
import { payrollFromInvoiceItem } from '../utils/payroll'
import {
  Avatar,
  BarChart,
  Modal,
  ProtoIcon,
  Sparkline,
  StatusChip,
  ToggleGroup,
  colorFromString,
  daysFromToday,
  dueLabel,
  protoCurrency,
  protoDate,
} from './PrototypeKit'

type Props = {
  store: DataSnapshot
  candidates: Candidate[]
  generalExpenses: Expense[]
  onNavigate: (path: string) => void
  onExport: () => void
}

type RangeValue = 'today' | 'week' | 'month' | 'quarter' | 'year'
type KpiModalKey = 'billed' | 'net' | 'hours' | 'outstanding' | 'pipeline'
type AttentionModalKey = 'unpaid' | 'overdue' | 'payroll' | 'drafts' | 'clients' | 'hiring'

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function startOfRange(range: RangeValue, now: Date): string {
  const start = new Date(now)
  if (range === 'today') return dateKey(start)
  if (range === 'week') {
    const daysSinceMonday = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - daysSinceMonday)
    return dateKey(start)
  }
  if (range === 'month') {
    start.setDate(1)
    return dateKey(start)
  }
  if (range === 'quarter') {
    start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1)
    return dateKey(start)
  }
  start.setMonth(0, 1)
  return dateKey(start)
}

function rangeLabel(range: RangeValue): string {
  if (range === 'today') return 'TODAY'
  if (range === 'week') return 'WTD'
  if (range === 'month') return 'MTD'
  if (range === 'quarter') return 'QTD'
  return 'YTD'
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getInvoiceDate(invoice: Invoice): string {
  return invoice.date || invoice.billingEnd || invoice.billingStart || ''
}

function invoiceAmount(invoice: Invoice): number {
  return Number(invoice.subtotal) || 0
}

function invoiceOutstanding(invoice: Invoice): number {
  if ((invoice.status || 'draft').toLowerCase() === 'draft') return 0
  return Math.max(0, invoiceAmount(invoice) - (Number(invoice.amountPaid) || 0))
}

function getLastSixMonths() {
  const values: { key: string; label: string }[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    values.push({
      key: monthKey(date),
      label: date.toLocaleString('en-US', { month: 'short' }),
    })
  }
  return values
}

export default function PrototypeDashboard({
  store,
  candidates,
  generalExpenses,
  onNavigate,
  onExport,
}: Props) {
  const [range, setRange] = useState<RangeValue>('month')
  const [activeKpi, setActiveKpi] = useState<KpiModalKey | null>(null)
  const [activeAttention, setActiveAttention] = useState<AttentionModalKey | null>(null)
  const now = new Date()
  const selectedRangeStart = startOfRange(range, now)
  const selectedRangeEnd = dateKey(now)
  const selectedRangeLabel = rangeLabel(range)

  const rangeInvoices = useMemo(
    () => store.invoices.filter(invoice => {
      const date = getInvoiceDate(invoice)
      return date >= selectedRangeStart && date <= selectedRangeEnd
    }),
    [selectedRangeEnd, selectedRangeStart, store.invoices],
  )

  const totalBilled = rangeInvoices.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0)
  const hoursBilled = rangeInvoices.reduce(
    (sum, invoice) => sum + (invoice.items || []).reduce((itemTotal, item) => itemTotal + invoiceItemHours(item), 0),
    0,
  )
  const totalPayroll = rangeInvoices.reduce((sum, invoice) => sum + (invoice.items || []).reduce((itemTotal, item) => {
    const employee = store.employees.find(entry =>
      (item.employeeId && entry.id === item.employeeId) ||
      entry.name?.toLowerCase() === item.employeeName?.toLowerCase(),
    )
    return itemTotal + payrollFromInvoiceItem(item, employee).totalPay
  }, 0), 0)
  const rangeExpenses = generalExpenses
    .filter(expense => !expense.date || (expense.date >= selectedRangeStart && expense.date <= selectedRangeEnd))
  const operatingExpenses = rangeExpenses
    .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
  const unpaidInvoices = store.invoices.filter(invoice => !['paid', 'draft'].includes((invoice.status || 'draft').toLowerCase()))
  const overdueInvoices = store.invoices.filter(invoice => (invoice.status || '').toLowerCase() === 'overdue')
  const outstanding = unpaidInvoices.reduce((sum, invoice) => sum + invoiceOutstanding(invoice), 0)
  const netEarnings = totalBilled - totalPayroll - operatingExpenses
  const rangeCandidates = candidates.filter(candidate => {
    const date = candidate.appliedAt || (candidate.updatedAt ? new Date(candidate.updatedAt).toISOString().slice(0, 10) : '')
    return !date || (date >= selectedRangeStart && date <= selectedRangeEnd)
  })
  const pipelineCandidates = rangeCandidates.filter(candidate => !['hired', 'rejected'].includes(candidate.stage))
  const offers = rangeCandidates.filter(candidate => candidate.stage === 'offer').length
  const activeEmployees = store.employees.filter(employee => (employee.status || 'active').toLowerCase() === 'active').length
  const pausedEmployees = store.employees.length - activeEmployees

  const trendData = useMemo(() => {
    return getLastSixMonths().map(month => {
      const monthInvoices = store.invoices.filter(invoice => getInvoiceDate(invoice).startsWith(month.key))
      const billed = monthInvoices.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0)
      const collected = monthInvoices.reduce((sum, invoice) => {
        const status = (invoice.status || '').toLowerCase()
        if (status === 'paid') return sum + invoiceAmount(invoice)
        return sum + Math.min(invoiceAmount(invoice), Math.max(0, Number(invoice.amountPaid) || 0))
      }, 0)
      return { label: month.label, billed, collected }
    })
  }, [store.invoices])

  const topClients = useMemo(() => {
    const map = new Map<string, { id?: string; name: string; total: number }>()
    for (const invoice of rangeInvoices) {
      const existing = map.get(invoice.clientName || 'Unknown') || { id: undefined, name: invoice.clientName || 'Unknown', total: 0 }
      const client = store.clients.find(entry => entry.name === invoice.clientName)
      existing.id = client?.id
      existing.total += invoiceAmount(invoice)
      map.set(existing.name, existing)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5)
  }, [rangeInvoices, store.clients])

  const projectRevenueRows = useMemo(() => {
    const map = new Map<string, { id?: string; name: string; hours: number; invoiced: number; payroll: number }>()
    for (const invoice of rangeInvoices) {
      const project = store.projects.find(entry => entry.id === invoice.projectId)
        || store.projects.find(entry => entry.name === invoice.projectName)
      const key = project?.id || invoice.projectId || invoice.projectName || 'unassigned'
      const existing = map.get(key) || {
        id: project?.id || invoice.projectId || undefined,
        name: project?.name || invoice.projectName || 'Unassigned',
        hours: 0,
        invoiced: 0,
        payroll: 0,
      }
      existing.invoiced += invoiceAmount(invoice)
      for (const item of invoice.items || []) {
        const employee = store.employees.find(entry =>
          (item.employeeId && entry.id === item.employeeId) ||
          entry.name?.toLowerCase() === item.employeeName?.toLowerCase(),
        )
        existing.hours += invoiceItemHours(item)
        existing.payroll += payrollFromInvoiceItem(item, employee).totalPay
      }
      map.set(key, existing)
    }
    return Array.from(map.values())
      .map(row => ({ ...row, earnings: row.invoiced - row.payroll }))
      .sort((a, b) => b.earnings - a.earnings)
      .slice(0, 6)
  }, [rangeInvoices, store.employees, store.projects])

  const employeePayables = useMemo(() => {
    const map = new Map<string, { id?: string; name: string; total: number; invoices: string[] }>()
    for (const invoice of store.invoices) {
      const payments = invoice.employeePayments || {}
      for (const item of invoice.items || []) {
        const employee = store.employees.find(entry =>
          (item.employeeId && entry.id === item.employeeId) ||
          entry.name?.toLowerCase() === item.employeeName?.toLowerCase(),
        )
        if (!employee) continue
        const payment = payments[employee.id] || payments[employee.name] || payments[item.employeeId || ''] || payments[item.employeeName || '']
        if (payment?.status === 'paid') continue
        const payable = payrollFromInvoiceItem(item, employee).totalPay
        if (payable <= 0) continue
        const key = employee.id || employee.name
        const existing = map.get(key) || { id: employee.id, name: employee.name, total: 0, invoices: [] }
        existing.total += payable
        if (invoice.number && !existing.invoices.includes(invoice.number)) existing.invoices.push(invoice.number)
        map.set(key, existing)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [store.employees, store.invoices])
  const draftInvoices = useMemo(
    () => store.invoices.filter(invoice => (invoice.status || '').toLowerCase() === 'draft'),
    [store.invoices],
  )
  const nonOverdueUnpaidInvoices = useMemo(
    () => unpaidInvoices.filter(invoice => (invoice.status || '').toLowerCase() !== 'overdue'),
    [unpaidInvoices],
  )
  const contractRenewals = useMemo(
    () => store.clients.filter(client => Boolean(client.contractEnd)).sort((a, b) => (a.contractEnd || '').localeCompare(b.contractEnd || '')),
    [store.clients],
  )
  const offerCandidates = useMemo(
    () => candidates.filter(candidate => candidate.stage === 'offer'),
    [candidates],
  )

  const attentionItems = useMemo(() => {
    const items: { kind: string; title: string; sub: string; amt: string; color: string; onClick: () => void }[] = []
    if (overdueInvoices.length > 0) {
      items.push({
        kind: 'AR',
        title: `Overdue invoices · ${overdueInvoices.length}`,
        sub: `${overdueInvoices.filter(invoice => daysFromToday(invoice.dueDate) < -7).length} older than 7 days`,
        amt: protoCurrency(overdueInvoices.reduce((sum, invoice) => sum + invoiceOutstanding(invoice), 0)),
        color: '#f87171',
        onClick: () => setActiveAttention('overdue'),
      })
    }

    if (nonOverdueUnpaidInvoices.length > 0) {
      items.push({
        kind: 'OPEN',
        title: `Unpaid invoices · ${nonOverdueUnpaidInvoices.length}`,
        sub: 'Open receivables waiting for payment',
        amt: protoCurrency(nonOverdueUnpaidInvoices.reduce((sum, invoice) => sum + invoiceOutstanding(invoice), 0)),
        color: '#f5b533',
        onClick: () => setActiveAttention('unpaid'),
      })
    }

    if (draftInvoices.length > 0) {
      items.push({
        kind: 'DRAFT',
        title: `Draft invoices · ${draftInvoices.length}`,
        sub: 'Review before sending to clients',
        amt: protoCurrency(draftInvoices.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0)),
        color: '#fb923c',
        onClick: () => setActiveAttention('drafts'),
      })
    }

    if (employeePayables.length > 0) {
      items.push({
        kind: 'PAY',
        title: `Employee payouts · ${employeePayables.length}`,
        sub: `${employeePayables.reduce((sum, employee) => sum + employee.invoices.length, 0)} invoice payout${employeePayables.length === 1 ? '' : 's'} pending`,
        amt: protoCurrency(employeePayables.reduce((sum, employee) => sum + employee.total, 0)),
        color: '#10b981',
        onClick: () => setActiveAttention('payroll'),
      })
    }

    if (contractRenewals.length > 0) {
      items.push({
        kind: 'CLIENT',
        title: `Contract renewals · ${contractRenewals.length}`,
        sub: `Next: ${contractRenewals[0]?.name || 'Client'}${contractRenewals[0]?.contractEnd ? ` · ${contractRenewals[0].contractEnd}` : ''}`,
        amt: 'REVIEW',
        color: '#60a5fa',
        onClick: () => setActiveAttention('clients'),
      })
    }

    if (offerCandidates.length > 0) {
      items.push({
        kind: 'HIRING',
        title: `Offers out · ${offerCandidates.length}`,
        sub: 'Candidates waiting for follow-up',
        amt: 'FOLLOW',
        color: '#c084fc',
        onClick: () => setActiveAttention('hiring'),
      })
    }

    if (!items.length) {
      items.push({
        kind: 'CLEAR',
        title: 'All clear',
        sub: 'No urgent invoice, client, or candidate actions right now',
        amt: 'OK',
        color: '#10b981',
        onClick: () => onNavigate('/invoice'),
      })
    }

    return items.slice(0, 6)
  }, [contractRenewals, draftInvoices, employeePayables, nonOverdueUnpaidInvoices, offerCandidates, overdueInvoices, onNavigate])

  const invoiceQueue = useMemo(() => {
    return unpaidInvoices
      .slice()
      .sort((a, b) => (a.dueDate || a.date || '').localeCompare(b.dueDate || b.date || ''))
      .slice(0, 8)
  }, [unpaidInvoices])

  const kpis = [
    {
      label: 'TOTAL BILLED',
      value: protoCurrency(totalBilled),
      unit: selectedRangeLabel,
      delta: totalBilled > 0 ? '+LIVE' : '0',
      up: true,
      sub: `${rangeInvoices.length} invoices in range`,
      accent: '#22d3ee',
      spark: trendData.map(item => item.billed || 0),
      onClick: () => setActiveKpi('billed' as const),
    },
    {
      label: 'NET EARNINGS',
      value: protoCurrency(netEarnings),
      unit: selectedRangeLabel,
      delta: netEarnings >= 0 ? '+POS' : '−NEG',
      up: netEarnings >= 0,
      sub: `Payroll ${protoCurrency(totalPayroll)} + ops ${protoCurrency(operatingExpenses)}`,
      accent: '#10b981',
      spark: trendData.map(item => item.billed - (item.collected * 0.35)),
      onClick: () => setActiveKpi('net' as const),
    },
    {
      label: 'HOURS BILLED',
      value: hoursBilled.toLocaleString(),
      unit: 'H',
      delta: `${activeEmployees} active`,
      up: true,
      sub: `${activeEmployees} active VAs · ${Math.max(pausedEmployees, 0)} paused`,
      accent: '#60a5fa',
      spark: trendData.map(item => Math.round(item.billed / 85)),
      onClick: () => setActiveKpi('hours' as const),
    },
    {
      label: 'OUTSTANDING',
      value: protoCurrency(outstanding),
      unit: 'OPEN',
      delta: `${unpaidInvoices.length} unpaid`,
      up: false,
      sub: `${overdueInvoices.length} overdue · queue live`,
      accent: '#f87171',
      spark: trendData.map(item => Math.max(item.billed - item.collected, 0)),
      onClick: () => setActiveKpi('outstanding' as const),
    },
    {
      label: 'PIPELINE',
      value: pipelineCandidates.length.toLocaleString(),
      unit: 'CAND',
      delta: `+${offers} offers`,
      up: true,
      sub: `${rangeCandidates.filter(candidate => candidate.stage === 'hired').length} hired in range`,
      accent: '#c084fc',
      spark: trendData.map((_, index) => Math.max(pipelineCandidates.length - 4 + index, 0)),
      onClick: () => setActiveKpi('pipeline' as const),
    },
  ]

  const maxTopClient = Math.max(...topClients.map(client => client.total), 1)
  const activeKpiMeta = activeKpi ? {
    billed: { title: 'Total billed', subtitle: `${rangeInvoices.length} invoices from ${protoDate(selectedRangeStart)} to ${protoDate(selectedRangeEnd)}` },
    net: { title: 'Net earnings', subtitle: `${protoCurrency(totalBilled)} billed minus ${protoCurrency(totalPayroll)} payroll and ${protoCurrency(operatingExpenses)} expenses` },
    hours: { title: 'Hours billed', subtitle: `${hoursBilled.toLocaleString()} hours from invoice line items in the selected range` },
    outstanding: { title: 'Outstanding invoices', subtitle: `${unpaidInvoices.length} unpaid invoices across all open receivables` },
    pipeline: { title: 'Candidate pipeline', subtitle: `${pipelineCandidates.length} active candidates in the selected range` },
  }[activeKpi] : null
  const activeAttentionMeta = activeAttention ? {
    unpaid: { title: 'Unpaid invoices', subtitle: `${nonOverdueUnpaidInvoices.length} open invoices waiting for payment` },
    overdue: { title: 'Overdue invoices', subtitle: `${overdueInvoices.length} invoices past due` },
    payroll: { title: 'Employee payouts', subtitle: `${employeePayables.length} employees have unpaid invoice earnings` },
    drafts: { title: 'Draft invoices', subtitle: `${draftInvoices.length} drafts waiting for review` },
    clients: { title: 'Contract renewals', subtitle: `${contractRenewals.length} clients with contract end dates` },
    hiring: { title: 'Offers out', subtitle: `${offerCandidates.length} candidates in offer stage` },
  }[activeAttention] : null

  function renderInvoiceRows(rows: Invoice[]) {
    return (
      <table className="proto-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Client</th>
            <th>Due</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(invoice => (
            <tr key={invoice.id} onClick={() => onNavigate(`/invoice?q=${encodeURIComponent(invoice.number)}`)}>
              <td className="proto-mono" style={{ color: '#22d3ee', fontWeight: 800 }}>{invoice.number}</td>
              <td>{invoice.clientName || 'Client'}</td>
              <td>{dueLabel(invoice.dueDate || invoice.date)}</td>
              <td><StatusChip status={invoice.status} /></td>
              <td className="proto-mono" style={{ textAlign: 'right', fontWeight: 800 }}>{protoCurrency(invoiceOutstanding(invoice) || invoiceAmount(invoice))}</td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={5} className="proto-empty">No records for this view.</td></tr> : null}
        </tbody>
      </table>
    )
  }

  function renderKpiModalContent() {
    if (activeKpi === 'billed') return renderInvoiceRows(rangeInvoices)
    if (activeKpi === 'outstanding') return renderInvoiceRows(unpaidInvoices)
    if (activeKpi === 'pipeline') {
      return (
        <table className="proto-table">
          <thead><tr><th>Candidate</th><th>Role</th><th>Stage</th><th>Applied</th></tr></thead>
          <tbody>
            {pipelineCandidates.map(candidate => (
              <tr key={candidate.id} onClick={() => onNavigate(`/candidates/${candidate.id}`)}>
                <td style={{ fontWeight: 800 }}>{candidate.name}</td>
                <td>{candidate.role || '—'}</td>
                <td><StatusChip status={candidate.stage} /></td>
                <td>{protoDate(candidate.appliedAt)}</td>
              </tr>
            ))}
            {!pipelineCandidates.length ? <tr><td colSpan={4} className="proto-empty">No active candidates in this range.</td></tr> : null}
          </tbody>
        </table>
      )
    }
    if (activeKpi === 'hours') {
      const employeeHours = new Map<string, { id?: string; name: string; hours: number; pay: number }>()
      for (const invoice of rangeInvoices) {
        for (const item of invoice.items || []) {
          const employee = store.employees.find(entry => (item.employeeId && entry.id === item.employeeId) || entry.name?.toLowerCase() === item.employeeName?.toLowerCase())
          const key = employee?.id || item.employeeName || 'unknown'
          const current = employeeHours.get(key) || { id: employee?.id, name: employee?.name || item.employeeName || 'Unknown', hours: 0, pay: 0 }
          current.hours += invoiceItemHours(item)
          current.pay += payrollFromInvoiceItem(item, employee).totalPay
          employeeHours.set(key, current)
        }
      }
      const rows = Array.from(employeeHours.values()).sort((a, b) => b.hours - a.hours)
      return (
        <table className="proto-table">
          <thead><tr><th>Employee</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Payroll</th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id || row.name} onClick={() => onNavigate(row.id ? `/employees/${row.id}` : '/employees')}>
                <td style={{ fontWeight: 800 }}>{row.name}</td>
                <td className="proto-mono" style={{ textAlign: 'right' }}>{Math.round(row.hours)}</td>
                <td className="proto-mono" style={{ textAlign: 'right' }}>{protoCurrency(row.pay)}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={3} className="proto-empty">No invoice hours in this range.</td></tr> : null}
          </tbody>
        </table>
      )
    }
    return (
      <div className="proto-kpi-grid-4">
        {[
          { label: 'Billed', value: protoCurrency(totalBilled), color: '#22d3ee' },
          { label: 'Payroll', value: protoCurrency(totalPayroll), color: '#fb923c' },
          { label: 'Expenses', value: protoCurrency(operatingExpenses), color: '#f87171' },
          { label: 'Net', value: protoCurrency(netEarnings), color: '#10b981' },
        ].map(item => (
          <div key={item.label} className="proto-kpi">
            <div className="proto-kpi-label">{item.label}</div>
            <div className="proto-kpi-value" style={{ color: item.color, marginTop: 8 }}>{item.value}</div>
          </div>
        ))}
      </div>
    )
  }

  function renderAttentionModalContent() {
    if (activeAttention === 'unpaid') return renderInvoiceRows(nonOverdueUnpaidInvoices)
    if (activeAttention === 'overdue') return renderInvoiceRows(overdueInvoices)
    if (activeAttention === 'drafts') return renderInvoiceRows(draftInvoices)
    if (activeAttention === 'payroll') {
      return (
        <table className="proto-table">
          <thead><tr><th>Employee</th><th>Invoices</th><th style={{ textAlign: 'right' }}>Pending Pay</th></tr></thead>
          <tbody>
            {employeePayables.map(employee => (
              <tr key={employee.id || employee.name} onClick={() => onNavigate(employee.id ? `/employees/${employee.id}` : '/employees')}>
                <td style={{ fontWeight: 800 }}>{employee.name}</td>
                <td className="proto-mono">
                  <span className="proto-inline-links">
                    {employee.invoices.map(invoiceNumber => (
                      <button
                        key={invoiceNumber}
                        type="button"
                        className="proto-link-button proto-inline-link"
                        onClick={(event) => {
                          event.stopPropagation()
                          onNavigate(`/invoice?q=${encodeURIComponent(invoiceNumber)}`)
                        }}
                      >
                        {invoiceNumber}
                      </button>
                    ))}
                  </span>
                </td>
                <td className="proto-mono" style={{ textAlign: 'right', fontWeight: 800 }}>{protoCurrency(employee.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    if (activeAttention === 'clients') {
      return (
        <table className="proto-table">
          <thead><tr><th>Client</th><th>Email</th><th>Contract End</th></tr></thead>
          <tbody>
            {contractRenewals.map(client => (
              <tr key={client.id} onClick={() => onNavigate(`/clients/${client.id}`)}>
                <td style={{ fontWeight: 800 }}>{client.name}</td>
                <td>{client.email || '—'}</td>
                <td>{protoDate(client.contractEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    return (
      <table className="proto-table">
        <thead><tr><th>Candidate</th><th>Role</th><th>Applied</th></tr></thead>
        <tbody>
          {offerCandidates.map(candidate => (
            <tr key={candidate.id} onClick={() => onNavigate(`/candidates/${candidate.id}`)}>
              <td style={{ fontWeight: 800 }}>{candidate.name}</td>
              <td>{candidate.role || '—'}</td>
              <td>{protoDate(candidate.appliedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="proto-page">
      <div className="proto-page-head">
        <div className="proto-page-head-row">
          <div>
            <div className="proto-eyebrow" style={{ color: '#22d3ee', marginBottom: 8 }}>Operations · {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
            <h1 className="page-title">Overview</h1>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, fontWeight: 500 }}>
              Tracking <span style={{ color: '#10b981', fontWeight: 700 }}>{protoCurrency(totalBilled)}</span> billed {selectedRangeLabel.toLowerCase()} · {overdueInvoices.length} invoices need follow-up · {draftInvoices.length} drafts pending
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <ToggleGroup
              value={range}
              onChange={setRange}
              options={[
                { id: 'today', label: 'Today' },
                { id: 'week', label: 'Week' },
                { id: 'month', label: 'Month' },
                { id: 'quarter', label: 'Quarter' },
                { id: 'year', label: 'Year' },
              ]}
            />
            <button type="button" className="proto-btn" onClick={onExport}>
              <ProtoIcon name="download" size={13} />
              Export
            </button>
            <button type="button" className="proto-btn proto-btn-primary" onClick={() => onNavigate('/invoice?new=1')}>
              <ProtoIcon name="plus" size={13} />
              NEW INVOICE
            </button>
          </div>
        </div>

        <div className="proto-kpi-grid">
          {kpis.map(kpi => (
            <button key={kpi.label} type="button" className="proto-kpi" onClick={kpi.onClick}>
              <div className="proto-kpi-accent" style={{ background: kpi.accent }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span className="proto-kpi-label">{kpi.label}</span>
                <span className="proto-kpi-delta" style={{ color: kpi.up ? '#10b981' : '#f87171' }}>{kpi.up ? '▲' : '▼'} {kpi.delta}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                <span className="proto-kpi-value">{kpi.value}</span>
                <span className="proto-mono" style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>{kpi.unit}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
                <span style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 500 }}>{kpi.sub}</span>
                <Sparkline data={kpi.spark} color={kpi.accent} />
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="proto-page-body">
        <div className="proto-stack">
          <div className="proto-grid-split">
            <div className="card">
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="proto-section-title">6-Month Trend · Billed vs Collected</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '.06em' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: '#22d3ee', borderRadius: 2 }} /> BILLED</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: '#262c40', borderRadius: 2 }} /> COLLECTED</span>
                  <span className="proto-mono" style={{ color: '#22d3ee' }}>{range.toUpperCase()} LIVE</span>
                </div>
              </div>
              <div style={{ padding: '20px 18px 6px' }}>
                <BarChart data={trendData} height={200} accentMonth={trendData[trendData.length - 1]?.label} />
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="proto-section-title">Attention Required</div>
                <span className="proto-mono" style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>{attentionItems.length} ITEMS</span>
              </div>
              <div style={{ overflow: 'auto', flex: 1 }}>
                {attentionItems.map((item, index) => (
                  <button key={`${item.kind}-${index}`} type="button" className="proto-attention-button proto-plain-button" onClick={item.onClick}>
                    <span className="proto-mono" style={{ fontSize: 9.5, fontWeight: 800, color: item.color, letterSpacing: '.1em', padding: '3px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, textAlign: 'center' }}>{item.kind}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f1f5f9', marginBottom: 2 }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.sub}</div>
                    </div>
                    <span className="proto-mono" style={{ fontSize: 11, fontWeight: 800, color: item.color }}>{item.amt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="proto-grid-split" style={{ minHeight: 360 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="proto-section-title">Invoice Queue</span>
                  <span className="proto-mono" style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: '#181c28', color: '#94a3b8', borderRadius: 4 }}>{invoiceQueue.length} open</span>
                </div>
                <button type="button" className="proto-btn proto-btn-ghost" style={{ fontSize: 10.5 }} onClick={() => onNavigate('/invoice')}>
                  View all <ProtoIcon name="arrowR" size={12} />
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table className="proto-table proto-mono">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>#</th>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Project</th>
                      <th>Due</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceQueue.map((invoice, index) => (
                      <tr key={invoice.id} onClick={() => onNavigate(`/invoice?q=${encodeURIComponent(invoice.number)}`)}>
                        <td style={{ color: '#475569', width: 32 }}>{String(index + 1).padStart(3, '0')}</td>
                        <td style={{ color: '#22d3ee', fontWeight: 700 }}>{invoice.number}</td>
                        <td style={{ color: '#f1f5f9', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{invoice.clientName || '—'}</td>
                        <td style={{ color: '#94a3b8', fontFamily: 'Inter, sans-serif' }}>{invoice.projectName || '—'}</td>
                        <td style={{ color: daysFromToday(invoice.dueDate) < 0 ? '#f87171' : '#94a3b8' }}>{dueLabel(invoice.dueDate)}</td>
                        <td style={{ color: '#f1f5f9', textAlign: 'right', fontWeight: 700 }}>{protoCurrency(invoiceAmount(invoice))}</td>
                        <td><StatusChip status={invoice.status} /></td>
                      </tr>
                    ))}
                    {!invoiceQueue.length ? (
                      <tr>
                        <td colSpan={7} className="proto-empty">No open invoices right now.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b' }} className="proto-mono">
                <span>Sum visible: <span style={{ color: '#22d3ee', fontWeight: 700 }}>{protoCurrency(invoiceQueue.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0))}</span></span>
                <span>Queue updates live</span>
              </div>
            </div>

            <div className="proto-stack">
              <div className="card">
                <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="proto-section-title">Revenue by Project · {selectedRangeLabel}</div>
                </div>
                <div style={{ overflow: 'auto' }}>
                  <table className="proto-table proto-table-compact">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th style={{ textAlign: 'right' }}>Hours</th>
                        <th style={{ textAlign: 'right' }}>Invoiced</th>
                        <th style={{ textAlign: 'right' }}>Payroll</th>
                        <th style={{ textAlign: 'right' }}>Earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectRevenueRows.map(row => (
                        <tr key={row.id || row.name} onClick={() => onNavigate(row.id ? `/projects/${row.id}` : '/projects')}>
                          <td style={{ fontWeight: 800, color: '#f1f5f9' }}>{row.name}</td>
                          <td className="proto-mono" style={{ textAlign: 'right', color: '#94a3b8' }}>{Math.round(row.hours).toLocaleString()}</td>
                          <td className="proto-mono" style={{ textAlign: 'right', color: '#22d3ee', fontWeight: 800 }}>{protoCurrency(row.invoiced)}</td>
                          <td className="proto-mono" style={{ textAlign: 'right', color: '#fb923c' }}>{protoCurrency(row.payroll)}</td>
                          <td className="proto-mono" style={{ textAlign: 'right', color: row.earnings >= 0 ? '#10b981' : '#f87171', fontWeight: 800 }}>{protoCurrency(row.earnings)}</td>
                        </tr>
                      ))}
                      {!projectRevenueRows.length ? (
                        <tr>
                          <td colSpan={5} className="proto-empty">No project revenue in this range.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="proto-section-title">Top Clients · {selectedRangeLabel}</div>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  {topClients.map(client => {
                    const pct = client.total / maxTopClient
                    return (
                      <button
                        key={client.name}
                        type="button"
                        className="proto-plain-button"
                        onClick={() => onNavigate(client.id ? `/clients/${client.id}` : '/clients')}
                        style={{ width: '100%', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 12, alignItems: 'center', background: 'transparent', textAlign: 'left' }}
                      >
                        <Avatar name={client.name} color={colorFromString(client.name)} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.name}</div>
                          <div style={{ height: 3, background: '#181c28', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                            <div style={{ width: `${pct * 100}%`, height: '100%', background: colorFromString(client.name) }} />
                          </div>
                        </div>
                        <span className="proto-mono" style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>{protoCurrency(client.total)}</span>
                      </button>
                    )
                  })}
                  {!topClients.length ? <div className="proto-empty">No client billing in the selected range.</div> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(activeKpi)}
        onClose={() => setActiveKpi(null)}
        title={activeKpiMeta?.title || ''}
        subtitle={activeKpiMeta?.subtitle}
        width={820}
      >
        {renderKpiModalContent()}
      </Modal>

      <Modal
        open={Boolean(activeAttention)}
        onClose={() => setActiveAttention(null)}
        title={activeAttentionMeta?.title || ''}
        subtitle={activeAttentionMeta?.subtitle}
        width={820}
      >
        {renderAttentionModalContent()}
      </Modal>
    </div>
  )
}
