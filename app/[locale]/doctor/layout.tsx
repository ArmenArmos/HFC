import { requireDoctor } from '@/lib/auth-helpers'
import { AppSidebar } from '@/components/layout/sidebar'
import { getUnreadCounts } from '@/lib/actions/settings'

export default async function DoctorLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const session = await requireDoctor(locale)
  const notifications = await getUnreadCounts()
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      <AppSidebar role="doctor" userName={session.user.name ?? 'Doctor'} locale={locale} notifications={notifications} />
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }} className="pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  )
}
