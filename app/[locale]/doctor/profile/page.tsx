import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorProfile } from '@/lib/actions/doctor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DoctorProfileForm } from '@/components/doctor/doctor-profile-form'

export default async function DoctorProfilePage({ params: { locale } }: { params: { locale: string } }) {
  await requireDoctor(locale)
  const profile = await getDoctorProfile()

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your professional information and credentials</p>
      </div>

      {profile?.status === 'PENDING_VERIFICATION' && (
        <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <strong>Verification Pending:</strong> Your profile is under review. You will be notified once verified and able to accept cases.
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Professional Information</CardTitle></CardHeader>
        <CardContent>
          <DoctorProfileForm profile={profile} />
        </CardContent>
      </Card>
    </div>
  )
}
