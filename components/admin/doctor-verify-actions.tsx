'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { verifyDoctor, suspendDoctor } from '@/lib/actions/admin'
import { DoctorStatus } from '@prisma/client'

export function DoctorVerifyActions({
  doctorId,
  currentStatus,
}: {
  doctorId: string
  currentStatus: DoctorStatus
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handle = async (action: 'verify' | 'suspend') => {
    setLoading(true)
    if (action === 'verify') await verifyDoctor(doctorId)
    else await suspendDoctor(doctorId)
    setLoading(false)
    router.refresh()
  }

  return (
    <div className="flex shrink-0 gap-2">
      {currentStatus !== DoctorStatus.VERIFIED && (
        <button
          onClick={() => handle('verify')}
          disabled={loading}
          className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
        >
          Verify
        </button>
      )}
      {currentStatus !== DoctorStatus.SUSPENDED && (
        <button
          onClick={() => handle('suspend')}
          disabled={loading}
          className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Suspend
        </button>
      )}
    </div>
  )
}
