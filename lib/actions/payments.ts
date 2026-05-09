'use server'

import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { CaseStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'

export async function processPayment(caseId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' }

  const c = await db.case.findFirst({
    where: { id: caseId, patient: { userId: session.user.id }, status: CaseStatus.PENDING_PAYMENT },
  })
  if (!c) return { success: false, error: 'Case not found or not awaiting payment' }

  const amount = c.priority === 'EXPRESS' ? 299 : 149
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + (c.priority === 'EXPRESS' ? 3 : 7))

  await db.$transaction([
    db.payment.create({
      data: {
        userId: session.user.id,
        caseId,
        amount,
        currency: 'USD',
        status: 'succeeded',
        description: `Second opinion — ${c.caseNumber}`,
      },
    }),
    db.case.update({
      where: { id: caseId },
      data: {
        status: CaseStatus.ASSIGNED,
        assignedAt: new Date(),
        dueDate,
        amount,
        paymentStatus: 'succeeded',
      },
    }),
  ])

  revalidatePath(`/patient/cases/${caseId}`)
  revalidatePath(`/patient/cases`)
  return { success: true }
}
