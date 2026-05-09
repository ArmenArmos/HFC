import { requireAdmin } from '@/lib/auth-helpers'
import { getAllCases, getAvailableDoctors } from '@/lib/actions/admin'
import { CaseStatus } from '@prisma/client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { CaseAssignActions } from '@/components/admin/case-assign-actions'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  PENDING_PAYMENT: 'warning',
  PAYMENT_PROCESSING: 'warning',
  ASSIGNED: 'secondary',
  IN_REVIEW: 'default',
  AWAITING_INFO: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
}

export default async function AdminCasesPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string }
  searchParams: { status?: string; search?: string }
}) {
  await requireAdmin(locale)
  const [cases, doctors] = await Promise.all([
    getAllCases({
      status: searchParams.status as CaseStatus | undefined,
      search: searchParams.search,
    }),
    getAvailableDoctors(),
  ])

  return (
    <div className="p-6 lg:p-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Cases</h1>
{/* Filters */}
        <form method="GET" className="mb-6 flex flex-wrap gap-3">
          <input
            name="search"
            defaultValue={searchParams.search}
            placeholder="Search case # or title…"
            className="rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <select name="status" defaultValue={searchParams.status ?? ''} className="rounded-md border border-input bg-white px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            {Object.values(CaseStatus).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Filter
          </button>
          <Link href={`/${locale}/admin/cases`} className="rounded-md border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Clear
          </Link>
        </form>

        <p className="mb-3 text-sm text-gray-500">{cases.length} case{cases.length !== 1 ? 's' : ''} found</p>

        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Case</th>
                <th className="px-4 py-3 text-left">Patient</th>
                <th className="px-4 py-3 text-left">Specialty</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Doctor</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cases.map((c) => {
                const patient = (c as any).patient?.user
                const doctor = (c as any).doctor?.user
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-gray-500">{c.caseNumber}</p>
                      <p className="mt-0.5 max-w-xs truncate font-medium text-gray-900">{c.title}</p>
                      {c.priority === 'EXPRESS' && (
                        <span className="text-xs font-medium text-amber-600">⚡ Express</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{patient?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{(c as any).specialty?.nameEn ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>
                        {c.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{doctor?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(c.createdAt, locale)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/${locale}/admin/cases/${c.id}`}
                          className="rounded-md border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          View
                        </Link>
                        <CaseAssignActions
                          caseId={c.id}
                          currentStatus={c.status}
                          currentDoctorId={c.doctorId}
                          doctors={doctors.map((d) => ({
                            id: d.id,
                            name: (d as any).user?.name ?? d.id,
                          }))}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {cases.length === 0 && (
            <div className="py-12 text-center text-gray-400">No cases found.</div>
          )}
        </div>
    </div>
  )
}
