import type { Employee, InvoiceItem } from '../data/types'

export type PayrollBreakdown = {
  totalHours: number
  regularHours: number
  premiumHours: number
  basePayRate: number
  premiumPercent: number
  premiumMultiplier: number
  totalPay: number
}

export type PremiumAmountBreakdown = {
  totalHours: number
  regularHours: number
  premiumHours: number
  baseRate: number
  premiumPercent: number
  premiumMultiplier: number
  totalAmount: number
}

function toNumber(value: string | number | undefined): number {
  const num = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(num) ? num : 0
}

function normalizeTime(value?: string): string {
  if (!value) return ''
  const raw = value.trim()
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return raw
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2] || '0', 10)
  const suffix = (match[3] || '').toLowerCase()
  if (suffix === 'pm' && hours < 12) hours += 12
  if (suffix === 'am' && hours === 12) hours = 0
  hours = Math.min(Math.max(hours, 0), 23)
  const mins = Math.min(Math.max(minutes, 0), 59)
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function timeToMinutes(value?: string): number | null {
  const normalized = normalizeTime(value)
  const match = normalized.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  return hours * 60 + minutes
}

function overlapMinutes(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB))
}

export function normalizeClockInput(value?: string): string {
  return normalizeTime(value)
}

export function employeePremiumConfig(employee?: Employee | null) {
  return {
    enabled: Boolean(employee?.premiumEnabled),
    startTime: normalizeTime(employee?.premiumStartTime || '21:00') || '21:00',
    percent: toNumber(employee?.premiumPercent),
  }
}

export function computePremiumHours(totalHours: number, shiftStart?: string, shiftEnd?: string, premiumStartTime = '21:00') {
  const total = Math.max(0, totalHours || 0)
  const start = timeToMinutes(shiftStart)
  const end = timeToMinutes(shiftEnd)
  const premiumStart = timeToMinutes(premiumStartTime)
  if (total <= 0 || start == null || end == null || premiumStart == null) {
    return { regularHours: total, premiumHours: 0 }
  }

  let shiftEndMinutes = end
  if (shiftEndMinutes <= start) shiftEndMinutes += 24 * 60
  let premiumMinutes = 0
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const windowStart = premiumStart + dayOffset * 24 * 60
    const windowEnd = 24 * 60 + dayOffset * 24 * 60
    premiumMinutes += overlapMinutes(start, shiftEndMinutes, windowStart, windowEnd)
  }
  const rawShiftHours = Math.max(0, (shiftEndMinutes - start) / 60)
  const effectiveShiftHours = rawShiftHours > 0 ? rawShiftHours : total
  const premiumHours = Math.min(total, premiumMinutes / 60)
  if (effectiveShiftHours <= 0) {
    return { regularHours: total, premiumHours: 0 }
  }
  if (Math.abs(effectiveShiftHours - total) < 0.01) {
    return { regularHours: Math.max(0, total - premiumHours), premiumHours }
  }
  const scale = total / effectiveShiftHours
  const scaledPremiumHours = Math.min(total, premiumHours * scale)
  return {
    regularHours: Math.max(0, total - scaledPremiumHours),
    premiumHours: scaledPremiumHours,
  }
}

export function computePayrollBreakdown(totalHours: number, employee?: Employee | null, shiftStart?: string, shiftEnd?: string): PayrollBreakdown {
  const safeHours = Math.max(0, totalHours || 0)
  const config = employeePremiumConfig(employee)
  const basePayRate = toNumber(employee?.payRate)
  const premiumPercent = config.enabled ? config.percent : 0
  const premiumMultiplier = 1 + premiumPercent / 100
  const split = config.enabled
    ? computePremiumHours(safeHours, shiftStart, shiftEnd, config.startTime)
    : { regularHours: safeHours, premiumHours: 0 }
  const totalPay = split.regularHours * basePayRate + split.premiumHours * basePayRate * premiumMultiplier
  return {
    totalHours: safeHours,
    regularHours: split.regularHours,
    premiumHours: split.premiumHours,
    basePayRate,
    premiumPercent,
    premiumMultiplier,
    totalPay,
  }
}

export function computePremiumAdjustedAmount(
  totalHours: number,
  baseRate: number,
  premiumPercent: number,
  premiumEnabled: boolean,
  shiftStart?: string,
  shiftEnd?: string,
  premiumStartTime = '21:00',
): PremiumAmountBreakdown {
  const safeHours = Math.max(0, totalHours || 0)
  const safeRate = Math.max(0, toNumber(baseRate))
  const safePercent = premiumEnabled ? Math.max(0, toNumber(premiumPercent)) : 0
  const premiumMultiplier = 1 + safePercent / 100
  const split = premiumEnabled
    ? computePremiumHours(safeHours, shiftStart, shiftEnd, premiumStartTime)
    : { regularHours: safeHours, premiumHours: 0 }
  return {
    totalHours: safeHours,
    regularHours: split.regularHours,
    premiumHours: split.premiumHours,
    baseRate: safeRate,
    premiumPercent: safePercent,
    premiumMultiplier,
    totalAmount: split.regularHours * safeRate + split.premiumHours * safeRate * premiumMultiplier,
  }
}

export function payrollFromInvoiceItem(item: InvoiceItem, employee?: Employee | null): PayrollBreakdown {
  const totalHours = toNumber(item.hoursTotal)
  const regularHours = toNumber(item.regularHours)
  const premiumHours = toNumber(item.premiumHours)
  const hasStoredSplit = regularHours > 0 || premiumHours > 0
  const basePayRate = toNumber(item.basePayRate || employee?.payRate)
  const premiumPercent = toNumber(item.premiumPercent || employee?.premiumPercent)
  const premiumMultiplier = 1 + premiumPercent / 100
  const totalPay = toNumber(item.totalPay)

  if (hasStoredSplit || totalPay > 0) {
    const finalRegularHours = hasStoredSplit ? regularHours : Math.max(0, totalHours - premiumHours)
    const finalPremiumHours = premiumHours
    return {
      totalHours,
      regularHours: finalRegularHours,
      premiumHours: finalPremiumHours,
      basePayRate,
      premiumPercent,
      premiumMultiplier,
      totalPay: totalPay || (finalRegularHours * basePayRate + finalPremiumHours * basePayRate * premiumMultiplier),
    }
  }

  return computePayrollBreakdown(totalHours, employee, item.shiftStart, item.shiftEnd)
}
