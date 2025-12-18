import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { Sidebar } from '@/components/sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar user={user} />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
