import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { loadCandidates, loadSnapshot } from '../services/storage'
import { useRole } from '../context/RoleContext'
import { can, ROLE_LABELS } from '../lib/roles'
import { ProtoIcon, type ProtoIconName } from './PrototypeKit'

type Props = {
  children: ReactNode
}

type SearchResult = {
  kind: 'Command' | 'Client' | 'Employee' | 'Project' | 'Candidate' | 'Invoice'
  label: string
  sub: string
  run: () => void
}

type NavItem = {
  to: string
  label: string
  mobileLabel: string
  icon: JSX.Element
}

const nav: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    mobileLabel: 'Home',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    to: '/invoice',
    label: 'Invoices',
    mobileLabel: 'Invoices',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    ),
  },
  {
    to: '/clients',
    label: 'Clients',
    mobileLabel: 'Clients',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: '/employees',
    label: 'Team',
    mobileLabel: 'Team',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21a8 8 0 1 0-16 0" />
      </svg>
    ),
  },
  {
    to: '/candidates',
    label: 'Candidates',
    mobileLabel: 'Talent',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    to: '/projects',
    label: 'Projects',
    mobileLabel: 'Projects',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    to: '/expenses',
    label: 'Expenses',
    mobileLabel: 'Expenses',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    mobileLabel: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

function searchResultIcon(kind: SearchResult['kind']): ProtoIconName {
  if (kind === 'Client') return 'building'
  if (kind === 'Employee' || kind === 'Candidate') return 'team'
  if (kind === 'Project') return 'database'
  if (kind === 'Invoice') return 'invoice'
  return 'arrowR'
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { role } = useRole()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SearchResult[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!open) return

    setQuery('')
    setActiveIndex(0)
    setItems([])
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)

    void (async () => {
      const [snapshot, candidates] = await Promise.all([loadSnapshot(), loadCandidates()])
      const commands: SearchResult[] = [
        { kind: 'Command', label: 'Open Dashboard', sub: 'Go to the reporting overview', run: () => navigate('/') },
        { kind: 'Command', label: 'Open Invoices', sub: 'Review invoices and billing pipeline', run: () => navigate('/invoice') },
        { kind: 'Command', label: 'Open Clients', sub: 'Browse client accounts', run: () => navigate('/clients') },
        { kind: 'Command', label: 'Open Team', sub: 'Browse employee profiles', run: () => navigate('/employees') },
        { kind: 'Command', label: 'Open Projects', sub: 'Review active projects', run: () => navigate('/projects') },
        { kind: 'Command', label: 'Open Settings', sub: 'Manage workspace settings', run: () => navigate('/settings') },
      ]

      if (can.viewExpenses(role)) {
        commands.push({ kind: 'Command', label: 'Open Expenses', sub: 'Review operating expenses', run: () => navigate('/expenses') })
      }
      if (can.viewAllCandidates(role) || can.viewHiredOnly(role)) {
        commands.push({ kind: 'Command', label: 'Open Candidates', sub: 'Review recruiting pipeline', run: () => navigate('/candidates') })
      }

      const clientResults = snapshot.clients.map<SearchResult>(client => ({
        kind: 'Client',
        label: client.name,
        sub: client.company || client.email || client.status || '',
        run: () => navigate(`/clients/${client.id}`),
      }))

      const employeeResults = snapshot.employees.map<SearchResult>(employee => ({
        kind: 'Employee',
        label: employee.name,
        sub: employee.role || employee.email || employee.status || '',
        run: () => navigate(`/employees/${employee.id}`),
      }))

      const projectResults = snapshot.projects.map<SearchResult>(project => ({
        kind: 'Project',
        label: project.name,
        sub: project.status || project.billingModel || '',
        run: () => navigate(`/projects/${project.id}`),
      }))

      const candidateResults = candidates.map<SearchResult>(candidate => ({
        kind: 'Candidate',
        label: candidate.name,
        sub: candidate.role || candidate.stage,
        run: () => navigate(`/candidates/${candidate.id}`),
      }))

      const invoiceResults = snapshot.invoices.map<SearchResult>(invoice => ({
        kind: 'Invoice',
        label: invoice.number,
        sub: `${invoice.clientName || 'No client'} · ${invoice.status || 'draft'}`,
        run: () => navigate(`/invoice?q=${encodeURIComponent(invoice.number || '')}`),
      }))

      setItems([
        ...commands,
        ...clientResults,
        ...employeeResults,
        ...projectResults,
        ...candidateResults,
        ...invoiceResults,
      ])
    })()

    return () => window.clearTimeout(timer)
  }, [navigate, open, role])

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex(index => Math.min(index + 1, Math.max(filtered.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(index => Math.max(index - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = filtered[activeIndex]
        if (!target) return
        target.run()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, onClose, open, items, query])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.slice(0, 14)
    return items.filter(item =>
      `${item.kind} ${item.label} ${item.sub}`.toLowerCase().includes(q),
    ).slice(0, 14)
  }, [items, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  if (!open) return null

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette-panel" onClick={event => event.stopPropagation()}>
        <div className="command-palette-head">
          <span className="command-palette-prompt">&gt;</span>
          <input
            ref={inputRef}
            className="command-palette-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Type a command, client, invoice, team member, or project..."
          />
          <span className="command-palette-key">ESC</span>
        </div>
        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">No matches for "{query}"</div>
          ) : (
            filtered.map((item, index) => (
              <button
                key={`${item.kind}-${item.label}-${index}`}
                type="button"
                className={`command-palette-item${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  item.run()
                  onClose()
                }}
              >
                <span className="command-palette-icon">
                  <ProtoIcon name={searchResultIcon(item.kind)} size={15} />
                </span>
                <span className="command-palette-copy">
                  <span className="command-palette-label">{item.label}</span>
                  {item.sub && <span className="command-palette-sub">{item.sub}</span>}
                </span>
                <span className="command-palette-kind">{item.kind}</span>
              </button>
            ))
          )}
        </div>
        <div className="command-palette-foot">
          <span>↑↓ navigate · Enter open</span>
          <span>{filtered.length} shown</span>
        </div>
      </div>
    </div>
  )
}

function isRouteActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/'
  return pathname.startsWith(to)
}

export default function Shell({ children }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { role, email } = useRole()
  const [commandOpen, setCommandOpen] = useState(false)

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(open => !open)
      }
    }

    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  const visibleNav = nav.filter(item => {
    if (item.to === '/invoice') return can.viewInvoices(role)
    if (item.to === '/clients') return can.viewClients(role)
    if (item.to === '/employees') return can.viewEmployees(role)
    if (item.to === '/candidates') return can.viewAllCandidates(role) || can.viewHiredOnly(role)
    if (item.to === '/expenses') return can.viewExpenses(role)
    return true
  })

  return (
    <>
      <div className="shell shell-top-nav">
        <header className="topbar topbar-prototype">
          <div className="topbar-brand" onClick={() => navigate('/')} role="button" tabIndex={0} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              navigate('/')
            }
          }}>
            <div className="topbar-brand-mark">Y</div>
            <div className="topbar-brand-copy">
              <div className="topbar-brand-name">YVA OS</div>
              <div className="topbar-brand-sub">Operations Hub</div>
            </div>
          </div>

          <nav className="topbar-nav" aria-label="Primary">
            {visibleNav.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `topbar-nav-item${isActive ? ' active' : ''}`}
              >
                <span className="topbar-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="topbar-actions">
            <button type="button" className="command-launch" onClick={() => setCommandOpen(true)}>
              <span className="command-launch-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </span>
              <span className="command-launch-copy">Jump to anything...</span>
              <span className="command-launch-key">Ctrl K</span>
            </button>
            <div className="topbar-user">
              <div className="topbar-user-meta">
                {email && <div className="topbar-user-email">{email}</div>}
                <div className="topbar-user-role">{ROLE_LABELS[role]}</div>
              </div>
              <button
                type="button"
                className="topbar-user-avatar"
                onClick={() => navigate('/settings')}
                title="Open settings"
              >
                {(email || role).slice(0, 2).toUpperCase()}
              </button>
            </div>
          </div>
        </header>

        <main className="main-content main-content-prototype">
          {children}
        </main>

        <nav className="mobile-bottom-nav" aria-label="Mobile">
          {visibleNav.map(item => {
            const active = isRouteActive(location.pathname, item.to)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={`mobile-bottom-nav-item${active ? ' active' : ''}`}
              >
                <span className="mobile-bottom-nav-icon">{item.icon}</span>
                <span className="mobile-bottom-nav-label">{item.mobileLabel}</span>
              </NavLink>
            )
          })}
        </nav>
      </div>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </>
  )
}
