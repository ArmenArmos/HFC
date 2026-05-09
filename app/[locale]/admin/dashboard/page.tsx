import { requireAdmin } from '@/lib/auth-helpers'
import { getAdminStats } from '@/lib/actions/admin'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function AdminDashboard({
  params: { locale },
}: {
  params: { locale: string }
}) {
  await requireAdmin(locale)
  const stats = await getAdminStats()

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Manage users, cases, and platform operations</p>
      </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Users" value={stats.totalUsers} sub={`${stats.activePatients} patients`} />
          <StatCard title="Active Cases" value={stats.activeCases} sub={`${stats.totalCases} total`} highlight />
          <StatCard title="Verified Doctors" value={stats.activeDoctors} sub={`${stats.pendingDoctors} pending`} />
          <StatCard title="Completed Cases" value={stats.completedCases} sub="All time" />
        </div>

        {/* Alerts */}
        {stats.pendingDoctors > 0 && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <span>
              <strong>{stats.pendingDoctors} doctor{stats.pendingDoctors !== 1 ? 's' : ''}</strong> pending verification
            </span>
            <Link href={`/${locale}/admin/doctors?status=PENDING_VERIFICATION`} className="underline font-medium">
              Review →
            </Link>
          </div>
        )}

        {/* Management Links */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <ManageCard
            title="Users"
            description="Manage platform users, roles, and status"
            href={`/${locale}/admin/users`}
          />
          <ManageCard
            title="Cases"
            description="Monitor all cases, assign doctors, update status"
            href={`/${locale}/admin/cases`}
          />
          <ManageCard
            title="Doctors"
            description="Verify specialists and manage credentials"
            href={`/${locale}/admin/doctors`}
            badge={stats.pendingDoctors > 0 ? stats.pendingDoctors : undefined}
          />
          <ManageCard
            title="Organizations"
            description="Manage B2B partners and seat allocations"
            href={`/${locale}/admin/organizations`}
          />
          <ManageCard
            title="Analytics"
            description="View platform metrics and revenue"
            href={`/${locale}/admin/analytics`}
          />
          <ManageCard
            title="Audit Logs"
            description="Review compliance and security logs"
            href={`/${locale}/admin/audit-logs`}
          />
        </div>
    </div>
  )
}

function StatCard({
  title, value, sub, highlight,
}: {
  title: string; value: number; sub: string; highlight?: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className={`mt-1 text-3xl font-bold ${highlight ? 'text-blue-600' : 'text-gray-900'}`}>{value}</p>
        <p className="mt-1 text-xs text-gray-400">{sub}</p>
      </CardContent>
    </Card>
  )
}

function ManageCard({
  title, description, href, badge,
}: {
  title: string; description: string; href: string; badge?: number
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          {badge !== undefined && (
            <span className="rounded-full bg-yellow-500 px-2 py-0.5 text-xs font-bold text-white">
              {badge}
            </span>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={href}>
          <Button variant="outline" className="w-full">Manage →</Button>
        </Link>
      </CardContent>
    </Card>
  )
}
