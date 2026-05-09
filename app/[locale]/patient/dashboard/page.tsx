import { requirePatient } from '@/lib/auth-helpers'
import { getPatientDashboardData } from '@/lib/actions/patient'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  DRAFT: 'outline', PENDING_PAYMENT: 'warning', ASSIGNED: 'secondary',
  IN_REVIEW: 'default', AWAITING_INFO: 'warning', COMPLETED: 'success', CANCELLED: 'destructive',
}
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', PENDING_PAYMENT: 'Pending Payment', ASSIGNED: 'Assigned',
  IN_REVIEW: 'In Review', AWAITING_INFO: 'Info Needed', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

export default async function PatientDashboard({ params: { locale } }: { params: { locale: string } }) {
  const session = await requirePatient(locale)
  const { totalCases, activeCases, completedCases, recentCases } = await getPatientDashboardData()

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-sm text-gray-500 mb-1">Welcome back</p>
        <h1 className="text-2xl font-bold text-gray-900">{session.user.name}</h1>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-gray-500">Total Cases</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{totalCases}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-gray-500">Active</p>
            <p className="mt-1 text-3xl font-bold text-blue-600">{activeCases}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-gray-500">Completed</p>
            <p className="mt-1 text-3xl font-bold text-green-600">{completedCases}</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mb-8 grid gap-6 md:grid-cols-3">
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
              <Button variant="outline" className="w-full">View All Cases</Button>
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
              <Button variant="outline" className="w-full">Edit Profile</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Recent Cases */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Cases</CardTitle>
            {recentCases.length > 0 && (
              <Link href={`/${locale}/patient/cases`} className="text-sm text-blue-600 hover:underline">View all →</Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recentCases.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No cases yet. Create your first case to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {recentCases.map((c) => (
                <Link key={c.id} href={`/${locale}/patient/cases/${c.id}`}>
                  <div className="flex items-center justify-between rounded-lg border p-4 transition hover:bg-gray-50">
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-400">{c.caseNumber}</span>
                        <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                      </div>
                      <p className="truncate font-medium text-gray-900">{c.title}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {(c as any).specialty?.nameEn} · {formatDate(c.createdAt, locale)}
                      </p>
                    </div>
                    <span className="ml-4 text-gray-400">→</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
