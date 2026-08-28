import { useEffect, useState } from 'react'
import { GanttChart, Loader2, MailCheck, ShieldCheck } from 'lucide-react'
import { bootstrapFirstEditor, editorExists, requestMagicLink } from '@/services/authService'

type Mode = 'loading' | 'bootstrap' | 'ready'

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const [email, setEmail] = useState('')

  const [bootstrapName, setBootstrapName] = useState('')
  const [bootstrapEmail, setBootstrapEmail] = useState('')

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
      await bootstrapFirstEditor(bootstrapName, bootstrapEmail)
      await requestMagicLink(bootstrapEmail)
      setSentTo(bootstrapEmail)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRequestLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await requestMagicLink(email)
      setSentTo(email)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send sign-in link')
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
          {sentTo ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand-teal">
                <MailCheck size={22} />
              </div>
              <p className="text-sm font-semibold text-brand-ink">Check your email, {sentTo}</p>
              <p className="text-sm text-brand-slate">
                We sent a sign-in link to your inbox — no password needed. Open it on this device to continue.
              </p>
              <button
                onClick={() => setSentTo(null)}
                className="mt-1 text-sm font-semibold text-brand-teal hover:underline"
              >
                ← Back
              </button>
            </div>
          ) : mode === 'bootstrap' ? (
            <>
              <div className="mb-4 flex items-center gap-2 text-brand-ink">
                <ShieldCheck size={18} />
                <h2 className="font-semibold">Set up the first Editor account</h2>
              </div>
              <p className="mb-4 text-sm text-brand-slate">
                No account exists yet. An Editor can create/edit the schedule and add more accounts — no password,
                just a sign-in link sent to your email.
              </p>
              <form onSubmit={handleBootstrap} className="space-y-3">
                <Field label="Full name" value={bootstrapName} onChange={setBootstrapName} required />
                <Field label="Email" type="email" value={bootstrapEmail} onChange={setBootstrapEmail} required />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <SubmitButton busy={busy} label="Create editor account" />
              </form>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-brand-slate">
                No password — enter your email and we'll send you a sign-in link.
              </p>
              <form onSubmit={handleRequestLink} className="space-y-3">
                <Field label="Email" type="email" value={email} onChange={setEmail} required />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <SubmitButton busy={busy} label="Send sign-in link" />
              </form>
            </>
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
