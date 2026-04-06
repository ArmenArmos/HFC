'use client'

import { useState } from 'react'
import { useWizard } from './wizard-context'
import { updateDraftCase } from '@/lib/actions/cases'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PLANS = [
  {
    value: 'STANDARD' as const,
    label: 'Standard',
    turnaround: '5–7 business days',
    price: '$199',
    description: 'Comprehensive written second opinion from a verified specialist.',
    features: ['Written opinion (PDF)', 'Diagnosis & rationale', 'Treatment recommendations', 'Reference guidelines'],
  },
  {
    value: 'EXPRESS' as const,
    label: 'Express',
    turnaround: '1–3 business days',
    price: '$349',
    description: 'Priority review for urgent cases — the same quality, faster.',
    features: ['Everything in Standard', 'Priority assignment', 'Faster turnaround', 'Progress notifications'],
    highlighted: true,
  },
]

export function Step4Priority() {
  const { data, caseId, updateData, next, prev } = useWizard()
  const [selected, setSelected] = useState<'STANDARD' | 'EXPRESS'>(data.priority ?? 'STANDARD')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleNext = async () => {
    setIsLoading(true)
    updateData({ priority: selected })
    try {
      if (caseId) {
        const res = await updateDraftCase(caseId, { priority: selected })
        if (!res.success) { setError(res.error ?? 'Failed to save'); return }
      }
      next()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Select Priority</h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose how quickly you need your second opinion.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <button
            key={plan.value}
            type="button"
            onClick={() => setSelected(plan.value)}
            className={cn(
              'relative rounded-lg border-2 p-5 text-left transition-all',
              selected === plan.value
                ? 'border-blue-600 bg-blue-50 shadow-md'
                : 'border-gray-200 bg-white hover:border-gray-300',
              plan.highlighted && selected !== plan.value && 'border-blue-200'
            )}
          >
            {plan.highlighted && (
              <span className="absolute right-3 top-3 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                Popular
              </span>
            )}
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900">{plan.price}</span>
              <span className="text-sm text-gray-500">/ case</span>
            </div>
            <p className="mb-1 font-semibold text-gray-800">{plan.label}</p>
            <p className="mb-3 text-xs font-medium text-blue-600">⏱ {plan.turnaround}</p>
            <p className="mb-3 text-sm text-gray-500">{plan.description}</p>
            <ul className="space-y-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="text-green-500">✓</span> {f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Payment is collected after you review and confirm your case in the next step.
        We accept Visa, Mastercard, and American Express via Stripe.
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={isLoading}>← Back</Button>
        <Button onClick={handleNext} disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Review & Pay →'}
        </Button>
      </div>
    </div>
  )
}
