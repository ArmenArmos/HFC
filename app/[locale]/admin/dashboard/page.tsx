import { requireAdmin } from '@/lib/auth-helpers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function AdminDashboard({ params: { locale } }: { params: { locale: string } }) {
  const session = await requireAdmin(locale)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <h1 className="text-2xl font-bold text-blue-600">Medical Second Opinion - Admin</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Admin: {session.user.name}</span>
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
          <h2 className="text-3xl font-bold text-gray-900">Admin Dashboard</h2>
          <p className="mt-2 text-gray-600">Manage users, cases, and platform operations</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Total Users</CardTitle>
              <CardDescription>Registered users</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">0</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Cases</CardTitle>
              <CardDescription>Cases in progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">0</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Doctors</CardTitle>
              <CardDescription>Verified specialists</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">0</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organizations</CardTitle>
              <CardDescription>B2B partners</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">0</div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <CardDescription>Manage platform users</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/admin/users`}>
                <Button variant="outline" className="w-full">
                  View Users
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cases</CardTitle>
              <CardDescription>Monitor all cases</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/admin/cases`}>
                <Button variant="outline" className="w-full">
                  View Cases
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Doctors</CardTitle>
              <CardDescription>Manage doctors and verification</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/admin/doctors`}>
                <Button variant="outline" className="w-full">
                  View Doctors
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organizations</CardTitle>
              <CardDescription>Manage B2B organizations</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/admin/organizations`}>
                <Button variant="outline" className="w-full">
                  View Organizations
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Analytics</CardTitle>
              <CardDescription>View platform analytics</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/admin/analytics`}>
                <Button variant="outline" className="w-full">
                  View Analytics
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit Logs</CardTitle>
              <CardDescription>Review system audit logs</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/admin/audit-logs`}>
                <Button variant="outline" className="w-full">
                  View Logs
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
