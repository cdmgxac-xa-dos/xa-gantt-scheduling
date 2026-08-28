import { createClient } from '@supabase/supabase-js'
import { requireSupabase } from '@/lib/supabaseClient'
import type { AppRole, AppUser } from '@/types'

// A throwaway client (no localStorage session persistence) used only for
// provisioning new accounts. auth.signUp() on the *main* client would sign
// the browser in as the newly created user, silently ending the caller's
// own session — this keeps account creation from ever touching it.
function ephemeralClient() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function editorExists(): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc('gantt_editor_exists')
  if (error) throw error
  return Boolean(data)
}

/** Bootstrap the very first Editor account. */
export async function bootstrapFirstEditor(fullName: string, email: string, password: string) {
  const client = ephemeralClient()
  const { data, error } = await client.auth.signUp({ email, password })
  if (error) throw error
  const userId = data.user?.id
  if (!userId) throw new Error('Sign-up did not return a user')

  const { error: userError } = await client.from('gantt_app_users').insert({
    id: userId,
    full_name: fullName,
    email,
    role: 'editor',
  })
  if (userError) throw userError
}

/** An existing Editor creates any other account (Editor or Viewer) with a password they choose. */
export async function createAccount(fullName: string, email: string, password: string, role: AppRole) {
  const client = ephemeralClient()
  const { data, error } = await client.auth.signUp({ email, password })
  if (error) throw error
  const userId = data.user?.id
  if (!userId) throw new Error('Sign-up did not return a user')

  const { error: userError } = await client.from('gantt_app_users').insert({
    id: userId,
    full_name: fullName,
    email,
    role,
  })
  if (userError) throw userError
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await requireSupabase().auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function changePassword(newPassword: string) {
  const { error } = await requireSupabase().auth.updateUser({ password: newPassword })
  if (error) throw error
}

export async function signOut() {
  await requireSupabase().auth.signOut()
}

export async function fetchMyUser(userId: string): Promise<AppUser | null> {
  const { data, error } = await requireSupabase().from('gantt_app_users').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data as AppUser | null
}

export async function listAllUsers(): Promise<AppUser[]> {
  const { data, error } = await requireSupabase().from('gantt_app_users').select('*').order('full_name')
  if (error) throw error
  return data as AppUser[]
}

/** An Editor edits another account's name and/or role. */
export async function updateUser(id: string, fields: { full_name: string; role: AppRole }) {
  const { error } = await requireSupabase().from('gantt_app_users').update(fields).eq('id', id)
  if (error) throw error
}

/** An Editor removes an account's row, revoking its app access. */
export async function deleteUser(id: string) {
  const { error } = await requireSupabase().from('gantt_app_users').delete().eq('id', id)
  if (error) throw error
}
