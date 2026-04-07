import { ReactNode, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { loadSnapshot, loadCandidates } from '../services/storage'
import { useRole } from '../context/RoleContext'
import { can, ROLE_LABELS } from '../lib/roles'

type Props = {
  children: ReactNode
}

type SearchResult = {
  type: 'Client' | 'Employee' | 'Project' | 'Candidate' | 'Invoice'
  label: string
  sub: string
  route: string
}

function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) { setResults([]); setOpen(false); return }
    void (async () => {
    const snap = await loadSnapshot()
    const candidates = await loadCandidates()
    const found: SearchResult[] = []

    for (const c of snap.clients) {
      if (`${c.name} ${c.email || ''} ${c.company || ''}`.toLowerCase().includes(q)) {
        found.push({ type: 'Client', label: c.name, sub: c.email || c.company || '', route: '/clients/' + c.id })
      }
    }
    for (const e of snap.employees) {
      if (`${e.name} ${e.email || ''} ${e.role || ''}`.toLowerCase().includes(q)) {
        found.push({ type: 'Employee', label: e.name, sub: e.role || e.email || '', route: '/employees/' + e.id })
      }
    }
    for (const p of snap.projects) {
      if (`${p.name}`.toLowerCase().includes(q)) {
        found.push({ type: 'Project', label: p.name, sub: p.status || '', route: '/projects/' + p.id })
      }
    }
    for (const cand of candidates) {
      if (`${cand.name} ${cand.role || ''} ${cand.email || ''}`.toLowerCase().includes(q)) {
        found.push({ type: 'Candidate', label: cand.name, sub: cand.role || cand.stage, route: '/candidates/' + cand.id })
      }
    }
    for (const inv of snap.invoices) {
      if (`${inv.number} ${inv.clientName || ''} ${inv.projectName || ''}`.toLowerCase().includes(q)) {
        found.push({ type: 'Invoice', label: inv.number, sub: `${inv.clientName || ''} · ${inv.status || 'draft'}`, route: '/invoice' })
      }
    }
    setResults(found.slice(0, 8))
    setOpen(found.length > 0)
    setActiveIndex(0)
    })()
  }, [query])

  function pick(r: SearchResult) {
    navigate(r.route)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const TYPE_COLORS: Record<string, string> = {
    Client: '#3b82f6', Employee: '#22c55e', Project: '#a855f7', Invoice: '#f5b533', Candidate: '#14b8a6',
  }

  return (
    <div className="search-shell">
      <input
        ref={inputRef}
        className="form-input topbar-search"
        placeholder="Search..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'Escape') { setQuery(''); setOpen(false); return }
          if (!results.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActiveIndex(i => (i + 1) % results.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            setActiveIndex(i => (i - 1 + results.length) % results.length)
          } else if (e.key === 'Enter' && open) {
            e.preventDefault()
            pick(results[activeIndex] || results[0])
          }
        }}
      />
      {open && (
        <div className="search-results">
          {results.map((r, i) => (
            <div
              key={i}
              onMouseDown={() => pick(r)}
              className={`search-result-item${activeIndex === i ? ' active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="search-result-type" style={{ color: TYPE_COLORS[r.type] || '#999' }}>{r.type}</span>
              <div className="search-result-body">
                <div className="search-result-label">{r.label}</div>
                {r.sub && <div className="search-result-sub">{r.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const nav = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    to: '/invoice',
    label: 'Invoices',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    ),
  },
  {
    to: '/clients',
    label: 'Clients',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: '/employees',
    label: 'Team',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21a8 8 0 1 0-16 0" />
      </svg>
    ),
  },
  {
    to: '/candidates',
    label: 'Candidates',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    to: '/projects',
    label: 'Projects',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    to: '/expenses',
    label: 'Expenses',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

function PageTitle({ pathname }: { pathname: string }) {
  // Profile routes: /employees/:id, /clients/:id, etc.
  const profileMatch = pathname.match(/^\/(employees|clients|projects|candidates)\/[^/]+/)
  if (profileMatch) {
    const section = profileMatch[1]
    const label = section === 'employees' ? 'Team' : section.charAt(0).toUpperCase() + section.slice(1)
    return <span>{label} — Profile</span>
  }
  const found = nav.find((n) => {
    if (n.to === '/') return pathname === '/'
    return pathname.startsWith(n.to)
  })
  return <span>{found?.label ?? 'YVA OS'}</span>
}

export default function Shell({ children }: Props) {
  const location = useLocation()
  const { role, email } = useRole()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('yva_sidebar_collapsed') === '1')

  function toggleBrandNav() {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setSidebarOpen(false)
      return
    }
    setSidebarCollapsed(v => !v)
  }

  useEffect(() => {
    localStorage.setItem('yva_sidebar_collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  // Close sidebar on route change
  const prevPath = useRef(location.pathname)
  if (prevPath.current !== location.pathname) {
    prevPath.current = location.pathname
    if (sidebarOpen) setSidebarOpen(false)
  }

  const visibleNav = nav.filter(item => {
    if (item.to === '/invoice')    return can.viewInvoices(role)
    if (item.to === '/clients')    return can.viewClients(role)
    if (item.to === '/employees')  return can.viewEmployees(role)
    if (item.to === '/candidates') return can.viewAllCandidates(role) || can.viewHiredOnly(role)
    if (item.to === '/expenses')   return can.viewExpenses(role)
    return true
  })

  return (
    <div className={`shell${sidebarCollapsed ? ' shell-collapsed' : ''}`}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <button
          type="button"
          className="sidebar-brand sidebar-brand-toggle"
          onClick={toggleBrandNav}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <div className="sidebar-brand-icon">Y</div>
          <div className="sidebar-brand-copy">
            <div className="sidebar-brand-name">YVA OS</div>
            <div className="sidebar-brand-sub">Operations Hub</div>
          </div>
        </button>

        <nav className="sidebar-nav">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {email && <div className="sidebar-footer-label sidebar-footer-email" style={{ marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
          <div className="sidebar-footer-label" style={{ color: 'var(--gold)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{ROLE_LABELS[role]}</div>
        </div>
      </aside>

      <header className="topbar">
        <button
          className="hamburger btn-icon"
          onClick={() => setSidebarOpen(o => !o)}
          aria-label="Toggle menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6"  x2="21" y2="6"  />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="topbar-title">
          <PageTitle pathname={location.pathname} />
        </div>
        <div className="topbar-actions">
          <GlobalSearch />
          <div className="topbar-badge">Live</div>
        </div>
      </header>

      <main className="main-content">
        {children}
      </main>
    </div>
  )
}
