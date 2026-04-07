import type { DataSnapshot, Invoice, InvoiceItem } from '../data/types'
import { payrollFromInvoiceItem } from '../utils/payroll'

export type DateRange = {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
}

export type RevenueRow = {
  name: string
  total: number
  invoiceCount: number
  share: number // 0..1
}

export type ProjectRevenueRow = {
  name: string
  total: number
  invoiceCount: number
  share: number
  hoursBilled: number
}

export type TrendPoint = {
  bucket: string // e.g. 2025-12
  total: number
}

export type EmpPerfRow = {
  name: string
  hours: number
  billed: number
  payroll: number
  margin: number
  invoiceCount: number
}

export type ClientAnalyticsRow = {
  name: string
  projectCount: number
  invoiceCount: number
  total: number
  lastDate: string
}

export type ProjectAnalyticsRow = {
  name: string
  client: string
  invoiceCount: number
  total: number
  hours: number
  lastDate: string
}

export type ReportsResult = {
  range: DateRange
  invoiceCount: number
  paidCount: number
  unpaidCount: number
  totalBilled: number
  totalHours: number
  totalPayroll: number
  totalNetEarnings: number
  byClient: RevenueRow[]
  byProject: ProjectRevenueRow[]
  employeePerformance: EmpPerfRow[]
  allTimeByClient: ClientAnalyticsRow[]
  allTimeByProject: ProjectAnalyticsRow[]
  trend: TrendPoint[]
  insights: string[]
}

function parseISODateLoose(s?: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return null
  return d
}

function isoDay(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export function makeCurrentMonthRange(now = new Date()): DateRange {
  const from = startOfMonth(now)
  const to = endOfMonth(now)
  return { from: isoDay(from), to: isoDay(to) }
}

export function makeCurrentQuarterRange(now = new Date()): DateRange {
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  const to = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: isoDay(from), to: isoDay(to) }
}

function clampToDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function inRange(d: Date, range: DateRange): boolean {
  const from = parseISODateLoose(range.from)
  const to = parseISODateLoose(range.to)
  if (!from || !to) return false
  const dd = clampToDay(d).getTime()
  return dd >= clampToDay(from).getTime() && dd <= clampToDay(to).getTime()
}

function getInvoiceEffectiveDate(inv: Invoice): Date | null {
  return (
    parseISODateLoose(inv.date) ||
    parseISODateLoose(inv.billingEnd) ||
    parseISODateLoose(inv.billingStart) ||
    null
  )
}

function safeSubtotal(inv: Invoice): number {
  const n = Number(inv.subtotal ?? 0)
  return Number.isFinite(n) ? n : 0
}

function safeItems(inv: Invoice): InvoiceItem[] {
  return Array.isArray(inv.items) ? inv.items : []
}

function sumHours(items: InvoiceItem[]): number {
  let total = 0
  for (const it of items) {
    const h = Number(it.hoursTotal ?? 0)
    if (Number.isFinite(h)) total += h
  }
  return total
}

