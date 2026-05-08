'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateUserStatus } from '@/lib/actions/admin'
import { UserStatus } from '@prisma/client'

export function UserStatusActions({
  userId,
  currentStatus,
}: {
  userId: string
  currentStatus: UserStatus
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handle = async (status: UserStatus) => {
    setLoading(true)
    await updateUserStatus(userId, status)
    setLoading(false)
    router.refresh()
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {currentStatus !== UserStatus.ACTIVE && (
        <button
          onClick={() => handle(UserStatus.ACTIVE)}
          disabled={loading}
          className="rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-50"
        >
          Activate
        </button>
      )}
      {currentStatus !== UserStatus.SUSPENDED && (
        <button
          onClick={() => handle(UserStatus.SUSPENDED)}
          disabled={loading}
          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Suspend
        </button>
      )}
    </div>
  )
}
