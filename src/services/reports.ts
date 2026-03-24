import type { DataSnapshot } from '../data/types'
import { formatMoney } from '../utils/money'

export function calcReportsSummary(snapshot: DataSnapshot) {
  const invoiceCount = snapshot.invoices.length
  const totalBilled = snapshot.invoices.reduce((sum, inv) => sum + (typeof inv.subtotal === 'number' ? inv.subtotal : 0), 0)

  return {
    invoiceCount,
    employeeCount: snapshot.employees.length,
    clientCount: snapshot.clients.length,
    totalBilled,
    totalBilledFormatted: formatMoney(totalBilled),
  }
}
