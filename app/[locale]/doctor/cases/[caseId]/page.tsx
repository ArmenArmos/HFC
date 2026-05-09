import { requireDoctor } from '@/lib/auth-helpers'
import { getDoctorCase } from '@/lib/actions/doctor'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { OpinionEditor } from '@/components/doctor/opinion-editor'
import { MessageThread } from '@/components/case/message-thread'

export default async function DoctorCaseDetailPage({
  params: { locale, caseId },
}: {
  params: { locale: string; caseId: string }
}) {
  const session = await requireDoctor(locale)
  const c = await getDoctorCase(caseId)
  if (!c) notFound()

  const patient = (c as any).patient?.user
  const isEditable = ['ASSIGNED', 'IN_REVIEW', 'AWAITING_INFO'].includes(c.status)
  const messages = (c as any).messages ?? []

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link href={`/${locale}/doctor/cases`} className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">← Cases</Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{c.title}</h1>
            <p className="mt-1 font-mono text-xs text-gray-400">{c.caseNumber}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Badge variant={c.status === 'COMPLETED' ? 'success' : c.status === 'IN_REVIEW' ? 'default' : 'secondary'}>
              {c.status.replace(/_/g, ' ')}
            </Badge>
            {c.priority === 'EXPRESS' && <Badge variant="warning">⚡ Express</Badge>}
          </div>
        </div>
      </div>

      {/* Case overview */}
      <Card className="mb-6">
        <CardContent className="grid gap-4 sm:grid-cols-2 text-sm pt-5">
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

      {/* Chief Complaint */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Chief Complaint</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="whitespace-pre-wrap text-gray-700">{c.chiefComplaint}</p>
          {c.questions && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Specific Questions</p>
              <p className="whitespace-pre-wrap text-gray-700">{c.questions}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Medical History */}
      {(c.medicalHistory || c.currentMedications || c.allergies) && (
        <Card className="mb-6">
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
      <Card className="mb-6">
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
      <div className="mb-6">
        <OpinionEditor
          caseId={c.id}
          locale={locale}
          existingOpinion={(c as any).opinion}
          isEditable={isEditable}
        />
      </div>

      {/* Messaging */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Messages with Patient</CardTitle>
            {messages.length > 0 && (
              <span className="text-xs text-gray-400">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <MessageThread
            caseId={c.id}
            initialMessages={messages}
            currentUserId={session.user.id}
            currentRole="DOCTOR"
          />
        </CardContent>
      </Card>
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
