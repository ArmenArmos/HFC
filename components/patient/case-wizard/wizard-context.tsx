'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import type { CaseWizardData } from '@/lib/validation/case'

interface WizardContextValue {
  step: number
  totalSteps: number
  data: Partial<CaseWizardData>
  caseId: string | null
  setStep: (step: number) => void
  updateData: (patch: Partial<CaseWizardData>) => void
  setCaseId: (id: string) => void
  next: () => void
  prev: () => void
}

const WizardContext = createContext<WizardContextValue | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<Partial<CaseWizardData>>({})
  const [caseId, setCaseId] = useState<string | null>(null)
  const totalSteps = 5

  const updateData = (patch: Partial<CaseWizardData>) =>
    setData((prev) => ({ ...prev, ...patch }))

  const next = () => setStep((s) => Math.min(s + 1, totalSteps))
  const prev = () => setStep((s) => Math.max(s - 1, 1))

  return (
    <WizardContext.Provider
      value={{ step, totalSteps, data, caseId, setStep, updateData, setCaseId, next, prev }}
    >
      {children}
    </WizardContext.Provider>
  )
}

export function useWizard() {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('useWizard must be used within WizardProvider')
  return ctx
}
