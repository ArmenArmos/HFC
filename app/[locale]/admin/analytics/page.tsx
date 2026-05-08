import { requireAdmin } from '@/lib/auth-helpers'
import { getAnalytics } from '@/lib/actions/admin'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_PAYMENT: 'Pending Payment',
  PAYMENT_PROCESSING: 'Processing',
  ASSIGNED: 'Assigned',
  IN_REVIEW: 'In Review',
  AWAITING_INFO: 'Awaiting Info',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-500',
  IN_REVIEW: 'bg-blue-500',
  ASSIGNED: 'bg-indigo-400',
  PENDING_PAYMENT: 'bg-yellow-400',
  AWAITING_INFO: 'bg-orange-400',
  DRAFT: 'bg-gray-300',
  CANCELLED: 'bg-red-400',
  PAYMENT_PROCESSING: 'bg-yellow-500',
}

export default async function AdminAnalyticsPage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  await requireAdmin(locale)
  const data = await getAnalytics()

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Failed to load analytics.</p>
      </div>
    )
  }

  const totalCases = data.casesByStatus.reduce((sum: number, s: any) => sum + s._count._all, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/admin/dashboard`} className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold">Analytics</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Top KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Revenue" value={formatCurrency(data.totalRevenue, 'USD', locale)} sub="All time" />
          <StatCard title="Cases (Last 30d)" value={data.last30DayCases.toString()} sub={`${data.last7DayCases} in last 7 days`} />
          <StatCard title="New Users (30d)" value={data.newUsers30d.toString()} sub="New registrations" />
          <StatCard title="Total Cases" value={totalCases.toString()} sub="All time" />
        </div>

        {/* Cases by Status */}
        <Card>
          <CardHeader><CardTitle>Cases by Status</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.casesByStatus.map((s: any) => {
                const pct = totalCases > 0 ? Math.round((s._count._all / totalCases) * 100) : 0
                return (
                  <div key={s.status}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">{STATUS_LABELS[s.status] ?? s.status}</span>
                      <span className="text-gray-500">{s._count._all} ({pct}%)</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full transition-all ${STATUS_COLORS[s.status] ?? 'bg-gray-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              {data.casesByStatus.length === 0 && (
                <p className="text-sm text-gray-400">No data yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cases by Priority */}
        <Card>
          <CardHeader><CardTitle>Cases by Priority</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-8">
              {data.casesByPriority.map((p: any) => (
                <div key={p.priority} className="text-center">
                  <div className="text-3xl font-bold text-gray-900">{p._count._all}</div>
                  <div className="mt-1 text-sm text-gray-500">{p.priority === 'EXPRESS' ? '⚡ Express' : 'Standard'}</div>
                </div>
              ))}
              {data.casesByPriority.length === 0 && (
                <p className="text-sm text-gray-400">No data yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

function StatCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
        <p className="mt-1 text-xs text-gray-400">{sub}</p>
      </CardContent>
    </Card>
  )
}
