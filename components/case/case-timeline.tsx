type Event = { label: string; date: Date | string | null | undefined; done: boolean; color?: string }

function fmt(d: Date | string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
}

export function CaseTimeline({ status, submittedAt, assignedAt, dueDate, completedAt, createdAt }: {
  status: string
  submittedAt?: Date | string | null
  assignedAt?: Date | string | null
  dueDate?: Date | string | null
  completedAt?: Date | string | null
  createdAt: Date | string
}) {
  const events: Event[] = [
    { label: 'Case created', date: createdAt, done: true, color: '#3b82f6' },
    { label: 'Submitted & payment received', date: submittedAt, done: !!submittedAt, color: '#8b5cf6' },
    { label: 'Assigned to specialist', date: assignedAt, done: !!assignedAt, color: '#f59e0b' },
    { label: 'Opinion due', date: dueDate, done: status === 'COMPLETED', color: dueDate && new Date(dueDate) < new Date() && status !== 'COMPLETED' ? '#ef4444' : '#6b7280' },
    { label: 'Opinion delivered', date: completedAt, done: status === 'COMPLETED', color: '#10b981' },
  ]

  return (
    <div style={{ padding: '4px 0' }}>
      {events.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, position: 'relative' }}>
          {/* Connector line */}
          {i < events.length - 1 && (
            <div style={{ position: 'absolute', left: 11, top: 24, bottom: 0, width: 2, background: ev.done ? 'rgba(59,130,246,0.2)' : '#e5e7eb' }} />
          )}
          {/* Dot */}
          <div style={{ width: 24, height: 24, borderRadius: 999, flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ev.done ? (ev.color ?? '#3b82f6') : '#e5e7eb', zIndex: 1 }}>
            {ev.done ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <div style={{ width: 8, height: 8, borderRadius: 999, background: '#d1d5db' }} />
            )}
          </div>
          {/* Content */}
          <div style={{ paddingBottom: 20 }}>
            <div style={{ fontSize: 13.5, fontWeight: ev.done ? 600 : 400, color: ev.done ? '#111827' : '#9ca3af' }}>
              {ev.label}
            </div>
            {ev.date != null && (
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{fmt(ev.date)}</div>
            )}
            {!ev.done && !ev.date && (
              <div style={{ fontSize: 12, color: '#d1d5db', marginTop: 2 }}>Pending</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
