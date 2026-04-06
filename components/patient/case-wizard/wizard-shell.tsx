'use client'

import { useWizard } from './wizard-context'
import { Progress } from '@/components/ui/progress'
import { Step1Specialty } from './step1-specialty'
import { Step2MedicalHistory } from './step2-medical-history'
import { Step3FileUpload } from './step3-file-upload'
import { Step4Priority } from './step4-priority'
import { Step5Review } from './step5-review'
import { cn } from '@/lib/utils'

const STEPS = [
  { num: 1, label: 'Specialty' },
  { num: 2, label: 'Medical History' },
  { num: 3, label: 'Documents' },
  { num: 4, label: 'Priority' },
  { num: 5, label: 'Review' },
]

export function WizardShell({ specialties }: { specialties: { id: string; nameEn: string }[] }) {
  const { step, totalSteps } = useWizard()
  const progress = ((step - 1) / (totalSteps - 1)) * 100

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header & progress */}
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">New Second Opinion Request</h1>
        <p className="mb-6 text-sm text-gray-500">Step {step} of {totalSteps}</p>
        <Progress value={progress} className="h-2" />

        {/* Step pills */}
        <div className="mt-4 flex justify-between">
          {STEPS.map((s) => (
            <div key={s.num} className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
                  step > s.num
                    ? 'bg-green-500 text-white'
                    : step === s.num
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                )}
              >
                {step > s.num ? '✓' : s.num}
              </div>
              <span className="hidden text-xs text-gray-500 sm:block">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        {step === 1 && <Step1Specialty specialties={specialties} />}
        {step === 2 && <Step2MedicalHistory />}
        {step === 3 && <Step3FileUpload />}
        {step === 4 && <Step4Priority />}
        {step === 5 && <Step5Review specialties={specialties} />}
      </div>
    </div>
  )
}
