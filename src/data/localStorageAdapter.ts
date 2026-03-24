import { STORAGE_KEYS } from './storageKeys'
import type { DataSnapshot } from './types'

export function loadLegacyState(): DataSnapshot {
  const read = <T,>(k: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(k)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }

  const employees = read(STORAGE_KEYS.employees, [])
  const projects = read(STORAGE_KEYS.projects, [])
  const clients = read(STORAGE_KEYS.clients, [])
  const invoices = read(STORAGE_KEYS.invoices, [])

  const invoiceCounterRaw = localStorage.getItem(STORAGE_KEYS.invoiceCounter) || '1'
  const invoiceCounter = Number.parseInt(invoiceCounterRaw, 10)

  return {
    employees,
    projects,
    clients,
    invoices,
    invoiceCounter: Number.isFinite(invoiceCounter) && invoiceCounter > 0 ? invoiceCounter : 1,
  }
}
