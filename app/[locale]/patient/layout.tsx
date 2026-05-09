import { requirePatient } from '@/lib/auth-helpers'
import { AppSidebar } from '@/components/layout/sidebar'

export default async function PatientLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const session = await requirePatient(locale)
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      <AppSidebar role="patient" userName={session.user.name ?? 'Patient'} locale={locale} />
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }} className="pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  )
}
