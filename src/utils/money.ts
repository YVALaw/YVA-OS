export function formatMoney(n: number): string {
  const num = Number.isFinite(n) ? n : 0
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function fmtHoursHM(h: number): string {
  const totalMinutes = Math.max(0, Math.round((Number.isFinite(h) ? h : 0) * 60))
  const hrs = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return `${hrs}h ${String(mins).padStart(2, '0')}m`
}
