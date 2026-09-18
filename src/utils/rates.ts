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

/**
 * Edit-time shape of an assignment: rates stay raw strings while someone is
 * typing. Storing them as numbers and rendering String(n) back into the input
 * makes a decimal impossible to type - "7." parses to 7 and re-renders as "7",
 * deleting the point before the next keystroke arrives. Same convention the
 * project forms already use for `rate` and `budget`.
 */
export type ProjectAssignmentDraft = {
  employeeId: string
  position?: string
  billRate?: string
  payRate?: string
}

function isBlank(value?: string): boolean {
  return !value || !value.trim()
}

/** Upsert one draft, dropping it entirely when position and both rates are empty. */
export function setAssignmentDraft(
  drafts: ProjectAssignmentDraft[] | undefined,
  employeeId: string,
  patch: Partial<Omit<ProjectAssignmentDraft, 'employeeId'>>,
): ProjectAssignmentDraft[] {
  const current = drafts || []
  const existing = current.find(entry => entry.employeeId === employeeId)
  const merged: ProjectAssignmentDraft = { ...existing, ...patch, employeeId }

  if (isBlank(merged.position) && isBlank(merged.billRate) && isBlank(merged.payRate)) {
    return current.filter(entry => entry.employeeId !== employeeId)
  }
  return existing
    ? current.map(entry => entry.employeeId === employeeId ? merged : entry)
    : [...current, merged]
}

export function toAssignmentDrafts(assignments?: ProjectAssignment[]): ProjectAssignmentDraft[] {
  return (assignments || []).map(entry => ({
    employeeId: entry.employeeId,
    position: entry.position,
    billRate: entry.billRate != null ? String(entry.billRate) : undefined,
    payRate: entry.payRate != null ? String(entry.payRate) : undefined,
  }))
}

/**
 * Commit drafts back to storage: parse the rate strings, drop anything that is
 * blank or not a real number, and keep only people still on the project.
 */
export function fromAssignmentDrafts(
  drafts: ProjectAssignmentDraft[] | undefined,
  employeeIds: string[],
): ProjectAssignment[] {
  const members = new Set(employeeIds)
  const result: ProjectAssignment[] = []

  for (const draft of drafts || []) {
    if (!members.has(draft.employeeId)) continue
    const entry: ProjectAssignment = { employeeId: draft.employeeId }
    const position = draft.position?.trim()
    if (position) entry.position = position
    for (const field of ['billRate', 'payRate'] as const) {
      const raw = draft[field]
      if (isBlank(raw)) continue
      const num = Number(String(raw).replace(',', '.'))
      if (Number.isFinite(num) && num > 0) entry[field] = num
    }
    if (entry.position || entry.billRate || entry.payRate) result.push(entry)
  }
  return result
}
