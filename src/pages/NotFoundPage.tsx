import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-bold text-brand-ink">Page not found</h1>
      <Link to="/" className="text-sm font-semibold text-brand-teal hover:underline">
        ← Back to the schedule
      </Link>
    </div>
  )
}
