import { requirePatient } from '@/lib/auth-helpers'
import { getPatientProfile } from '@/lib/actions/patient'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PatientProfileForm } from '@/components/patient/patient-profile-form'

export default async function PatientProfilePage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  await requirePatient(locale)
  const profile = await getPatientProfile()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/patient/dashboard`} className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold">My Profile</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-8 space-y-6">
        <Card>
          <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
          <CardContent>
            <PatientProfileForm profile={profile} />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
