import { requireAdmin } from '@/lib/auth-helpers'
import { AppSidebar } from '@/components/layout/sidebar'

export default async function AdminLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const session = await requireAdmin(locale)
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      <AppSidebar role="admin" userName={session.user.name ?? 'Admin'} locale={locale} />
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }} className="pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  )
}
