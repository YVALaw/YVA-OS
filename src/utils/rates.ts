import type { Client, Employee, Project, ProjectAssignment } from '../data/types'

/**
 * Rate resolution for a placement (one employee on one project).
 *
 * Two separate chains that must never cross:
 *   - BILL rate  -> what the client pays. Client-facing documents only.
 *   - PAY rate   -> what the employee earns. Employee-facing documents only.
 *
 * The bill chain deliberately never falls back to the employee pay rate: doing
 * so would invoice the client at cost. When nothing resolves, the rate is 0 and
 * the caller is expected to leave the field blank and prompt for a real rate.
 */

export type BillRateSource = 'assignment' | 'project' | 'client' | 'none'
export type PayRateSource = 'assignment' | 'employee' | 'none'

export type ResolvedRate<T> = {
  rate: number
  source: T
}

function toNumber(value: string | number | undefined | null): number {
  if (value == null || value === '') return 0
  const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(num) && num > 0 ? num : 0
}

export function findAssignment(
  project?: Project | null,
  employeeId?: string | null,
): ProjectAssignment | undefined {
  if (!project || !employeeId) return undefined
  return (project.assignments || []).find(entry => entry.employeeId === employeeId)
}

/** What the client is billed for this person on this project. */
export function resolveBillRate(
  employee?: Employee | null,
  project?: Project | null,
  client?: Client | null,
): ResolvedRate<BillRateSource> {
  const assignmentRate = toNumber(findAssignment(project, employee?.id)?.billRate)
  if (assignmentRate) return { rate: assignmentRate, source: 'assignment' }

  const projectRate = toNumber(project?.rate)
  if (projectRate) return { rate: projectRate, source: 'project' }

  const clientRate = toNumber(client?.defaultRate)
  if (clientRate) return { rate: clientRate, source: 'client' }

  return { rate: 0, source: 'none' }
}

/** What this person earns on this project. Never shown to the client. */
export function resolvePayRate(
  employee?: Employee | null,
  project?: Project | null,
): ResolvedRate<PayRateSource> {
  const assignmentRate = toNumber(findAssignment(project, employee?.id)?.payRate)
  if (assignmentRate) return { rate: assignmentRate, source: 'assignment' }

  const employeeRate = toNumber(employee?.payRate)
  if (employeeRate) return { rate: employeeRate, source: 'employee' }

  return { rate: 0, source: 'none' }
}

/** Job title for this person on this project, falling back to their global role. */
export function resolvePosition(project?: Project | null, employee?: Employee | null): string {
  return findAssignment(project, employee?.id)?.position || employee?.role || ''
}

const BILL_RATE_LABELS: Record<BillRateSource, string> = {
  assignment: 'Rate set for this person on this project',
  project: 'Project rate',
  client: 'Client default rate',
  none: 'No rate set — enter one before sending',
}

export function billRateSourceLabel(source: BillRateSource): string {
  return BILL_RATE_LABELS[source]
}

/** Upsert one assignment, dropping it entirely when both rates and position are empty. */
export function setAssignment(
  assignments: ProjectAssignment[] | undefined,
  employeeId: string,
  patch: Partial<Omit<ProjectAssignment, 'employeeId'>>,
): ProjectAssignment[] {
  const current = assignments || []
  const existing = current.find(entry => entry.employeeId === employeeId)
  const merged: ProjectAssignment = { ...existing, ...patch, employeeId }

  if (!merged.billRate && !merged.payRate && !merged.position) {
    return current.filter(entry => entry.employeeId !== employeeId)
  }
  return existing
    ? current.map(entry => entry.employeeId === employeeId ? merged : entry)
    : [...current, merged]
}
