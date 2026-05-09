import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorStats, getDoctorCases } from '@/lib/actions/doctor'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

export default async function DoctorDashboard({ params: { locale } }: { params: { locale: string } }) {
  const session = await requireDoctor(locale)
  const [stats, recentCases] = await Promise.all([getDoctorStats(), getDoctorCases()])

  const activeCases = recentCases.filter((c) => ['ASSIGNED', 'IN_REVIEW', 'AWAITING_INFO'].includes(c.status)).slice(0, 5)

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <p className="text-sm text-gray-500 mb-1">Welcome back</p>
        <h1 className="text-2xl font-bold text-gray-900">Dr. {session.user.name}</h1>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-gray-500">Pending</p>
            <p className="mt-1 text-3xl font-bold text-amber-500">{stats.pending}</p>
            <p className="mt-1 text-xs text-gray-400">Awaiting review</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-gray-500">In Review</p>
            <p className="mt-1 text-3xl font-bold text-blue-600">{stats.inReview}</p>
            <p className="mt-1 text-xs text-gray-400">Currently reviewing</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-gray-500">Completed</p>
            <p className="mt-1 text-3xl font-bold text-green-600">{stats.completed}</p>
            <p className="mt-1 text-xs text-gray-400">Total opinions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-gray-500">Rating</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{stats.rating ? `${stats.rating.toFixed(1)} ★` : '—'}</p>
            <p className="mt-1 text-xs text-gray-400">Patient rating</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Cases */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Cases</CardTitle>
            <Link href={`/${locale}/doctor/cases`} className="text-sm text-blue-600 hover:underline">View all →</Link>
          </div>
          <CardDescription>Cases assigned to you for review</CardDescription>
        </CardHeader>
        <CardContent>
          {activeCases.length === 0 ? (
            <div className="py-8 text-center text-gray-500">No active cases. Cases will appear here when assigned.</div>
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
                          {(c as any).specialty?.nameEn}{c.dueDate && ` · Due ${formatDate(c.dueDate, locale)}`}
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

      {/* Quick Links */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Manage your professional profile</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/${locale}/doctor/profile`}>
              <button className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 transition">Edit Profile</button>
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
              <button className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 transition">Manage Schedule</button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
