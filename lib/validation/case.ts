import { z } from 'zod'

export const step1Schema = z.object({
  specialtyId: z.string().min(1, 'Please select a medical specialty'),
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  chiefComplaint: z.string().min(20, 'Please describe your condition in at least 20 characters').max(2000),
  questions: z.string().max(1000).optional(),
})

export const step2Schema = z.object({
  medicalHistory: z.string().max(3000).optional(),
  currentMedications: z.string().max(2000).optional(),
  allergies: z.string().max(1000).optional(),
})

export const step3Schema = z.object({
  fileIds: z.array(z.string()).optional(),
})

export const step4Schema = z.object({
  priority: z.enum(['STANDARD', 'EXPRESS']),
})

export const caseWizardSchema = step1Schema.merge(step2Schema).merge(step3Schema).merge(step4Schema)

export type Step1Data = z.infer<typeof step1Schema>
export type Step2Data = z.infer<typeof step2Schema>
export type Step3Data = z.infer<typeof step3Schema>
export type Step4Data = z.infer<typeof step4Schema>
export type CaseWizardData = z.infer<typeof caseWizardSchema>
