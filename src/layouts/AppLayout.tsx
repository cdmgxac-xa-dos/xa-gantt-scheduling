import { NavLink, Outlet } from 'react-router-dom'
import { GanttChart, Users, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export function AppLayout() {
  const { user, signOut } = useAuth()
  if (!user) return null

  return (
    <div className="min-h-screen bg-[#F4F8F8]">
      <header className="sticky top-0 z-20 border-b border-brand-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-ink text-white">
              <GanttChart size={18} />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight text-brand-ink">XA Gantt &amp; Scheduling</p>
              <p className="text-xs leading-tight text-brand-slate">Standalone app</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-tint text-brand-teal' : 'text-brand-slate hover:bg-slate-100'
                }`
              }
            >
              Schedule
            </NavLink>
            {user.role === 'editor' && (
              <NavLink
                to="/users"
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-brand-tint text-brand-teal' : 'text-brand-slate hover:bg-slate-100'
                  }`
                }
              >
                <Users size={15} /> Users
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-brand-ink">{user.full_name}</p>
              <p className="text-xs text-brand-slate">{user.role === 'editor' ? 'Editor' : 'Viewer'}</p>
            </div>
            <button
              onClick={signOut}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-line text-brand-slate hover:bg-slate-100"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto border-t border-brand-line px-4 py-2 md:hidden">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-tint text-brand-teal' : 'text-brand-slate'}`
            }
          >
            Schedule
          </NavLink>
          {user.role === 'editor' && (
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-tint text-brand-teal' : 'text-brand-slate'}`
              }
            >
              Users
            </NavLink>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
