import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GanttChart, Loader2, ShieldCheck } from 'lucide-react'
import { bootstrapFirstEditor, editorExists, signInWithPassword } from '@/services/authService'
import { useAuth } from '@/context/AuthContext'

type Mode = 'loading' | 'bootstrap' | 'ready'

export function LoginPage() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [mode, setMode] = useState<Mode>('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [bootstrapName, setBootstrapName] = useState('')
  const [bootstrapEmail, setBootstrapEmail] = useState('')
  const [bootstrapPassword, setBootstrapPassword] = useState('')

  useEffect(() => {
    editorExists()
      .then((exists) => setMode(exists ? 'ready' : 'bootstrap'))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not reach the server')
        setMode('ready')
      })
  }, [])

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await bootstrapFirstEditor(bootstrapName, bootstrapEmail, bootstrapPassword)
      await signInWithPassword(bootstrapEmail, bootstrapPassword)
      await refreshUser()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInWithPassword(email, password)
      await refreshUser()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-brand-slate">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-ink px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
            <GanttChart size={26} />
          </div>
          <h1 className="text-xl font-bold">XA Gantt &amp; Scheduling</h1>
          <p className="mt-1 text-sm text-white/70">Standalone app · backend on XA DOS (by module)</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-pop">
          {mode === 'bootstrap' ? (
            <>
              <div className="mb-4 flex items-center gap-2 text-brand-ink">
                <ShieldCheck size={18} />
                <h2 className="font-semibold">Set up the first Editor account</h2>
              </div>
              <p className="mb-4 text-sm text-brand-slate">
                No account exists yet. An Editor can create/edit the schedule and add more accounts.
              </p>
              <form onSubmit={handleBootstrap} className="space-y-3">
                <Field label="Full name" value={bootstrapName} onChange={setBootstrapName} required />
                <Field label="Email" type="email" value={bootstrapEmail} onChange={setBootstrapEmail} required />
                <Field
                  label="Password"
                  type="password"
                  value={bootstrapPassword}
                  onChange={setBootstrapPassword}
                  required
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <SubmitButton busy={busy} label="Create editor account" />
              </form>
            </>
          ) : (
            <form onSubmit={handleLogin} className="space-y-3">
              <Field label="Email" type="email" value={email} onChange={setEmail} required />
              <Field label="Password" type="password" value={password} onChange={setPassword} required />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <SubmitButton busy={busy} label="Sign in" />
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-brand-slate">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal"
      />
    </label>
  )
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-ink py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {label}
    </button>
  )
}
