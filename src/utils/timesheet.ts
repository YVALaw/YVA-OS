import type { InvoiceTimeEntry } from '../data/types'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatHours(hours: number): string {
  const safe = Number.isFinite(hours) ? Math.max(0, hours) : 0
  const rounded = Math.round(safe * 100) / 100
  if (Number.isInteger(rounded)) return `${rounded}`
  return `${rounded}`.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

function formatDateLabel(date: string): string {
  if (!date) return ''
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsed)
}

export function formatTimeEntrySummary(entries?: InvoiceTimeEntry[] | null): string {
  if (!entries || entries.length === 0) return ''
  return entries
    .map(entry => {
      const parts = [
        formatDateLabel(entry.date),
        entry.startTime?.trim() || '—',
        entry.endTime?.trim() || '—',
        `${formatHours(entry.hours)}h`,
      ].filter(Boolean)
      const note = entry.note?.trim()
      return `${parts[0] || entry.date}: ${parts.slice(1).join(' - ')}${note ? ` · ${note}` : ''}`
    })
    .join('\n')
}

export function formatTimeEntrySummaryHtml(entries?: InvoiceTimeEntry[] | null): string {
  const summary = formatTimeEntrySummary(entries)
  if (!summary) return ''
  return escapeHtml(summary).replace(/\n/g, '<br>')
}

