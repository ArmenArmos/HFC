import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorAvailability } from '@/lib/actions/doctor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AvailabilityForm } from '@/components/doctor/availability-form'

export default async function DoctorAvailabilityPage({ params: { locale } }: { params: { locale: string } }) {
  await requireDoctor(locale)
  const availability = await getDoctorAvailability()

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Availability</h1>
        <p className="mt-1 text-sm text-gray-500">Set your weekly schedule for accepting cases</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Weekly Schedule</CardTitle>
          <p className="text-sm text-gray-500 mt-1">Cases will only be assigned on days and times you are available.</p>
        </CardHeader>
        <CardContent>
          <AvailabilityForm initialSlots={availability} />
        </CardContent>
      </Card>
    </div>
  )
}
