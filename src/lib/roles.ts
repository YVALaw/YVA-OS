export type UserRole = 'ceo' | 'admin' | 'accounting' | 'recruiter' | 'lead_gen'

export const ROLE_LABELS: Record<UserRole, string> = {
  ceo:        'CEO',
  admin:      'Admin',
  accounting: 'Accounting',
  recruiter:  'Recruiter',
  lead_gen:   'Lead Generator',
}

export const ROLE_OPTIONS: UserRole[] = ['ceo', 'admin', 'accounting', 'recruiter', 'lead_gen']

export const can = {
  viewInvoices:      (r: UserRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewFinancials:    (r: UserRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewPayRates:      (r: UserRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewAllCandidates: (r: UserRole) => r === 'ceo' || r === 'admin' || r === 'recruiter',
  viewHiredOnly:     (r: UserRole) => r === 'accounting',
  viewClients:       (r: UserRole) => r !== 'recruiter',
  viewExpenses:      (r: UserRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewReports:       (r: UserRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewEmployees:     (r: UserRole) => r !== 'lead_gen',
  manageRoles:       (r: UserRole) => r === 'ceo' || r === 'admin',
  // CEO-only: revenue totals, payroll, net earnings
  viewOwnerStats:    (r: UserRole) => r === 'ceo',
}
