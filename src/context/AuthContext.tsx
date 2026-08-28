import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { fetchMyUser, signOut as doSignOut } from '@/services/authService'
import type { AppUser } from '@/types'

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  refreshUser: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadUser(userId: string | undefined) {
    if (!userId) {
      setUser(null)
      return
    }
    try {
      const u = await fetchMyUser(userId)
      setUser(u)
    } catch {
      setUser(null)
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      loadUser(data.session?.user?.id).finally(() => setLoading(false))
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadUser(session?.user?.id)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  async function refreshUser() {
    const { data } = await supabase!.auth.getSession()
    await loadUser(data.session?.user?.id)
  }

  async function signOut() {
    await doSignOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
