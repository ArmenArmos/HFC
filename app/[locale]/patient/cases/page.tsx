import { requirePatient } from '@/lib/auth-helpers'
import { getPatientCases } from '@/lib/actions/cases'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  DRAFT: 'outline', PENDING_PAYMENT: 'warning', PAYMENT_PROCESSING: 'warning',
  ASSIGNED: 'secondary', IN_REVIEW: 'default', AWAITING_INFO: 'warning',
  COMPLETED: 'success', CANCELLED: 'destructive',
}
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', PENDING_PAYMENT: 'Pending Payment', PAYMENT_PROCESSING: 'Processing',
  ASSIGNED: 'Assigned', IN_REVIEW: 'In Review', AWAITING_INFO: 'Info Needed',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

export default async function PatientCasesPage({ params: { locale } }: { params: { locale: string } }) {
  await requirePatient(locale)
  const cases = await getPatientCases()

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Cases</h1>
          <p className="mt-1 text-sm text-gray-500">{cases.length} case{cases.length !== 1 ? 's' : ''} total</p>
        </div>
        <Link href={`/${locale}/patient/cases/new`}>
          <Button>+ New Case</Button>
        </Link>
      </div>

      {cases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-white py-24 text-center">
          <div className="mb-4 text-5xl">📋</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-800">No cases yet</h2>
          <p className="mb-6 max-w-xs text-gray-500">Submit your first case to get a world-class second opinion.</p>
          <Link href={`/${locale}/patient/cases/new`}>
            <Button>Create Your First Case</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => (
            <Link key={c.id} href={`/${locale}/patient/cases/${c.id}`}>
              <div className="flex items-start justify-between rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md hover:border-blue-200">
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-gray-400">{c.caseNumber}</span>
                    <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                    {c.priority === 'EXPRESS' && <Badge variant="warning">⚡ Express</Badge>}
                  </div>
                  <h3 className="truncate font-semibold text-gray-900">{c.title}</h3>
                  <p className="mt-0.5 text-sm text-gray-500">{c.specialty?.nameEn}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Created {formatDate(c.createdAt, locale)}
                    {c.dueDate && ` · Due ${formatDate(c.dueDate, locale)}`}
                  </p>
                </div>
                <span className="ml-4 mt-1 text-gray-400">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
