import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorStats, getDoctorCases } from '@/lib/actions/doctor'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

export default async function DoctorDashboard({
  params: { locale },
}: {
  params: { locale: string }
}) {
  const session = await requireDoctor(locale)
  const [stats, recentCases] = await Promise.all([
    getDoctorStats(),
    getDoctorCases(),
  ])

  const activeCases = recentCases.filter((c) =>
    ['ASSIGNED', 'IN_REVIEW', 'AWAITING_INFO'].includes(c.status)
  ).slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <h1 className="text-2xl font-bold text-blue-600">Medical Second Opinion</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Dr. {session.user.name}</span>
            <Link href={`/${locale}/auth/signout`}>
              <Button variant="outline" size="sm">Sign Out</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Doctor Dashboard</h2>
          <p className="mt-2 text-gray-600">Review cases and provide expert medical opinions</p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-gray-500">Pending</p>
              <p className="mt-1 text-3xl font-bold text-amber-500">{stats.pending}</p>
              <p className="mt-1 text-xs text-gray-400">Awaiting review start</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-gray-500">In Review</p>
              <p className="mt-1 text-3xl font-bold text-blue-600">{stats.inReview}</p>
              <p className="mt-1 text-xs text-gray-400">Currently being reviewed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-gray-500">Completed</p>
              <p className="mt-1 text-3xl font-bold text-green-600">{stats.completed}</p>
              <p className="mt-1 text-xs text-gray-400">Total opinions submitted</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-gray-500">Rating</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">
                {stats.rating ? `${stats.rating.toFixed(1)} ★` : '—'}
              </p>
              <p className="mt-1 text-xs text-gray-400">Average patient rating</p>
            </CardContent>
          </Card>
        </div>

        {/* Active Cases */}
        <div className="mb-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Active Cases</CardTitle>
                <Link href={`/${locale}/doctor/cases`} className="text-sm text-blue-600 hover:underline">
                  View all →
                </Link>
              </div>
              <CardDescription>Cases assigned to you for review</CardDescription>
            </CardHeader>
            <CardContent>
              {activeCases.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  No active cases. Cases will appear here when assigned to you.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeCases.map((c) => {
                    const isOverdue = c.dueDate && new Date(c.dueDate) < new Date()
                    return (
                      <Link key={c.id} href={`/${locale}/doctor/cases/${c.id}`}>
                        <div className={`flex items-center justify-between rounded-lg border p-4 transition hover:bg-gray-50 ${isOverdue ? 'border-red-200 bg-red-50' : ''}`}>
                          <div className="min-w-0">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="font-mono text-xs text-gray-400">{c.caseNumber}</span>
                              {c.priority === 'EXPRESS' && <Badge variant="warning">⚡ Express</Badge>}
                              {isOverdue && <Badge variant="destructive">Overdue</Badge>}
                            </div>
                            <p className="truncate font-medium text-gray-900">{c.title}</p>
                            <p className="mt-0.5 text-xs text-gray-400">
                              {(c as any).specialty?.nameEn}
                              {c.dueDate && ` · Due ${formatDate(c.dueDate, locale)}`}
                            </p>
                          </div>
                          <span className="ml-4 text-gray-400">→</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Links */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Manage your professional profile</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/${locale}/doctor/profile`}>
                <Button variant="outline" className="w-full">Edit Profile</Button>
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
                <Button variant="outline" className="w-full">Manage Availability</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
