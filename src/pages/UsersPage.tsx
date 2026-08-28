import { useEffect, useState } from 'react'
import { Loader2, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { createAccount, deleteUser, listAllUsers, updateUser } from '@/services/authService'
import { useAuth } from '@/context/AuthContext'
import type { AppRole, AppUser } from '@/types'

const ROLE_LABEL: Record<AppRole, string> = {
  editor: 'Editor — can create/edit the schedule',
  viewer: 'Viewer — read only',
}

export function UsersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AppRole>('viewer')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<AppRole>('viewer')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState('')

  async function refresh() {
    setLoading(true)
    try {
      setUsers(await listAllUsers())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setCreating(true)
    try {
      await createAccount(fullName.trim(), email.trim(), role)
      setNotice(`${fullName} can now sign in at this app's login page — no password, just their email.`)
      setFullName('')
      setEmail('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create account')
    } finally {
      setCreating(false)
    }
  }

  function startEdit(u: AppUser) {
    setRowError('')
    setEditingId(u.id)
    setEditName(u.full_name)
    setEditRole(u.role)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    setRowError('')
    setSavingEdit(true)
    try {
      await updateUser(id, { full_name: editName.trim(), role: editRole })
      setEditingId(null)
      await refresh()
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Could not update account')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete(u: AppUser) {
    if (!window.confirm(`Remove ${u.full_name}'s account? This revokes their access immediately.`)) return
    setRowError('')
    setDeletingId(u.id)
    try {
      await deleteUser(u.id)
      await refresh()
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Could not remove account')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-ink">Users</h1>
        <p className="text-sm text-brand-slate">Manage Editor and Viewer accounts</p>
      </div>

      <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-brand-ink">
          <UserPlus size={15} /> Add account
        </h2>
        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-brand-slate">Full name</span>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-brand-slate">Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-brand-slate">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
            >
              {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          {notice && <p className="text-sm text-green-700 sm:col-span-2">{notice}</p>}
          <button
            type="submit"
            disabled={creating}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            Create account
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-brand-line bg-white shadow-card">
        <h2 className="border-b border-brand-line p-4 text-sm font-bold text-brand-ink">All accounts</h2>
        {rowError && <p className="border-b border-brand-line px-4 py-2 text-sm text-red-600">{rowError}</p>}
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-brand-slate" />
          </div>
        ) : (
          <div className="divide-y divide-brand-line">
            {users.map((u) =>
              editingId === u.id ? (
                <div key={u.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border border-brand-line px-3 py-1.5 text-sm"
                  />
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as AppRole)}
                    className="w-full rounded-lg border border-brand-line px-3 py-1.5 text-sm"
                  >
                    {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(u.id)}
                      disabled={savingEdit || !editName.trim()}
                      className="flex items-center gap-1 rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {savingEdit && <Loader2 size={12} className="animate-spin" />}
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-1 rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-slate"
                    >
                      <X size={12} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-brand-ink">{u.full_name}</p>
                    <p className="truncate text-xs text-brand-slate">{u.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-brand-slate">
                      {u.role === 'editor' ? 'Editor' : 'Viewer'}
                    </span>
                    <button
                      onClick={() => startEdit(u)}
                      title="Edit account"
                      className="rounded-lg p-1.5 text-brand-slate hover:bg-slate-100"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={u.id === currentUser?.id || deletingId === u.id}
                      title={u.id === currentUser?.id ? "You can't remove your own account" : 'Remove account'}
                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-30"
                    >
                      {deletingId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
