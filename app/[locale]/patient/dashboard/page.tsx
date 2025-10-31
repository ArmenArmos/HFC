import { requirePatient } from '@/lib/auth-helpers'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function PatientDashboard({ params: { locale } }: { params: { locale: string } }) {
  const session = await requirePatient(locale)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <h1 className="text-2xl font-bold text-blue-600">Medical Second Opinion</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Welcome, {session.user.name}</span>
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
          <h2 className="text-3xl font-bold text-gray-900">Patient Dashboard</h2>
          <p className="mt-2 text-gray-600">Manage your cases and get expert medical opinions</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>New Case</CardTitle>
              <CardDescription>Submit a new case for expert review</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/patient/cases/new`}>
                <Button className="w-full">Create New Case</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My Cases</CardTitle>
              <CardDescription>View and manage your submitted cases</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/patient/cases`}>
                <Button variant="outline" className="w-full">
                  View All Cases
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Update your personal information</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/patient/profile`}>
                <Button variant="outline" className="w-full">
                  Edit Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Recent Cases</CardTitle>
              <CardDescription>Your most recent case submissions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-8">
                No cases yet. Create your first case to get started.
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
