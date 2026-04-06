import { requirePatient } from '@/lib/auth-helpers'
import { getSpecialties } from '@/lib/actions/cases'
import { WizardProvider } from '@/components/patient/case-wizard/wizard-context'
import { WizardShell } from '@/components/patient/case-wizard/wizard-shell'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function NewCasePage({ params: { locale } }: { params: { locale: string } }) {
  await requirePatient(locale)
  const specialties = await getSpecialties()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/patient/dashboard`} className="text-sm text-blue-600 hover:underline">
            ← Back to Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">New Case</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <WizardProvider>
          <WizardShell specialties={specialties.map((s) => ({ id: s.id, nameEn: s.nameEn }))} />
        </WizardProvider>
      </main>
    </div>
  )
}
