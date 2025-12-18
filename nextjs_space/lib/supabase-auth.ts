import { createClient } from '@/utils/supabase/server'

/**
 * Get the authenticated user from Supabase.
 * Uses the Supabase profiles table for user data.
 */
export async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  // Get or create profile in Supabase
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // If no profile exists, create one
  if (!profile) {
    const { data: newProfile } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email!,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0],
      })
      .select()
      .single()

    return {
      id: user.id,
      email: user.email!,
      name: newProfile?.full_name || user.email?.split('@')[0],
      supabaseUser: user,
    }
  }

  return {
    id: user.id,
    email: user.email!,
    name: profile.full_name || user.email?.split('@')[0],
    supabaseUser: user,
  }
}

/**
 * Get user ID for database operations.
 * Returns the Supabase user ID.
 */
export async function getUserId(): Promise<string | null> {
  const user = await getAuthenticatedUser()
  return user?.id ?? null
}
