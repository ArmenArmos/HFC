'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setAvailability } from '@/lib/actions/doctor'
import { Button } from '@/components/ui/button'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Slot {
  dayOfWeek: number
  startTime: string
  endTime: string
  timezone: string
}

interface Props {
  initialSlots: Slot[]
}

export function AvailabilityForm({ initialSlots }: Props) {
  const router = useRouter()
  const [slots, setSlots] = useState<(Slot | null)[]>(() => {
    const arr: (Slot | null)[] = Array(7).fill(null)
    initialSlots.forEach((s) => { arr[s.dayOfWeek] = s })
    return arr
  })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const timezone = 'Asia/Yerevan'

  const toggleDay = (day: number) => {
    setSlots((prev) => {
      const next = [...prev]
      next[day] = next[day] ? null : { dayOfWeek: day, startTime: '09:00', endTime: '17:00', timezone }
      return next
    })
    setSuccess(false)
  }

  const updateSlot = (day: number, field: 'startTime' | 'endTime', value: string) => {
    setSlots((prev) => {
      const next = [...prev]
      if (next[day]) next[day] = { ...next[day]!, [field]: value }
      return next
    })
    setSuccess(false)
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError('')
    const activeSlots = slots.filter(Boolean) as Slot[]
    const res = await setAvailability(activeSlots)
    setIsSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    setSuccess(true)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {DAYS.map((dayName, idx) => {
        const slot = slots[idx]
        const isActive = slot !== null
        return (
          <div key={idx} className={`rounded-lg border p-4 transition-colors ${isActive ? 'border-blue-200 bg-blue-50' : 'bg-white'}`}>
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => toggleDay(idx)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className={`font-medium ${isActive ? 'text-blue-700' : 'text-gray-500'}`}>{dayName}</span>
              </label>
              {!isActive && <span className="text-xs text-gray-400">Unavailable</span>}
            </div>
            {isActive && (
              <div className="mt-3 flex items-center gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">From</label>
                  <input
                    type="time"
                    value={slot!.startTime}
                    onChange={(e) => updateSlot(idx, 'startTime', e.target.value)}
                    className="rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">To</label>
                  <input
                    type="time"
                    value={slot!.endTime}
                    onChange={(e) => updateSlot(idx, 'endTime', e.target.value)}
                    className="rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Availability saved.</p>}

      <p className="text-xs text-gray-400">Times are in Asia/Yerevan (Armenia) timezone.</p>
      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Save Availability'}
      </Button>
    </div>
  )
}