function monthBucket(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function computeReports(store: DataSnapshot, range: DateRange): ReportsResult {
  const rows: Invoice[] = []
  for (const inv of store.invoices) {
    const d = getInvoiceEffectiveDate(inv)
    if (!d) continue
    if (inRange(d, range)) rows.push(inv)
  }

  let totalBilled = 0
  let paidCount = 0
  let unpaidCount = 0

  const byClient  = new Map<string, { total: number; count: number }>()
  const byProject = new Map<string, { total: number; count: number; hours: number }>()
  const trend     = new Map<string, number>()

  // Employee performance (range-scoped)
  const byEmp = new Map<string, { hours: number; billed: number; payroll: number; invIds: Set<string> }>()

  for (const inv of rows) {
    const subtotal = safeSubtotal(inv)
    totalBilled += subtotal

    const status = (inv.status || '').toLowerCase()
    if (status === 'paid') paidCount += 1
    else unpaidCount += 1

    const clientName  = (inv.clientName  || 'Unknown client').trim()  || 'Unknown client'
    const projectName = (inv.projectName || 'No project').trim() || 'No project'

    const c = byClient.get(clientName) || { total: 0, count: 0 }
    c.total += subtotal; c.count += 1
    byClient.set(clientName, c)

    const p = byProject.get(projectName) || { total: 0, count: 0, hours: 0 }
    p.total += subtotal; p.count += 1
    p.hours += sumHours(safeItems(inv))
    byProject.set(projectName, p)

    const d = getInvoiceEffectiveDate(inv)
    if (d) trend.set(monthBucket(d), (trend.get(monthBucket(d)) || 0) + subtotal)

    for (const item of safeItems(inv)) {
      const empName = item.employeeName?.trim() || 'Unknown'
      if (!byEmp.has(empName)) byEmp.set(empName, { hours: 0, billed: 0, payroll: 0, invIds: new Set() })
      const ep = byEmp.get(empName)!
      const h  = Number(item.hoursTotal) || 0
      const emp = store.employees.find(e => (item.employeeId && e.id === item.employeeId) || e.name.toLowerCase() === empName.toLowerCase())
      const payroll = payrollFromInvoiceItem(item, emp)
      ep.hours   += h
      ep.billed  += h * (Number(item.rate) || 0)
      ep.payroll += payroll.totalPay
      ep.invIds.add(inv.id)
    }
  }

  const byClientRows: RevenueRow[] = Array.from(byClient.entries()).map(([name, agg]) => ({
    name, total: agg.total, invoiceCount: agg.count,
    share: totalBilled > 0 ? agg.total / totalBilled : 0,
  })).sort((a, b) => b.total - a.total)

  const byProjectRows: ProjectRevenueRow[] = Array.from(byProject.entries()).map(([name, agg]) => ({
    name, total: agg.total, invoiceCount: agg.count,
    share: totalBilled > 0 ? agg.total / totalBilled : 0,
    hoursBilled: agg.hours,
  })).sort((a, b) => b.total - a.total)

  const employeePerformance: EmpPerfRow[] = Array.from(byEmp.entries()).map(([name, ep]) => ({
    name, hours: ep.hours, billed: ep.billed, payroll: ep.payroll,
    margin: ep.billed - ep.payroll, invoiceCount: ep.invIds.size,
  })).sort((a, b) => b.billed - a.billed)

  const totalHours      = employeePerformance.reduce((s, e) => s + e.hours, 0)
  const totalPayroll    = employeePerformance.reduce((s, e) => s + e.payroll, 0)
  const totalNetEarnings = totalBilled - totalPayroll

  // All-time client analytics
  const atClient = new Map<string, { projects: Set<string>; invoices: number; total: number; lastDate: string }>()
  for (const inv of store.invoices) {
    const name = (inv.clientName || 'Unknown').trim()
    if (!atClient.has(name)) atClient.set(name, { projects: new Set(), invoices: 0, total: 0, lastDate: '' })
    const c = atClient.get(name)!
    c.invoices += 1
    c.total    += safeSubtotal(inv)
    if (inv.projectName) c.projects.add(inv.projectName)
    const d = getInvoiceEffectiveDate(inv)
    if (d) { const ds = isoDay(d); if (!c.lastDate || ds > c.lastDate) c.lastDate = ds }
  }
  const allTimeByClient: ClientAnalyticsRow[] = Array.from(atClient.entries()).map(([name, c]) => ({
    name, projectCount: c.projects.size, invoiceCount: c.invoices, total: c.total, lastDate: c.lastDate,
  })).sort((a, b) => b.total - a.total)

  // All-time project analytics
  const atProject = new Map<string, { client: string; invoices: number; total: number; hours: number; lastDate: string }>()
  for (const inv of store.invoices) {
    const name = (inv.projectName || 'No project').trim()
    if (!atProject.has(name)) atProject.set(name, { client: inv.clientName || '', invoices: 0, total: 0, hours: 0, lastDate: '' })
    const p = atProject.get(name)!
    p.invoices += 1
    p.total    += safeSubtotal(inv)
    p.hours    += sumHours(safeItems(inv))
    const d = getInvoiceEffectiveDate(inv)
    if (d) { const ds = isoDay(d); if (!p.lastDate || ds > p.lastDate) p.lastDate = ds }
  }
  const allTimeByProject: ProjectAnalyticsRow[] = Array.from(atProject.entries()).map(([name, p]) => ({
    name, client: p.client, invoiceCount: p.invoices, total: p.total, hours: p.hours, lastDate: p.lastDate,
  })).sort((a, b) => b.total - a.total)

  const trendPoints: TrendPoint[] = Array.from(trend.entries())
    .map(([bucket, total]) => ({ bucket, total }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : 1))

  const insights: string[] = []
  if (byClientRows.length > 0) {
    const top = byClientRows[0]
    insights.push(`Top billing client in range: ${top.name} (${Math.round(top.share * 100)}% of revenue).`)
  }
  if (byProjectRows.length > 0) {
    const topP = byProjectRows[0]
    insights.push(`Top project in range: ${topP.name} (${Math.round(topP.share * 100)}% of revenue).`)
  }
  if (totalPayroll > 0) {
    insights.push(`Estimated payroll for range: ${totalPayroll.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · Net: ${totalNetEarnings.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`)
  }
  if (unpaidCount > 0) {
    insights.push(`Unpaid invoices in range: ${unpaidCount}.`)
  }

  return {
    range,
    invoiceCount: rows.length,
    paidCount,
    unpaidCount,
    totalBilled,
    totalHours,
    totalPayroll,
    totalNetEarnings,
    byClient: byClientRows,
    byProject: byProjectRows,
    employeePerformance,
    allTimeByClient,
    allTimeByProject,
    trend: trendPoints,
    insights,
  }
}


// Backwards-friendly aliases (nicer naming)
export const getCurrentMonthRange = makeCurrentMonthRange
export const getCurrentQuarterRange = makeCurrentQuarterRange
