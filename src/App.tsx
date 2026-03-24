import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Shell from './components/Shell'
import LoginPage from './pages/LoginPage'
import PortalPage from './pages/PortalPage'
import OAuthCallbackPage from './pages/OAuthCallbackPage'
import ReportsPage from './pages/ReportsPage'
import InvoicePage from './pages/InvoicePage'
import EmployeesPage from './pages/EmployeesPage'
import EmployeeProfilePage from './pages/EmployeeProfilePage'
import ClientsPage from './pages/ClientsPage'
import ClientProfilePage from './pages/ClientProfilePage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectProfilePage from './pages/ProjectProfilePage'
import SettingsPage from './pages/SettingsPage'
import CandidatesPage from './pages/CandidatesPage'
import CandidateProfilePage from './pages/CandidateProfilePage'
import GeneralExpensesPage from './pages/GeneralExpensesPage'
import { loadSettings, saveSettings, loadInvoices } from './services/storage'

async function maybeFireReminder() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const settings = await loadSettings()
  if (settings.reminderDay == null) return
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  if (settings.reminderLastFired === todayStr) return
  if (today.getDay() !== settings.reminderDay) return
  const invoices = await loadInvoices()
  const unpaid = invoices.filter(inv => {
    const s = (inv.status || '').toLowerCase()
    return s === 'sent' || s === 'viewed' || s === 'overdue' || s === 'partial'
  })
  if (unpaid.length > 0) {
    new Notification('YVA OS — Invoice Reminder', {
      body: `${unpaid.length} unpaid invoice${unpaid.length > 1 ? 's' : ''} waiting. Check the Invoices pipeline.`,
      icon: '/yva-logo.png',
    })
  }
  void saveSettings({ ...settings, reminderLastFired: todayStr })
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) void maybeFireReminder()
    })
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Still loading auth state
  if (session === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  return (
    <Routes>
      {/* Public routes — no auth needed */}
      <Route path="/portal" element={<PortalPage />} />
      <Route path="/oauth-callback" element={<OAuthCallbackPage />} />
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />

      {/* Protected routes */}
      <Route path="/*" element={
        !session ? <Navigate to="/login" replace /> : (
          <Shell>
            <Routes>
              <Route path="/" element={<ReportsPage />} />
              <Route path="/invoice" element={<InvoicePage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/employees/:id" element={<EmployeeProfilePage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:id" element={<ClientProfilePage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectProfilePage />} />
              <Route path="/candidates" element={<CandidatesPage />} />
              <Route path="/candidates/:id" element={<CandidateProfilePage />} />
              <Route path="/expenses" element={<GeneralExpensesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        )
      } />
    </Routes>
  )
}
