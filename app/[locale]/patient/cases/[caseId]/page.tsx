import { requirePatient } from '@/lib/auth-helpers'
import { getCase } from '@/lib/actions/cases'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  PENDING_PAYMENT: 'warning',
  ASSIGNED: 'secondary',
  IN_REVIEW: 'default',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
}

export default async function CaseDetailPage({
  params: { locale, caseId },
}: {
  params: { locale: string; caseId: string }
}) {
  await requirePatient(locale)
  const c = await getCase(caseId)
  if (!c) notFound()

  const statusSteps = ['DRAFT', 'PENDING_PAYMENT', 'ASSIGNED', 'IN_REVIEW', 'COMPLETED']
  const currentIdx = statusSteps.indexOf(c.status)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/patient/cases`} className="text-sm text-blue-600 hover:underline">
            ← My Cases
          </Link>
          <h1 className="text-lg font-semibold">{c.caseNumber}</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-8">
        {/* Status tracker */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{c.title}</CardTitle>
              <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{c.status.replace(/_/g, ' ')}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-0">
              {statusSteps.map((s, i) => (
                <div key={s} className="flex flex-1 items-center">
                  <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    i < currentIdx ? 'bg-green-500 text-white'
                    : i === currentIdx ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-400'
                  }`}>
                    {i < currentIdx ? '✓' : i + 1}
                  </div>
                  {i < statusSteps.length - 1 && (
                    <div className={`h-1 flex-1 ${i < currentIdx ? 'bg-green-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-gray-400">
              {statusSteps.map((s) => (
                <span key={s} className="flex-1 text-center first:text-left last:text-right">
                  {s.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
            {c.dueDate && (
              <p className="mt-3 text-sm text-gray-500">
                Expected by: <strong>{formatDate(c.dueDate, locale)}</strong>
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Case details */}
          <Card>
            <CardHeader><CardTitle className="text-base">Case Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Specialty" value={c.specialty?.nameEn ?? '—'} />
              <Row label="Priority" value={c.priority === 'EXPRESS' ? '⚡ Express (1–3 days)' : 'Standard (5–7 days)'} />
              <Row label="Submitted" value={c.submittedAt ? formatDate(c.submittedAt, locale) : 'Not yet submitted'} />
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Chief Complaint</p>
                <p className="whitespace-pre-wrap text-gray-700">{c.chiefComplaint}</p>
              </div>
              {c.questions && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Questions</p>
                  <p className="whitespace-pre-wrap text-gray-700">{c.questions}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader><CardTitle className="text-base">Documents ({c.files.length})</CardTitle></CardHeader>
            <CardContent>
              {c.files.length === 0 ? (
                <p className="text-sm text-gray-400">No documents uploaded.</p>
              ) : (
                <ul className="space-y-2">
                  {c.files.map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                      <span className="truncate">{f.fileName}</span>
                      <span className="ml-2 text-xs text-gray-400">{f.fileType}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Opinion */}
          {c.opinion && (
            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-base">Specialist Opinion</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Diagnosis</p>
                  <p className="whitespace-pre-wrap text-gray-700">{c.opinion.diagnosis}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Rationale</p>
                  <p className="whitespace-pre-wrap text-gray-700">{c.opinion.rationale}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Recommendations</p>
                  <p className="whitespace-pre-wrap text-gray-700">{c.opinion.recommendations}</p>
                </div>
                {c.opinion.pdfUrl && (
                  <a href={c.opinion.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm">📄 Download Opinion PDF</Button>
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* Payment pending action */}
          {c.status === 'PENDING_PAYMENT' && (
            <Card className="border-yellow-300 bg-yellow-50 md:col-span-2">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-semibold text-yellow-800">Payment Required</p>
                  <p className="text-sm text-yellow-700">
                    Complete payment to have your case reviewed by a specialist.
                  </p>
                </div>
                <Link href={`/${locale}/patient/cases/${c.id}/payment`}>
                  <Button>Pay Now →</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-right text-gray-700">{value}</span>
    </div>
  )
}
