import { requireDoctor } from '@/lib/auth-helpers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function DoctorDashboard({ params: { locale } }: { params: { locale: string } }) {
  const session = await requireDoctor(locale)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <h1 className="text-2xl font-bold text-blue-600">Medical Second Opinion</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Dr. {session.user.name}</span>
            <Link href={`/${locale}/auth/signout`}>
              <Button variant="outline" size="sm">
                Sign Out
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Doctor Dashboard</h2>
          <p className="mt-2 text-gray-600">Review cases and provide expert medical opinions</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Pending Cases</CardTitle>
              <CardDescription>Cases waiting for review</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">0</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>In Review</CardTitle>
              <CardDescription>Cases currently being reviewed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">0</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Completed</CardTitle>
              <CardDescription>Total cases completed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">0</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rating</CardTitle>
              <CardDescription>Your average rating</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">-</div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Assigned Cases</CardTitle>
              <CardDescription>Cases assigned to you for review</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-8">
                No cases assigned yet. Cases will appear here when assigned to you.
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Manage your professional profile</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/doctor/profile`}>
                <Button variant="outline" className="w-full">
                  Edit Profile
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
              <CardDescription>Set your availability for cases</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/doctor/availability`}>
                <Button variant="outline" className="w-full">
                  Manage Availability
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
