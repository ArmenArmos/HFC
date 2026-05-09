import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorCases } from '@/lib/actions/doctor'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  ASSIGNED: 'secondary', IN_REVIEW: 'default', AWAITING_INFO: 'warning', COMPLETED: 'success', CANCELLED: 'destructive',
}
const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Assigned', IN_REVIEW: 'In Review', AWAITING_INFO: 'Awaiting Info', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

export default async function DoctorCasesPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string }
  searchParams: { filter?: string }
}) {
  await requireDoctor(locale)
  const filter = searchParams.filter
  const cases = await getDoctorCases(filter as any)

  const tabs = [
    { label: 'All', value: undefined },
    { label: 'Assigned', value: 'ASSIGNED' },
    { label: 'In Review', value: 'IN_REVIEW' },
    { label: 'Completed', value: 'COMPLETED' },
  ]

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Cases</h1>
        <p className="mt-1 text-sm text-gray-500">{cases.length} case{cases.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Filter tabs */}
      <div className="mb-6 flex gap-2 border-b pb-3">
        {tabs.map((tab) => (
          <Link key={tab.label} href={tab.value ? `?filter=${tab.value}` : '?'}>
            <button className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === tab.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}>
              {tab.label}
            </button>
          </Link>
        ))}
      </div>

      {cases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-white py-24 text-center">
          <div className="mb-4 text-5xl">📋</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-800">No cases found</h2>
          <p className="text-gray-500">Cases assigned to you will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const patient = (c as any).patient?.user
            const isOverdue = c.dueDate && new Date(c.dueDate) < new Date() && c.status !== 'COMPLETED'
            return (
              <Link key={c.id} href={`/${locale}/doctor/cases/${c.id}`}>
                <div className={`flex items-start justify-between rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md hover:border-blue-200 ${
                  isOverdue ? 'border-red-200 bg-red-50' : ''
                }`}>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{c.caseNumber}</span>
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                      {c.priority === 'EXPRESS' && <Badge variant="warning">⚡ Express</Badge>}
                      {isOverdue && <Badge variant="destructive">Overdue</Badge>}
                    </div>
                    <h3 className="truncate font-semibold text-gray-900">{c.title}</h3>
                    <p className="mt-0.5 text-sm text-gray-500">
                      {(c as any).specialty?.nameEn} · Patient: {patient?.name ?? 'Unknown'}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Assigned {formatDate(c.assignedAt ?? c.createdAt, locale)}
                      {c.dueDate && (
                        <span className={isOverdue ? 'ml-2 font-medium text-red-500' : 'ml-2'}>
                          · Due {formatDate(c.dueDate, locale)}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="ml-4 mt-1 text-gray-400">→</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
