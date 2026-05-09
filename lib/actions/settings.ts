'use server'

import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function getUnreadCounts() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { messages: 0, cases: 0 }

  const role = session.user.role

  try {
    if (role === 'PATIENT') {
      const patient = await db.patient.findUnique({ where: { userId: session.user.id } })
      if (!patient) return { messages: 0, cases: 0 }
      const messages = await db.message.count({
        where: {
          case: { patientId: patient.id },
          senderId: { not: session.user.id },
          isRead: false,
        },
      })
      return { messages, cases: 0 }
    }

    if (role === 'DOCTOR') {
      const doctor = await db.doctor.findUnique({ where: { userId: session.user.id } })
      if (!doctor) return { messages: 0, cases: 0 }
      const [messages, cases] = await Promise.all([
        db.message.count({
          where: {
            case: { doctorId: doctor.id },
            senderId: { not: session.user.id },
            isRead: false,
          },
        }),
        db.case.count({
          where: { doctorId: doctor.id, status: 'ASSIGNED' },
        }),
      ])
      return { messages, cases }
    }

    if (role === 'ADMIN') {
      const [messages, cases] = await Promise.all([
        db.case.count({ where: { status: 'PENDING_PAYMENT' } }),
        db.doctor.count({ where: { status: 'PENDING_VERIFICATION' } }),
      ])
      return { messages: cases, cases: messages }
    }
  } catch { /* */ }

  return { messages: 0, cases: 0 }
}

export async function updateUserSettings({
  name,
  locale,
  phone,
}: {
  name?: string
  locale?: string
  phone?: string
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' }

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(locale !== undefined && { locale }),
        ...(phone !== undefined && { phone: phone.trim() }),
      },
    })
    revalidatePath('/')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function getUserSettings() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null
  return db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, phone: true, locale: true, role: true, createdAt: true },
  })
}
