'use server'

import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  CaseStatus, UserStatus, DoctorStatus, UserRole,
  AuditAction, OrganizationType,
} from '@prisma/client'
import { z } from 'zod'

async function requireAdminSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || !['ADMIN', 'ORG_ADMIN'].includes(session.user.role)) {
    throw new Error('Unauthorized')
  }
  return session
}

// ── Stats ──────────────────────────────────────────────────────────────────

export async function getAdminStats() {
  try {
    await requireAdminSession()
    const [
      totalUsers, activePatients, activeDoctors, pendingDoctors,
      totalCases, activeCases, completedCases, organizations,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { role: UserRole.PATIENT } }),
      db.doctor.count({ where: { status: DoctorStatus.VERIFIED } }),
      db.doctor.count({ where: { status: DoctorStatus.PENDING_VERIFICATION } }),
      db.case.count(),
      db.case.count({ where: { status: { in: [CaseStatus.ASSIGNED, CaseStatus.IN_REVIEW, CaseStatus.AWAITING_INFO] } } }),
      db.case.count({ where: { status: CaseStatus.COMPLETED } }),
      db.organization.count({ where: { isActive: true } }),
    ])
    return { totalUsers, activePatients, activeDoctors, pendingDoctors, totalCases, activeCases, completedCases, organizations }
  } catch {
    return { totalUsers: 0, activePatients: 0, activeDoctors: 0, pendingDoctors: 0, totalCases: 0, activeCases: 0, completedCases: 0, organizations: 0 }
  }
}

// ── Users ──────────────────────────────────────────────────────────────────

