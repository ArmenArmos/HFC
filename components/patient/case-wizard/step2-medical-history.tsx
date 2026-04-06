'use client'

import { useState } from 'react'
import { useWizard } from './wizard-context'
import { step2Schema } from '@/lib/validation/case'
import { updateDraftCase } from '@/lib/actions/cases'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function Step2MedicalHistory() {
  const { data, caseId, updateData, next, prev } = useWizard()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)

  const [form, setForm] = useState({
    medicalHistory: data.medicalHistory ?? '',
    currentMedications: data.currentMedications ?? '',
    allergies: data.allergies ?? '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }))

  const handleNext = async () => {
    const result = step2Schema.safeParse(form)
    if (!result.success) {
      const errs: Record<string, string> = {}
      result.error.errors.forEach((e) => { if (e.path[0]) errs[e.path[0] as string] = e.message })
      setErrors(errs)
      return
    }
    setErrors({})
    setIsLoading(true)
    updateData(form)

    try {
      if (caseId) {
        const res = await updateDraftCase(caseId, form)
        if (!res.success) { setErrors({ _form: res.error ?? 'Failed to save' }); return }
      }
      next()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Medical History</h2>
        <p className="mt-1 text-sm text-gray-500">
          Provide your relevant medical background to help the specialist give an accurate opinion.
          All fields are optional but more context leads to better opinions.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="medicalHistory">Relevant Medical History</Label>
        <Textarea
          id="medicalHistory"
          name="medicalHistory"
          placeholder="Past diagnoses, surgeries, hospitalizations, family history relevant to your condition…"
          value={form.medicalHistory}
          onChange={handleChange}
          disabled={isLoading}
          rows={5}
          maxLength={3000}
        />
        <p className="text-right text-xs text-gray-400">{form.medicalHistory.length}/3000</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="currentMedications">Current Medications</Label>
        <Textarea
          id="currentMedications"
          name="currentMedications"
          placeholder="List all medications, dosages, and frequency (e.g. Metformin 500mg twice daily)…"
          value={form.currentMedications}
          onChange={handleChange}
          disabled={isLoading}
          rows={3}
          maxLength={2000}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="allergies">Allergies</Label>
        <Textarea
          id="allergies"
          name="allergies"
          placeholder="Drug allergies, food allergies, environmental allergies and reactions…"
          value={form.allergies}
          onChange={handleChange}
          disabled={isLoading}
          rows={2}
          maxLength={1000}
        />
      </div>

      {errors._form && <p className="text-sm text-red-500">{errors._form}</p>}

      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={isLoading}>← Back</Button>
        <Button onClick={handleNext} disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Next →'}
        </Button>
      </div>
    </div>
  )
}
