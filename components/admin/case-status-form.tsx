'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateCaseStatus, addInternalNote, assignCaseToDoctor } from '@/lib/actions/admin'

const STATUSES = ['ASSIGNED', 'IN_REVIEW', 'AWAITING_INFO', 'COMPLETED', 'CANCELLED']

type Doctor = { id: string; title: string | null; user: { name: string | null } }

export function CaseStatusForm({
  caseId,
  currentStatus,
  currentDoctorId,
  doctors,
  locale,
}: {
  caseId: string
  currentStatus: string
  currentDoctorId: string | null
  doctors: Doctor[]
  locale: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState(currentStatus)
  const [doctorId, setDoctorId] = useState(currentDoctorId ?? '')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')

  async function handleStatusChange() {
    setMsg('')
    startTransition(async () => {
      if (status !== currentStatus) await updateCaseStatus(caseId, status as any)
      if (doctorId && doctorId !== currentDoctorId) await assignCaseToDoctor(caseId, doctorId)
      setMsg('✓ Case updated')
      router.refresh()
    })
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault()
    if (!note.trim()) return
    startTransition(async () => {
      await addInternalNote(caseId, note)
      setNote('')
      setMsg('✓ Note added')
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Status & Doctor */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Case Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', padding: '9px 12px', fontSize: 14, outline: 'none' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Assigned Doctor</label>
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)} style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', padding: '9px 12px', fontSize: 14, outline: 'none' }}>
            <option value="">Unassigned</option>
            {doctors.map(d => (
              <option key={d.id} value={d.id}>
                {d.title} {d.user.name ?? 'Doctor'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button onClick={handleStatusChange} disabled={isPending} style={{ height: 40, borderRadius: 8, background: '#2563eb', color: 'white', border: 'none', fontWeight: 600, fontSize: 14, cursor: isPending ? 'wait' : 'pointer', opacity: isPending ? 0.7 : 1 }}>
        {isPending ? 'Updating…' : 'Apply Changes'}
      </button>

      {/* Internal Note */}
      <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 18 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Add Internal Note</label>
        <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Visible to admin only…" rows={3} style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', padding: '10px 14px', fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
          <button type="submit" disabled={isPending || !note.trim()} style={{ alignSelf: 'flex-end', height: 36, padding: '0 18px', borderRadius: 8, background: '#111827', color: 'white', border: 'none', fontWeight: 600, fontSize: 13, cursor: isPending ? 'wait' : 'pointer', opacity: !note.trim() ? 0.4 : 1 }}>
            Add Note
          </button>
        </form>
      </div>

      {msg && <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>{msg}</p>}
    </div>
  )
}