export async function getAllUsers(filters?: { role?: UserRole; status?: UserStatus; search?: string }) {
  try {
    await requireAdminSession()
    const where: any = {}
    if (filters?.role) where.role = filters.role
    if (filters?.status) where.status = filters.status
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ]
    }
    return db.user.findMany({
      where,
      include: { patient: true, doctor: true, organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  } catch {
    return []
  }
}

export async function getUserById(id: string) {
  try {
    await requireAdminSession()
    return db.user.findUnique({
      where: { id },
      include: {
        patient: true,
        doctor: { include: { specialties: { include: { specialty: true } } } },
        auditLogs: { take: 20, orderBy: { createdAt: 'desc' } },
      },
    })
  } catch {
    return null
  }
}

export async function updateUserStatus(id: string, status: UserStatus) {
  const session = await requireAdminSession()
  try {
    await db.user.update({ where: { id }, data: { status } })
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.EDIT_CASE,
        resource: `user:${id}`,
        metadata: { action: 'status_change', newStatus: status },
      },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function updateUserRole(id: string, role: UserRole) {
  const session = await requireAdminSession()
  try {
    await db.user.update({ where: { id }, data: { role } })
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.EDIT_CASE,
        resource: `user:${id}`,
        metadata: { action: 'role_change', newRole: role },
      },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Cases ──────────────────────────────────────────────────────────────────

export async function getAllCases(filters?: { status?: CaseStatus; search?: string }) {
  try {
    await requireAdminSession()
    const where: any = {}
    if (filters?.status) where.status = filters.status
    if (filters?.search) {
      where.OR = [
        { caseNumber: { contains: filters.search, mode: 'insensitive' } },
        { title: { contains: filters.search, mode: 'insensitive' } },
      ]
    }
    return db.case.findMany({
      where,
      include: {
        specialty: true,
        patient: { include: { user: { select: { name: true, email: true } } } },
        doctor: { include: { user: { select: { name: true } } } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    })
  } catch {
    return []
  }
}

export async function getAdminCase(caseId: string) {
  try {
    await requireAdminSession()
    return db.case.findUnique({
      where: { id: caseId },
      include: {
        specialty: true,
        patient: { include: { user: true } },
        doctor: { include: { user: true } },
        files: true,
        opinion: true,
        messages: { orderBy: { createdAt: 'asc' } },
        internalNotes: { orderBy: { createdAt: 'desc' } },
      },
    })
  } catch {
    return null
  }
}

export async function assignCaseToDoctor(caseId: string, doctorId: string) {
  const session = await requireAdminSession()
  try {
    const dueDate = new Date()
    const c = await db.case.findUnique({ where: { id: caseId } })
    if (!c) return { success: false, error: 'Case not found' }
    dueDate.setDate(dueDate.getDate() + (c.priority === 'EXPRESS' ? 3 : 7))

    await db.case.update({
      where: { id: caseId },
      data: {
        doctorId,
        status: CaseStatus.ASSIGNED,
        assignedAt: new Date(),
        dueDate,
      },
    })
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.EDIT_CASE,
        resource: `case:${caseId}`,
        metadata: { action: 'assign', doctorId },
      },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function updateCaseStatus(caseId: string, status: CaseStatus) {
  const session = await requireAdminSession()
  try {
    const data: any = { status }
    if (status === CaseStatus.COMPLETED) data.completedAt = new Date()
    await db.case.update({ where: { id: caseId }, data })
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.EDIT_CASE,
        resource: `case:${caseId}`,
        metadata: { action: 'status_change', newStatus: status },
      },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function addInternalNote(caseId: string, content: string) {
  const session = await requireAdminSession()
  try {
    await db.internalNote.create({
      data: { caseId, authorId: session.user.id, content },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Doctors ────────────────────────────────────────────────────────────────

export async function getAllDoctors(filters?: { status?: DoctorStatus }) {
  try {
    await requireAdminSession()
    const where = filters?.status ? { status: filters.status } : {}
    return db.doctor.findMany({
      where,
      include: {
        user: { select: { name: true, email: true, status: true, createdAt: true } },
        specialties: { include: { specialty: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  } catch {
    return []
  }
}

export async function verifyDoctor(doctorId: string) {
  const session = await requireAdminSession()
  try {
    await db.doctor.update({ where: { id: doctorId }, data: { status: DoctorStatus.VERIFIED } })
    const doctor = await db.doctor.findUnique({ where: { id: doctorId } })
    if (doctor) {
      await db.user.update({ where: { id: doctor.userId }, data: { status: UserStatus.ACTIVE } })
    }
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: AuditAction.EDIT_CASE,
        resource: `doctor:${doctorId}`,
        metadata: { action: 'verify' },
      },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function suspendDoctor(doctorId: string) {
  const session = await requireAdminSession()
  try {
    await db.doctor.update({ where: { id: doctorId }, data: { status: DoctorStatus.SUSPENDED } })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function getAvailableDoctors(specialtyId?: string) {
  try {
    await requireAdminSession()
    return db.doctor.findMany({
      where: {
        status: DoctorStatus.VERIFIED,
        isAvailable: true,
        ...(specialtyId && { specialties: { some: { specialtyId } } }),
      },
      include: {
        user: { select: { name: true } },
        specialties: { include: { specialty: true } },
      },
    })
  } catch {
    return []
  }
}

// ── Organizations ──────────────────────────────────────────────────────────

export async function getAllOrganizations() {
  try {
    await requireAdminSession()
    return db.organization.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    })
  } catch {
    return []
  }
}

const orgSchema = z.object({
  name: z.string().min(2),
  type: z.nativeEnum(OrganizationType),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  seatCount: z.coerce.number().int().min(0).default(0),
  allowancePerYear: z.coerce.number().int().min(0).optional(),
  billingEmail: z.string().email().optional(),
  invoicingMode: z.boolean().default(false),
})

export async function createOrganization(data: z.infer<typeof orgSchema>) {
  const session = await requireAdminSession()
  const validated = orgSchema.safeParse(data)
  if (!validated.success) return { success: false, error: 'Invalid data' }
  try {
    const org = await db.organization.create({ data: validated.data })
    return { success: true, orgId: org.id }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function updateOrganization(id: string, data: Partial<z.infer<typeof orgSchema>>) {
  await requireAdminSession()
  try {
    await db.organization.update({ where: { id }, data })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Audit Logs ─────────────────────────────────────────────────────────────

export async function getAuditLogs(filters?: {
  userId?: string
  action?: AuditAction
  from?: Date
  to?: Date
}) {
  try {
    await requireAdminSession()
    const where: any = {}
    if (filters?.userId) where.userId = filters.userId
    if (filters?.action) where.action = filters.action
    if (filters?.from || filters?.to) {
      where.createdAt = {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      }
    }
    return db.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  } catch {
    return []
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────

export async function getAnalytics() {
  try {
    await requireAdminSession()
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [
      totalRevenue,
      last30DayCases,
      last7DayCases,
      casesByStatus,
      casesBySpecialty,
      casesByPriority,
      newUsers30d,
    ] = await Promise.all([
      db.payment.aggregate({ where: { status: 'succeeded' }, _sum: { amount: true } }),
      db.case.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      db.case.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      db.case.groupBy({ by: ['status'], _count: { _all: true } }),
      db.case.groupBy({
        by: ['specialtyId'],
        _count: { _all: true },
        orderBy: { _count: { specialtyId: 'desc' } },
        take: 10,
      }),
      db.case.groupBy({ by: ['priority'], _count: { _all: true } }),
      db.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ])

    return {
      totalRevenue: totalRevenue._sum.amount ?? 0,
      last30DayCases,
      last7DayCases,
      casesByStatus,
      casesBySpecialty,
      casesByPriority,
      newUsers30d,
    }
  } catch {
    return null
  }
}
