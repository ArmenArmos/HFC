import { requirePatient } from '@/lib/auth-helpers'
import { getPatientProfile } from '@/lib/actions/patient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PatientProfileForm } from '@/components/patient/patient-profile-form'

export default async function PatientProfilePage({ params: { locale } }: { params: { locale: string } }) {
  await requirePatient(locale)
  const profile = await getPatientProfile()

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your personal and medical information</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
        <CardContent>
          <PatientProfileForm profile={profile} />
        </CardContent>
      </Card>
    </div>
  )
}
