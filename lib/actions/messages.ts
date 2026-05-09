'use server'

import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MessageSender } from '@prisma/client'
import { revalidatePath } from 'next/cache'

export async function sendMessage(caseId: string, content: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || !content.trim()) return { success: false, error: 'Invalid request' }

  const role = session.user.role
  const senderType =
    role === 'PATIENT' ? MessageSender.PATIENT
    : role === 'DOCTOR' ? MessageSender.DOCTOR
    : MessageSender.ADMIN

  // Verify case access
  const caseRecord = await db.case.findFirst({
    where: {
      id: caseId,
      OR: [
        { patient: { userId: session.user.id } },
        { doctor: { userId: session.user.id } },
      ],
    },
  })
  if (!caseRecord && role !== 'ADMIN') return { success: false, error: 'Access denied' }

  const msg = await db.message.create({
    data: { caseId, senderId: session.user.id, senderType, content: content.trim() },
  })

  revalidatePath(`/patient/cases/${caseId}`)
  revalidatePath(`/doctor/cases/${caseId}`)

  return {
    success: true,
    message: {
      id: msg.id,
      content: msg.content,
      senderType: msg.senderType as string,
      senderId: msg.senderId,
      createdAt: msg.createdAt,
    },
  }
}

export async function markMessagesRead(caseId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return

  await db.message.updateMany({
    where: { caseId, senderId: { not: session.user.id }, isRead: false },
    data: { isRead: true, readAt: new Date() },
  })
}
