'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveOpinionDraft, submitOpinion } from '@/lib/actions/doctor'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  caseId: string
  locale: string
  existingOpinion?: {
    diagnosis: string
    rationale: string
    recommendations: string
    differentialDiagnosis?: string | null
    additionalTests?: string | null
    prognosis?: string | null
    guidelines?: string | null
    references?: string | null
    status: string
  } | null
  isEditable: boolean
}

export function OpinionEditor({ caseId, locale, existingOpinion, isEditable }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    diagnosis: existingOpinion?.diagnosis ?? '',
    rationale: existingOpinion?.rationale ?? '',
    recommendations: existingOpinion?.recommendations ?? '',
    differentialDiagnosis: existingOpinion?.differentialDiagnosis ?? '',
    additionalTests: existingOpinion?.additionalTests ?? '',
    prognosis: existingOpinion?.prognosis ?? '',
    guidelines: existingOpinion?.guidelines ?? '',
    references: existingOpinion?.references ?? '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }))
    setSaved(false)
  }

  const handleSaveDraft = async () => {
    if (!form.diagnosis || !form.rationale || !form.recommendations) {
      setError('Diagnosis, rationale, and recommendations are required to save.')
      return
    }
    setIsSaving(true)
    setError('')
    const res = await saveOpinionDraft(caseId, form)
    setIsSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    setSaved(true)
    router.refresh()
  }

  const handleSubmit = async () => {
    if (!form.diagnosis || !form.rationale || !form.recommendations) {
      setError('Please complete all required fields before submitting.')
      return
    }
    setIsSubmitting(true)
    setError('')
    const res = await submitOpinion(caseId, form)
    setIsSubmitting(false)
    if (!res.success) { setError(res.error ?? 'Failed to submit'); return }
    router.push(`/${locale}/doctor/cases`)
    router.refresh()
  }

  if (!isEditable && !existingOpinion) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Opinion</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">No opinion submitted yet.</p>
        </CardContent>
      </Card>
    )
  }

  if (!isEditable && existingOpinion) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Submitted Opinion</CardTitle>
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
              Completed
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Section label="Diagnosis">{existingOpinion.diagnosis}</Section>
          <Section label="Rationale">{existingOpinion.rationale}</Section>
          <Section label="Recommendations">{existingOpinion.recommendations}</Section>
          {existingOpinion.differentialDiagnosis && (
            <Section label="Differential Diagnosis">{existingOpinion.differentialDiagnosis}</Section>
          )}
          {existingOpinion.prognosis && (
            <Section label="Prognosis">{existingOpinion.prognosis}</Section>
          )}
          {existingOpinion.additionalTests && (
            <Section label="Additional Tests">{existingOpinion.additionalTests}</Section>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={existingOpinion?.status === 'DRAFT' ? 'border-yellow-300' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {existingOpinion ? 'Edit Opinion' : 'Write Opinion'}
          </CardTitle>
          {existingOpinion?.status === 'DRAFT' && (
            <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-800">
              Draft saved
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md bg-blue-50 px-4 py-3 text-xs text-blue-800">
          <strong>Instructions:</strong> Provide a thorough, evidence-based second opinion.
          Fields marked * are required. Once submitted, the patient will be notified.
        </div>

        <Field
          label="Diagnosis *"
          name="diagnosis"
          value={form.diagnosis}
          onChange={handleChange}
          placeholder="Your primary diagnosis based on the submitted information and records…"
          rows={4}
        />
        <Field
          label="Clinical Rationale *"
          name="rationale"
          value={form.rationale}
          onChange={handleChange}
          placeholder="Explain your reasoning, relevant findings, and how you arrived at the diagnosis…"
          rows={5}
        />
        <Field
          label="Recommendations *"
          name="recommendations"
          value={form.recommendations}
          onChange={handleChange}
          placeholder="Specific treatment recommendations, next steps, or referrals…"
          rows={4}
        />
        <Field
          label="Differential Diagnosis"
          name="differentialDiagnosis"
          value={form.differentialDiagnosis}
          onChange={handleChange}
          placeholder="Alternative diagnoses considered and why they were ruled out…"
          rows={3}
        />
        <Field
          label="Prognosis"
          name="prognosis"
          value={form.prognosis}
          onChange={handleChange}
          placeholder="Expected outcome with and without treatment…"
          rows={2}
        />
        <Field
          label="Additional Tests / Investigations"
          name="additionalTests"
          value={form.additionalTests}
          onChange={handleChange}
          placeholder="Any additional tests that should be ordered…"
          rows={2}
        />
        <Field
          label="Clinical Guidelines & References"
          name="references"
          value={form.references}
          onChange={handleChange}
          placeholder="Relevant clinical guidelines (e.g. AHA 2023), journal references…"
          rows={2}
        />

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        {saved && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Draft saved successfully.</p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={handleSaveDraft} disabled={isSaving || isSubmitting}>
            {isSaving ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving || isSubmitting}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting ? 'Submitting…' : 'Submit Final Opinion →'}
          </Button>
        </div>
        <p className="text-xs text-gray-400">
          Once submitted, the patient will receive their opinion. This action cannot be undone.
        </p>
      </CardContent>
    </Card>
  )
}

function Field({
  label, name, value, onChange, placeholder, rows,
}: {
  label: string; name: string; value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder: string; rows?: number
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows ?? 3}
      />
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="whitespace-pre-wrap text-gray-800">{children}</p>
    </div>
  )
}
