'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { assignCaseToDoctor, updateCaseStatus } from '@/lib/actions/admin'
import { CaseStatus } from '@prisma/client'

interface Doctor { id: string; name: string }

export function CaseAssignActions({
  caseId,
  currentStatus,
  currentDoctorId,
  doctors,
}: {
  caseId: string
  currentStatus: string
  currentDoctorId: string | null
  doctors: Doctor[]
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [selectedDoctor, setSelectedDoctor] = useState(currentDoctorId ?? '')

  const assign = async () => {
    if (!selectedDoctor) return
    setLoading(true)
    await assignCaseToDoctor(caseId, selectedDoctor)
    setLoading(false)
    router.refresh()
  }

  const cancel = async () => {
    if (!confirm('Cancel this case?')) return
    setLoading(true)
    await updateCaseStatus(caseId, CaseStatus.CANCELLED)
    setLoading(false)
    router.refresh()
  }

  const isActive = !['COMPLETED', 'CANCELLED'].includes(currentStatus)

  return (
    <div className="flex items-center justify-end gap-2">
      {isActive && doctors.length > 0 && currentStatus === 'PENDING_PAYMENT' && (
        <>
          <select
            value={selectedDoctor}
            onChange={(e) => setSelectedDoctor(e.target.value)}
            className="rounded border border-input px-2 py-1 text-xs"
          >
            <option value="">Select doctor…</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button
            onClick={assign}
            disabled={loading || !selectedDoctor}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            Assign
          </button>
        </>
      )}
      {isActive && (
        <button
          onClick={cancel}
          disabled={loading}
          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
