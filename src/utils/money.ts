export function formatMoney(n: number): string {
  const num = Number.isFinite(n) ? n : 0
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function fmtHoursHM(h: number): string {
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return `${hrs}h ${String(mins).padStart(2, '0')}m`
}
