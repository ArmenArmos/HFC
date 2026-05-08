'use server'

import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { CaseStatus, AuditAction, OpinionStatus, DoctorStatus } from '@prisma/client'
import { z } from 'zod'

async function requireDoctorSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || session.user.role !== 'DOCTOR') {
    throw new Error('Unauthorized')
  }
  const doctor = await db.doctor.findUnique({ where: { userId: session.user.id } })
  if (!doctor) throw new Error('Doctor profile not found')
  return { session, doctor }
}

export async function getDoctorCases(status?: CaseStatus) {
  try {
    const { doctor } = await requireDoctorSession()
    const where = status
      ? { doctorId: doctor.id, status }
      : { doctorId: doctor.id }
    return db.case.findMany({
      where,
      include: { specialty: true, patient: { include: { user: true } }, opinion: true },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    })
  } catch {
    return []
  }
}

export async function getDoctorCase(caseId: string) {
  try {
    const { doctor } = await requireDoctorSession()
    return db.case.findFirst({
      where: { id: caseId, doctorId: doctor.id },
      include: {
        specialty: true,
        patient: { include: { user: true } },
        files: true,
        opinion: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })
  } catch {
    return null
  }
}

export async function getDoctorStats() {
  try {
    const { doctor } = await requireDoctorSession()
    const [pending, inReview, completed] = await Promise.all([
      db.case.count({ where: { doctorId: doctor.id, status: CaseStatus.ASSIGNED } }),
      db.case.count({ where: { doctorId: doctor.id, status: CaseStatus.IN_REVIEW } }),
      db.case.count({ where: { doctorId: doctor.id, status: CaseStatus.COMPLETED } }),
    ])
    return { pending, inReview, completed, rating: doctor.averageRating }
  } catch {
    return { pending: 0, inReview: 0, completed: 0, rating: null }
  }
}

const opinionSchema = z.object({
  diagnosis: z.string().min(10),
  rationale: z.string().min(10),
  recommendations: z.string().min(10),
  differentialDiagnosis: z.string().optional(),
  additionalTests: z.string().optional(),
  prognosis: z.string().optional(),
  guidelines: z.string().optional(),
  references: z.string().optional(),
})

export async function saveOpinionDraft(
  caseId: string,
  data: z.infer<typeof opinionSchema>
) {
  const { session, doctor } = await requireDoctorSession()
  const c = await db.case.findFirst({ where: { id: caseId, doctorId: doctor.id } })
  if (!c) return { success: false, error: 'Case not found' }

  try {
    const existing = await db.opinion.findUnique({ where: { caseId } })
    if (existing) {
      await db.opinion.update({
        where: { caseId },
        data: { ...data, status: OpinionStatus.DRAFT },
      })
    } else {
      await db.opinion.create({
        data: {
          caseId,
          doctorId: doctor.id,
          status: OpinionStatus.DRAFT,
          ...data,
        },
      })
    }
    // Move case to IN_REVIEW if it was ASSIGNED
    if (c.status === CaseStatus.ASSIGNED) {
      await db.case.update({ where: { id: caseId }, data: { status: CaseStatus.IN_REVIEW } })
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function submitOpinion(caseId: string, data: z.infer<typeof opinionSchema>) {
  const { session, doctor } = await requireDoctorSession()
  const c = await db.case.findFirst({
    where: { id: caseId, doctorId: doctor.id },
    include: { opinion: true },
  })
  if (!c) return { success: false, error: 'Case not found' }

  const validated = opinionSchema.safeParse(data)
  if (!validated.success) return { success: false, error: 'Invalid opinion data' }

  try {
    if (c.opinion) {
      await db.opinion.update({
        where: { caseId },
        data: { ...data, status: OpinionStatus.COMPLETED, deliveredAt: new Date() },
      })
    } else {
      await db.opinion.create({
        data: {
          caseId,
          doctorId: doctor.id,
          status: OpinionStatus.COMPLETED,
          deliveredAt: new Date(),
          ...data,
        },
      })
    }
    await db.case.update({
      where: { id: caseId },
      data: { status: CaseStatus.COMPLETED, completedAt: new Date() },
    })
    await db.doctor.update({
      where: { id: doctor.id },
      data: { casesCompleted: { increment: 1 } },
    })
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.SUBMIT_OPINION,
        resource: `case:${caseId}`,
      },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

const profileSchema = z.object({
  title: z.string().optional(),
  bio: z.string().max(2000).optional(),
  licenseNumber: z.string().optional(),
  licenseCountry: z.string().optional(),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
  medicalSchool: z.string().optional(),
  residency: z.string().optional(),
  fellowships: z.string().optional(),
  boardCertifications: z.string().optional(),
  languages: z.array(z.string()).optional(),
  maxCasesPerWeek: z.coerce.number().int().min(1).max(50).optional(),
  isAvailable: z.boolean().optional(),
})

export async function getDoctorProfile() {
  try {
    const { doctor } = await requireDoctorSession()
    return db.doctor.findUnique({
      where: { id: doctor.id },
      include: { user: true, specialties: { include: { specialty: true } } },
    })
  } catch {
    return null
  }
}

export async function updateDoctorProfile(data: z.infer<typeof profileSchema>) {
  const { doctor } = await requireDoctorSession()
  const validated = profileSchema.safeParse(data)
  if (!validated.success) return { success: false, error: 'Invalid data' }
  try {
    await db.doctor.update({ where: { id: doctor.id }, data: validated.data })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function getDoctorAvailability() {
  try {
    const { doctor } = await requireDoctorSession()
    return db.doctorAvailability.findMany({
      where: { doctorId: doctor.id },
      orderBy: { dayOfWeek: 'asc' },
    })
  } catch {
    return []
  }
}

export async function setAvailability(
  slots: { dayOfWeek: number; startTime: string; endTime: string; timezone: string }[]
) {
  const { doctor } = await requireDoctorSession()
  try {
    await db.doctorAvailability.deleteMany({ where: { doctorId: doctor.id } })
    if (slots.length > 0) {
      await db.doctorAvailability.createMany({
        data: slots.map((s) => ({ ...s, doctorId: doctor.id })),
      })
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function acceptCase(caseId: string) {
  const { session, doctor } = await requireDoctorSession()
  const c = await db.case.findFirst({ where: { id: caseId, doctorId: doctor.id, status: CaseStatus.ASSIGNED } })
  if (!c) return { success: false, error: 'Case not found' }
  try {
    await db.case.update({ where: { id: caseId }, data: { status: CaseStatus.IN_REVIEW } })
    await db.auditLog.create({
      data: { userId: session.user.id, action: AuditAction.EDIT_CASE, resource: `case:${caseId}`, metadata: { action: 'accept' } },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function requestMoreInfo(caseId: string, message: string) {
  const { session, doctor } = await requireDoctorSession()
  const c = await db.case.findFirst({
    where: { id: caseId, doctorId: doctor.id, status: { in: [CaseStatus.ASSIGNED, CaseStatus.IN_REVIEW] } },
  })
  if (!c) return { success: false, error: 'Case not found' }
  try {
    await db.case.update({ where: { id: caseId }, data: { status: CaseStatus.AWAITING_INFO } })
    await db.message.create({
      data: { caseId, senderId: session.user.id, senderType: 'DOCTOR', content: message },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
