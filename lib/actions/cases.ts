'use server'

import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { caseWizardSchema, type CaseWizardData } from '@/lib/validation/case'
import { CasePriority, CaseStatus, AuditAction } from '@prisma/client'
import { nanoid } from 'nanoid'

function generateCaseNumber(): string {
  const year = new Date().getFullYear()
  const random = nanoid(6).toUpperCase()
  return `MSO-${year}-${random}`
}

/** Create a draft case (called on step 1 submit, saves progress). */
export async function createDraftCase(data: Partial<CaseWizardData>) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' }

  const patient = await db.patient.findUnique({ where: { userId: session.user.id } })
  if (!patient) return { success: false, error: 'Patient profile not found' }

  try {
    const caseRecord = await db.case.create({
      data: {
        caseNumber: generateCaseNumber(),
        patientId: patient.id,
        specialtyId: data.specialtyId ?? '',
        title: data.title ?? '',
        chiefComplaint: data.chiefComplaint ?? '',
        questions: data.questions,
        medicalHistory: data.medicalHistory,
        currentMedications: data.currentMedications,
        allergies: data.allergies,
        priority: (data.priority as CasePriority) ?? CasePriority.STANDARD,
        status: CaseStatus.DRAFT,
        consentVersion: '1.0',
        privacyVersion: '1.0',
      },
    })

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.EDIT_CASE,
        resource: `case:${caseRecord.id}`,
        metadata: { action: 'create_draft' },
      },
    })

    return { success: true, caseId: caseRecord.id, caseNumber: caseRecord.caseNumber }
  } catch (error: any) {
    console.error('createDraftCase error:', error)
    return { success: false, error: error.message ?? 'Failed to create case' }
  }
}

/** Update an existing draft case. */
export async function updateDraftCase(caseId: string, data: Partial<CaseWizardData>) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' }

  // Ownership check
  const caseRecord = await db.case.findFirst({
    where: { id: caseId, patient: { userId: session.user.id }, status: CaseStatus.DRAFT },
  })
  if (!caseRecord) return { success: false, error: 'Case not found or not editable' }

  try {
    await db.case.update({
      where: { id: caseId },
      data: {
        ...(data.specialtyId && { specialtyId: data.specialtyId }),
        ...(data.title && { title: data.title }),
        ...(data.chiefComplaint && { chiefComplaint: data.chiefComplaint }),
        questions: data.questions,
        medicalHistory: data.medicalHistory,
        currentMedications: data.currentMedications,
        allergies: data.allergies,
        ...(data.priority && { priority: data.priority as CasePriority }),
      },
    })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message ?? 'Failed to update case' }
  }
}

/** Final submit: transitions case to PENDING_PAYMENT. */
export async function submitCase(caseId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' }

  const caseRecord = await db.case.findFirst({
    where: { id: caseId, patient: { userId: session.user.id }, status: CaseStatus.DRAFT },
    include: { specialty: true },
  })
  if (!caseRecord) return { success: false, error: 'Case not found or already submitted' }

  // Basic completeness check
  if (!caseRecord.specialtyId || !caseRecord.title || !caseRecord.chiefComplaint) {
    return { success: false, error: 'Please complete all required fields before submitting' }
  }

  try {
    await db.case.update({
      where: { id: caseId },
      data: {
        status: CaseStatus.PENDING_PAYMENT,
        submittedAt: new Date(),
      },
    })

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.EDIT_CASE,
        resource: `case:${caseId}`,
        metadata: { action: 'submit', priority: caseRecord.priority },
      },
    })

    return { success: true, caseNumber: caseRecord.caseNumber }
  } catch (error: any) {
    return { success: false, error: error.message ?? 'Failed to submit case' }
  }
}

/** Fetch all cases for the current patient. */
export async function getPatientCases() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return []

  const patient = await db.patient.findUnique({ where: { userId: session.user.id } })
  if (!patient) return []

  return db.case.findMany({
    where: { patientId: patient.id },
    include: { specialty: true },
    orderBy: { createdAt: 'desc' },
  })
}

/** Fetch a single case (ownership enforced). */
export async function getCase(caseId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  return db.case.findFirst({
    where: { id: caseId, patient: { userId: session.user.id } },
    include: { specialty: true, files: true, opinion: true, messages: true },
  })
}

/** Fetch all specialties for the specialty picker. */
export async function getSpecialties() {
  return db.specialty.findMany({ orderBy: { nameEn: 'asc' } })
}
