import type { DataSnapshot } from '../data/types'

// Legacy keys from the single-file app
const EMP_KEY = 'yvaEmployeesV1'
const PROJ_KEY = 'yvaProjectsV2'
const INV_KEY = 'yvaInvoicesV1'
const CLIENT_KEY = 'yvaClientsV1'
const INV_COUNTER_KEY = 'yvaInvoiceCounterV1'

function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadAllData(): DataSnapshot {
  const employees = safeParse(localStorage.getItem(EMP_KEY), [])
  const projects = safeParse(localStorage.getItem(PROJ_KEY), [])
  const clients = safeParse(localStorage.getItem(CLIENT_KEY), [])
  const invoices = safeParse(localStorage.getItem(INV_KEY), [])
  const invoiceCounterRaw = localStorage.getItem(INV_COUNTER_KEY)
  const invoiceCounter = Math.max(1, Number.parseInt(invoiceCounterRaw || '1', 10) || 1)

  return { employees, projects, clients, invoices, invoiceCounter }
}
