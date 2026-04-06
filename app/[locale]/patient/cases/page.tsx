import { requirePatient } from '@/lib/auth-helpers'
import { getPatientCases } from '@/lib/actions/cases'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

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

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_PAYMENT: 'Pending Payment',
  PAYMENT_PROCESSING: 'Processing',
  ASSIGNED: 'Assigned',
  IN_REVIEW: 'In Review',
  AWAITING_INFO: 'Info Needed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export default async function PatientCasesPage({ params: { locale } }: { params: { locale: string } }) {
  await requirePatient(locale)
  const cases = await getPatientCases()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/patient/dashboard`} className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold">My Cases</h1>
          <Link href={`/${locale}/patient/cases/new`}>
            <Button size="sm">+ New Case</Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {cases.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border bg-white py-20 text-center">
            <div className="mb-4 text-5xl">📋</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-800">No cases yet</h2>
            <p className="mb-6 text-gray-500">Submit your first case to get a world-class second opinion.</p>
            <Link href={`/${locale}/patient/cases/new`}>
              <Button>Create Your First Case</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {cases.map((c) => (
              <Link key={c.id} href={`/${locale}/patient/cases/${c.id}`}>
                <div className="flex items-start justify-between rounded-lg border bg-white p-5 shadow-sm transition hover:shadow-md">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">{c.caseNumber}</span>
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                      {c.priority === 'EXPRESS' && (
                        <Badge variant="warning">⚡ Express</Badge>
                      )}
                    </div>
                    <h3 className="truncate font-semibold text-gray-900">{c.title}</h3>
                    <p className="mt-0.5 text-sm text-gray-500">{c.specialty?.nameEn}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Created {formatDate(c.createdAt, locale)}
                      {c.dueDate && ` · Due ${formatDate(c.dueDate, locale)}`}
                    </p>
                  </div>
                  <span className="ml-4 text-gray-400">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
