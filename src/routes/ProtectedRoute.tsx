import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { AppRole } from '@/types'

export function ProtectedRoute({ allow }: { allow?: AppRole[] }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-brand-slate">Loading…</div>
  }

  if (!user) return <Navigate to="/login" replace />

  if (allow && !allow.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
