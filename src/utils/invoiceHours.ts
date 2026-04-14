import type { InvoiceItem } from '../data/types'

export function parseInvoiceHours(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (value == null) return 0

  const raw = String(value).trim()
  if (!raw) return 0

  const normalized = raw.replace(',', '.')

  if (normalized.includes(':')) {
    const [hoursRaw, minutesRaw = '0'] = normalized.split(':')
    const hours = Number.parseInt(hoursRaw, 10) || 0
    const minutes = Number.parseInt(minutesRaw, 10) || 0
    if (minutes >= 0 && minutes < 60) return hours + minutes / 60
  }

  const minuteStyle = normalized.match(/^(\d+)\.(\d{2})$/)
  if (minuteStyle) {
    const hours = Number.parseInt(minuteStyle[1], 10) || 0
    const minutes = Number.parseInt(minuteStyle[2], 10) || 0
    if (minutes >= 0 && minutes < 60) return hours + minutes / 60
  }

  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function invoiceHoursToMinutes(value: unknown): number {
  const hours = parseInvoiceHours(value)
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return Math.round(hours * 60)
}

export function formatInvoiceHoursEntry(value: unknown): string {
  const totalMinutes = invoiceHoursToMinutes(value)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}.${String(minutes).padStart(2, '0')}`
}

export function formatInvoiceHoursHM(value: unknown): string {
  const totalMinutes = invoiceHoursToMinutes(value)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

export function invoiceItemHours(item: Pick<InvoiceItem, 'hoursTotal' | 'daily'>): number {
  let dailyTotal = 0
  if (item.daily) {
    for (const value of Object.values(item.daily)) {
      dailyTotal += parseInvoiceHours(value)
    }
  }

  if (dailyTotal > 0) return dailyTotal
  return parseInvoiceHours(item.hoursTotal)
}

export function invoiceItemAmount(item: Pick<InvoiceItem, 'hoursTotal' | 'daily' | 'rate' | 'billAmount'>): number {
  const storedAmount = Number(item.billAmount)
  if (Number.isFinite(storedAmount)) return storedAmount

  return invoiceItemHours(item) * (Number(item.rate) || 0)
}
