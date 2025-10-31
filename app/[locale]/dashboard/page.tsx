import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth-helpers'
import { getDashboardPath } from '@/lib/auth-helpers'

export default async function DashboardPage({ params: { locale } }: { params: { locale: string } }) {
  const user = await getCurrentUser()

  if (!user) {
    redirect(`/${locale}/auth/signin`)
  }

  // Redirect to role-specific dashboard
  const dashboardPath = getDashboardPath(user.role, locale)
  redirect(dashboardPath)
}
