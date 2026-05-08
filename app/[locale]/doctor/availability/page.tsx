import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorAvailability } from '@/lib/actions/doctor'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AvailabilityForm } from '@/components/doctor/availability-form'

export default async function DoctorAvailabilityPage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  await requireDoctor(locale)
  const availability = await getDoctorAvailability()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/doctor/dashboard`} className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold">Availability</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Weekly Schedule</CardTitle>
            <p className="text-sm text-gray-500">
              Set your weekly availability. Cases will only be assigned on days and times you are available.
            </p>
          </CardHeader>
          <CardContent>
            <AvailabilityForm initialSlots={availability} />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
