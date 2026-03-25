import { Routes, Route, NavLink } from 'react-router-dom'
import { LayoutDashboard, Settings, FileText, Loader2, WifiOff } from 'lucide-react'
import { useHealth } from './hooks/useBackend'
import { Dashboard } from './pages/Dashboard'
import { Setup } from './pages/Setup'
import { AgentDetail } from './pages/AgentDetail'
import { Logs } from './pages/Logs'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/logs', label: 'Logs', icon: FileText },
  { to: '/setup', label: 'Setup', icon: Settings },
]

function NavBar() {
  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-3xl mx-auto px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">E</span>
          </div>
          <span className="font-semibold text-gray-100 text-sm">Ecdysis</span>
        </div>
        <div className="flex gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-900 text-brand-300'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  const health = useHealth()

  // Still loading first check
  if (health.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-gray-600 animate-spin" />
      </div>
    )
  }

  // Backend unreachable
  if (health.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <WifiOff className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Cannot reach backend</p>
          <p className="text-gray-600 text-xs mt-1">Check that llm-manager is running</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agent/:slot" element={<AgentDetail />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/setup" element={<Setup />} />
        </Routes>
      </main>
    </div>
  )
}
