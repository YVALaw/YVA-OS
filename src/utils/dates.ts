/**
 * Helpers for the plain `YYYY-MM-DD` date strings stored on records
 * (`contractEnd`, invoice dates, expense dates).
 *
 * `new Date("2026-09-18")` is parsed as UTC midnight, which in any negative
 * UTC offset is the previous day locally. Comparing that against a local
 * midnight makes a date that is due today look like it already passed - a
 * contract expiring today dropped out of the expiring-soon list completely.
 * Anchoring at local noon keeps the calendar day intact in every timezone.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Parse a date-only string at local noon. Returns null if unparseable. */
export function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const date = DATE_ONLY.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Local midnight today. */
export function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

/**
 * Whole calendar days from today until `value`.
 * 0 = today, negative = already passed, null = no/!valid date.
 */
export function daysUntil(value?: string | null): number | null {
  const target = parseDateOnly(value)
  if (!target) return null
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - startOfToday().getTime()) / 86400000)
}

/** True when `value` falls between today and `days` days from now, inclusive. */
export function isWithinDays(value: string | null | undefined, days: number): boolean {
  const left = daysUntil(value)
  return left != null && left >= 0 && left <= days
}
