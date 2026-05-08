import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorCase } from '@/lib/actions/doctor'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { OpinionEditor } from '@/components/doctor/opinion-editor'

export default async function DoctorCaseDetailPage({
  params: { locale, caseId },
}: {
  params: { locale: string; caseId: string }
}) {
  await requireDoctor(locale)
  const c = await getDoctorCase(caseId)
  if (!c) notFound()

  const patient = (c as any).patient?.user
  const isEditable = ['ASSIGNED', 'IN_REVIEW', 'AWAITING_INFO'].includes(c.status)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/doctor/cases`} className="text-sm text-blue-600 hover:underline">
            ← My Cases
          </Link>
          <h1 className="text-lg font-semibold">{c.caseNumber}</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-8 max-w-4xl">
        {/* Case overview */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="text-xl">{c.title}</CardTitle>
              <div className="flex gap-2 shrink-0">
                <Badge variant={c.status === 'COMPLETED' ? 'success' : c.status === 'IN_REVIEW' ? 'default' : 'secondary'}>
                  {c.status.replace(/_/g, ' ')}
                </Badge>
                {c.priority === 'EXPRESS' && <Badge variant="warning">⚡ Express</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 text-sm">
            <Info label="Specialty" value={(c as any).specialty?.nameEn ?? '—'} />
            <Info label="Patient" value={patient?.name ?? 'Unknown'} />
            <Info label="Submitted" value={c.submittedAt ? formatDate(c.submittedAt, locale) : '—'} />
            {c.dueDate && (
              <Info
                label="Due Date"
                value={formatDate(c.dueDate, locale)}
                warn={new Date(c.dueDate) < new Date() && c.status !== 'COMPLETED'}
              />
            )}
            <Info label="Priority" value={c.priority === 'EXPRESS' ? '⚡ Express (1–3 days)' : 'Standard (5–7 days)'} />
          </CardContent>
        </Card>

        {/* Chief Complaint & Questions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Chief Complaint</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="whitespace-pre-wrap text-gray-700">{c.chiefComplaint}</p>
            {c.questions && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Specific Questions
                </p>
                <p className="whitespace-pre-wrap text-gray-700">{c.questions}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Medical History */}
        {(c.medicalHistory || c.currentMedications || c.allergies) && (
          <Card>
            <CardHeader><CardTitle className="text-base">Medical History</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              {c.medicalHistory && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">History</p>
                  <p className="whitespace-pre-wrap text-gray-700">{c.medicalHistory}</p>
                </div>
              )}
              {c.currentMedications && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Medications</p>
                  <p className="whitespace-pre-wrap text-gray-700">{c.currentMedications}</p>
                </div>
              )}
              {c.allergies && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Allergies</p>
                  <p className="whitespace-pre-wrap text-gray-700">{c.allergies}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Documents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documents ({(c as any).files?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {!(c as any).files?.length ? (
              <p className="text-sm text-gray-400">No documents uploaded.</p>
            ) : (
              <ul className="space-y-2">
                {(c as any).files.map((f: any) => (
                  <li key={f.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{f.fileType === 'PDF' ? '📄' : f.fileType === 'IMAGE' ? '🖼️' : '📁'}</span>
                      <span className="truncate font-medium">{f.fileName}</span>
                    </div>
                    <span className="ml-2 shrink-0 text-xs text-gray-400">{f.fileType}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Opinion Editor */}
        <OpinionEditor
          caseId={c.id}
          locale={locale}
          existingOpinion={(c as any).opinion}
          isEditable={isEditable}
        />
      </main>
    </div>
  )
}

function Info({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 ${warn ? 'font-semibold text-red-500' : 'text-gray-700'}`}>{value}</p>
    </div>
  )
}
