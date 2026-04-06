'use client'

import { useState } from 'react'
import { useWizard } from './wizard-context'
import { step1Schema } from '@/lib/validation/case'
import { createDraftCase, updateDraftCase } from '@/lib/actions/cases'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  specialties: { id: string; nameEn: string }[]
}

export function Step1Specialty({ specialties }: Props) {
  const { data, caseId, updateData, setCaseId, next } = useWizard()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)

  const [form, setForm] = useState({
    specialtyId: data.specialtyId ?? '',
    title: data.title ?? '',
    chiefComplaint: data.chiefComplaint ?? '',
    questions: data.questions ?? '',
  })

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }))

  const handleNext = async () => {
    const result = step1Schema.safeParse(form)
    if (!result.success) {
      const errs: Record<string, string> = {}
      result.error.errors.forEach((e) => {
        if (e.path[0]) errs[e.path[0] as string] = e.message
      })
      setErrors(errs)
      return
    }
    setErrors({})
    setIsLoading(true)

    updateData(form)

    try {
      if (!caseId) {
        const res = await createDraftCase(form)
        if (!res.success) { setErrors({ _form: res.error ?? 'Failed to save' }); return }
        setCaseId(res.caseId!)
      } else {
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
        <h2 className="text-xl font-semibold">Specialty & Chief Complaint</h2>
        <p className="mt-1 text-sm text-gray-500">
          Tell us about your medical concern so we can match the right specialist.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="specialtyId">Medical Specialty *</Label>
        <select
          id="specialtyId"
          name="specialtyId"
          value={form.specialtyId}
          onChange={handleChange}
          disabled={isLoading}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <option value="">Select a specialty…</option>
          {specialties.length === 0 && (
            <option value="general">General Medicine</option>
          )}
          {specialties.map((s) => (
            <option key={s.id} value={s.id}>{s.nameEn}</option>
          ))}
        </select>
        {errors.specialtyId && <p className="text-xs text-red-500">{errors.specialtyId}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Case Title *</Label>
        <Input
          id="title"
          name="title"
          placeholder="e.g. Second opinion on knee MRI findings"
          value={form.title}
          onChange={handleChange}
          disabled={isLoading}
          maxLength={200}
        />
        {errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="chiefComplaint">Chief Complaint *</Label>
        <Textarea
          id="chiefComplaint"
          name="chiefComplaint"
          placeholder="Describe your main symptoms, when they started, and what makes them better or worse…"
          value={form.chiefComplaint}
          onChange={handleChange}
          disabled={isLoading}
          rows={5}
          maxLength={2000}
        />
        <p className="text-right text-xs text-gray-400">{form.chiefComplaint.length}/2000</p>
        {errors.chiefComplaint && <p className="text-xs text-red-500">{errors.chiefComplaint}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="questions">Specific Questions for the Specialist</Label>
        <Textarea
          id="questions"
          name="questions"
          placeholder="List any specific questions you want the specialist to address…"
          value={form.questions}
          onChange={handleChange}
          disabled={isLoading}
          rows={3}
          maxLength={1000}
        />
      </div>

      {errors._form && <p className="text-sm text-red-500">{errors._form}</p>}

      <div className="flex justify-end">
        <Button onClick={handleNext} disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Next →'}
        </Button>
      </div>
    </div>
  )
}
