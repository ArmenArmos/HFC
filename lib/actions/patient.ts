'use server'

import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AuditAction } from '@prisma/client'
import { z } from 'zod'

async function requirePatientSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) throw new Error('Not authenticated')
  const patient = await db.patient.findUnique({ where: { userId: session.user.id } })
  if (!patient) throw new Error('Patient profile not found')
  return { session, patient }
}

export async function getPatientProfile() {
  try {
    const { patient } = await requirePatientSession()
    return db.patient.findUnique({
      where: { id: patient.id },
      include: { user: true },
    })
  } catch {
    return null
  }
}

const profileSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  emergencyName: z.string().optional(),
  emergencyPhone: z.string().optional(),
  bloodType: z.string().optional(),
  allergies: z.string().optional(),
  chronicConditions: z.string().optional(),
  marketingOptIn: z.boolean().optional(),
})

export async function updatePatientProfile(data: z.infer<typeof profileSchema>) {
  const { session, patient } = await requirePatientSession()
  const validated = profileSchema.safeParse(data)
  if (!validated.success) return { success: false, error: 'Invalid data' }

  const { name, phone, ...patientData } = validated.data
  try {
    if (name || phone) {
      await db.user.update({
        where: { id: session.user.id },
        data: { ...(name && { name }), ...(phone && { phone }) },
      })
    }
    const updatePayload: any = { ...patientData }
    if (patientData.dateOfBirth) {
      updatePayload.dateOfBirth = new Date(patientData.dateOfBirth)
    }
    await db.patient.update({ where: { id: patient.id }, data: updatePayload })
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.VIEW_PATIENT_DATA,
        resource: `patient:${patient.id}`,
        metadata: { action: 'update_profile' },
      },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function getPatientDashboardData() {
  try {
    const { patient } = await requirePatientSession()
    const [totalCases, activeCases, completedCases, recentCases] = await Promise.all([
      db.case.count({ where: { patientId: patient.id } }),
      db.case.count({
        where: {
          patientId: patient.id,
          status: { in: ['ASSIGNED', 'IN_REVIEW', 'AWAITING_INFO', 'PENDING_PAYMENT'] },
        },
      }),
      db.case.count({ where: { patientId: patient.id, status: 'COMPLETED' } }),
      db.case.findMany({
        where: { patientId: patient.id },
        include: { specialty: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
    ])
    return { totalCases, activeCases, completedCases, recentCases }
  } catch {
    return { totalCases: 0, activeCases: 0, completedCases: 0, recentCases: [] }
  }
}

export async function sendPatientMessage(caseId: string, content: string) {
  const { session, patient } = await requirePatientSession()
  const c = await db.case.findFirst({ where: { id: caseId, patientId: patient.id } })
  if (!c) return { success: false, error: 'Case not found' }
  try {
    await db.message.create({
      data: { caseId, senderId: session.user.id, senderType: 'PATIENT', content },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function getCaseMessages(caseId: string) {
  try {
    const { patient } = await requirePatientSession()
    const c = await db.case.findFirst({ where: { id: caseId, patientId: patient.id } })
    if (!c) return []
    return db.message.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    })
  } catch {
    return []
  }
}
