import { createClient } from '@supabase/supabase-js'
import { requireSupabase } from '@/lib/supabaseClient'
import type { AppRole, AppUser } from '@/types'

// A throwaway client (no localStorage session persistence) used only for
// provisioning new accounts. auth.signUp() on the *main* client would sign
// the browser in as the newly created user, silently ending the caller's
// own session — this keeps account creation from ever touching it.
//
// No one ever types or sees a password in this app — every account signs in
// with an emailed magic link. signUp() still needs *some* password to create
// the auth.users row and hand back its id (signInWithOtp() alone doesn't
// return an id, to prevent email enumeration), so a random one nobody will
// ever use is generated here and thrown away immediately after.
function ephemeralClient() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function editorExists(): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc('gantt_editor_exists')
  if (error) throw error
  return Boolean(data)
}

/** Bootstrap the very first Editor account. They sign in the same way as everyone else — via the emailed link. */
export async function bootstrapFirstEditor(fullName: string, email: string) {
  const client = ephemeralClient()
  const { data, error } = await client.auth.signUp({ email, password: randomPassword() })
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

/** An existing Editor creates any other account (Editor or Viewer) — no password to set or share. */
export async function createAccount(fullName: string, email: string, role: AppRole) {
  const client = ephemeralClient()
  const { data, error } = await client.auth.signUp({ email, password: randomPassword() })
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

/** Sends a sign-in link to the given email — the only way in, for every role. */
export async function requestMagicLink(email: string) {
  const { error } = await requireSupabase().auth.signInWithOtp({ email })
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
