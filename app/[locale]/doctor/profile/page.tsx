import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorProfile } from '@/lib/actions/doctor'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DoctorProfileForm } from '@/components/doctor/doctor-profile-form'

export default async function DoctorProfilePage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  await requireDoctor(locale)
  const profile = await getDoctorProfile()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/doctor/dashboard`} className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold">My Profile</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-8">
        {profile?.status === 'PENDING_VERIFICATION' && (
          <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <strong>Verification Pending:</strong> Your profile is under review. You will be notified
            once verified and able to accept cases.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Professional Information</CardTitle>
          </CardHeader>
          <CardContent>
            <DoctorProfileForm profile={profile} />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
