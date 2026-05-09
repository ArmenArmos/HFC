import { requirePatient } from '@/lib/auth-helpers'
import { getSpecialties } from '@/lib/actions/cases'
import { WizardProvider } from '@/components/patient/case-wizard/wizard-context'
import { WizardShell } from '@/components/patient/case-wizard/wizard-shell'

export default async function NewCasePage({ params: { locale } }: { params: { locale: string } }) {
  await requirePatient(locale)
  const specialties = await getSpecialties()

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Case</h1>
        <p className="mt-1 text-sm text-gray-500">Submit a new case for specialist review</p>
      </div>
      <WizardProvider>
        <WizardShell specialties={specialties.map((s) => ({ id: s.id, nameEn: s.nameEn }))} />
      </WizardProvider>
    </div>
  )
}
