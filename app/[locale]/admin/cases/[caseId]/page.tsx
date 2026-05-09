import { requireAdmin } from '@/lib/auth-helpers'
import { getAdminCase, getAvailableDoctors } from '@/lib/actions/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { CaseStatusForm } from '@/components/admin/case-status-form'
import { MessageThread } from '@/components/case/message-thread'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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

export default async function AdminCaseDetailPage({
  params: { locale, caseId },
}: {
  params: { locale: string; caseId: string }
}) {
  await requireAdmin(locale)
  const session = await getServerSession(authOptions)
  const [c, doctors] = await Promise.all([getAdminCase(caseId), getAvailableDoctors()])
  if (!c) notFound()

  const patient = (c as any).patient?.user
  const doctor = (c as any).doctor
  const messages = (c as any).messages ?? []
  const notes = (c as any).internalNotes ?? []

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <Link href={`/${locale}/admin/cases`} className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">← All Cases</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{c.title}</h1>
              <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{c.status.replace(/_/g, ' ')}</Badge>
              {c.priority === 'EXPRESS' && <span className="text-sm font-medium text-amber-600">⚡ Express</span>}
            </div>
            <p className="mt-1 font-mono text-xs text-gray-400">{c.caseNumber}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: case info */}
        <div className="space-y-6 lg:col-span-2">
          {/* Patient & Doctor */}
          <Card>
            <CardHeader><CardTitle className="text-base">People</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Patient" value={patient?.name ?? '—'} />
              <Row label="Patient Email" value={patient?.email ?? '—'} />
              <Row label="Assigned Doctor" value={doctor ? `${doctor.title ?? ''} ${doctor.user?.name ?? '—'}`.trim() : '—'} />
              <Row label="Specialty" value={(c as any).specialty?.nameEn ?? '—'} />
            </CardContent>
          </Card>

          {/* Case details */}
          <Card>
            <CardHeader><CardTitle className="text-base">Case Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Priority" value={c.priority === 'EXPRESS' ? 'Express (1–3 days)' : 'Standard (5–7 days)'} />
              <Row label="Submitted" value={c.submittedAt ? formatDate(c.submittedAt, locale) : 'Not submitted'} />
              <Row label="Assigned" value={(c as any).assignedAt ? formatDate((c as any).assignedAt, locale) : '—'} />
              <Row label="Due Date" value={c.dueDate ? formatDate(c.dueDate, locale) : '—'} />
              <Row label="Completed" value={(c as any).completedAt ? formatDate((c as any).completedAt, locale) : '—'} />
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Chief Complaint</p>
                <p className="whitespace-pre-wrap text-gray-700">{c.chiefComplaint}</p>
              </div>
              {c.questions && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Specific Questions</p>
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
                      <span className="truncate font-medium text-gray-700">{f.fileName}</span>
                      <span className="ml-2 shrink-0 text-xs text-gray-400">{f.fileType}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Opinion */}
          {(c as any).opinion && (
            <Card>
              <CardHeader><CardTitle className="text-base">Specialist Opinion</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Diagnosis</p>
                  <p className="whitespace-pre-wrap text-gray-700">{(c as any).opinion.diagnosis}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Rationale</p>
                  <p className="whitespace-pre-wrap text-gray-700">{(c as any).opinion.rationale}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Recommendations</p>
                  <p className="whitespace-pre-wrap text-gray-700">{(c as any).opinion.recommendations}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Messaging */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Messages</CardTitle>
                <span className="text-xs text-gray-400">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
              </div>
            </CardHeader>
            <CardContent>
              <MessageThread
                caseId={c.id}
                initialMessages={messages}
                currentUserId={session?.user?.id ?? ''}
                currentRole="ADMIN"
              />
            </CardContent>
          </Card>
        </div>

        {/* Right column: admin controls */}
        <div className="space-y-6">
          {/* Status & Assignment */}
          <Card>
            <CardHeader><CardTitle className="text-base">Case Management</CardTitle></CardHeader>
            <CardContent>
              <CaseStatusForm
                caseId={c.id}
                currentStatus={c.status}
                currentDoctorId={c.doctorId}
                doctors={doctors.map((d) => ({
                  id: d.id,
                  title: (d as any).title ?? null,
                  user: { name: (d as any).user?.name ?? null },
                }))}
                locale={locale}
              />
            </CardContent>
          </Card>

          {/* Internal Notes */}
          <Card>
            <CardHeader><CardTitle className="text-base">Internal Notes ({notes.length})</CardTitle></CardHeader>
            <CardContent>
              {notes.length === 0 ? (
                <p className="text-sm text-gray-400">No notes yet.</p>
              ) : (
                <ul className="space-y-3">
                  {notes.map((n: any) => (
                    <li key={n.id} className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.content}</p>
                      <p className="mt-1 text-xs text-gray-400">{formatDate(n.createdAt, locale)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
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
