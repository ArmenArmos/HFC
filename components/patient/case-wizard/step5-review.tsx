'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWizard } from './wizard-context'
import { submitCase } from '@/lib/actions/cases'
import { Button } from '@/components/ui/button'

interface Props {
  specialties: { id: string; nameEn: string }[]
}

const PRICES = { STANDARD: 199, EXPRESS: 349 }

export function Step5Review({ specialties }: Props) {
  const { data, caseId, prev } = useWizard()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const specialty = specialties.find((s) => s.id === data.specialtyId)

  const handleSubmit = async () => {
    if (!caseId) { setError('Case data missing. Please go back and try again.'); return }
    setIsSubmitting(true)
    try {
      const res = await submitCase(caseId)
      if (!res.success) { setError(res.error ?? 'Failed to submit'); return }
      // Redirect to payment (Stripe) or case confirmation
      router.push(`/patient/cases/${caseId}/payment`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Review Your Request</h2>
        <p className="mt-1 text-sm text-gray-500">
          Please review your information before submitting. You can go back to make changes.
        </p>
      </div>

      <div className="divide-y rounded-lg border bg-gray-50">
        <Section label="Specialty">
          {specialty?.nameEn ?? data.specialtyId ?? '—'}
        </Section>
        <Section label="Case Title">{data.title}</Section>
        <Section label="Chief Complaint">
          <p className="whitespace-pre-wrap text-sm">{data.chiefComplaint}</p>
        </Section>
        {data.questions && (
          <Section label="Questions for Specialist">
            <p className="whitespace-pre-wrap text-sm">{data.questions}</p>
          </Section>
        )}
        {data.medicalHistory && (
          <Section label="Medical History">
            <p className="whitespace-pre-wrap text-sm">{data.medicalHistory}</p>
          </Section>
        )}
        {data.currentMedications && (
          <Section label="Current Medications">
            <p className="whitespace-pre-wrap text-sm">{data.currentMedications}</p>
          </Section>
        )}
        {data.allergies && (
          <Section label="Allergies">{data.allergies}</Section>
        )}
        <Section label="Priority">
          <span className="font-medium">{data.priority === 'EXPRESS' ? 'Express (1–3 days)' : 'Standard (5–7 days)'}</span>
        </Section>
        <Section label="Total Due">
          <span className="text-lg font-bold text-blue-600">
            ${PRICES[data.priority ?? 'STANDARD']} USD
          </span>
        </Section>
      </div>

      <p className="rounded-md bg-yellow-50 px-4 py-3 text-xs text-yellow-800">
        <strong>Privacy Notice:</strong> Your medical information is handled according to our Privacy
        Policy. Files are encrypted at rest and only visible to your assigned specialist and authorized
        staff. You consent to this by submitting.
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={isSubmitting}>← Back</Button>
        <Button onClick={handleSubmit} disabled={isSubmitting} className="min-w-[140px]">
          {isSubmitting ? 'Submitting…' : 'Confirm & Pay →'}
        </Button>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  )
}
