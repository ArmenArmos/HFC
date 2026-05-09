'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { sendMessage } from '@/lib/actions/messages'

type Msg = { id: string; content: string; senderType: string; senderId: string; createdAt: Date | string }

const SENDER_LABEL: Record<string, string> = { PATIENT: 'Patient', DOCTOR: 'Doctor', ADMIN: 'Support', SYSTEM: 'System' }

export function MessageThread({
  caseId,
  initialMessages,
  currentUserId,
  currentRole,
}: {
  caseId: string
  initialMessages: Msg[]
  currentUserId: string
  currentRole: string
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [isPending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    if (!draft.trim() || isPending) return
    const toSend = draft
    const optimistic: Msg = { id: `opt-${Date.now()}`, content: toSend, senderType: currentRole, senderId: currentUserId, createdAt: new Date() }
    setMessages(prev => [...prev, optimistic])
    setDraft('')

    startTransition(async () => {
      const res = await sendMessage(caseId, toSend)
      if (res.success && res.message) {
        setMessages(prev => prev.map(m => m.id === optimistic.id ? { ...res.message! } : m))
      } else {
        setMessages(prev => prev.filter(m => m.id !== optimistic.id))
        setDraft(toSend)
      }
    })
  }

  return (
    <div>
      <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0', marginBottom: 14 }}>
        {messages.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: '28px 0' }}>
            No messages yet — start the conversation.
          </p>
        ) : messages.map(msg => {
          const isOwn = msg.senderId === currentUserId
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '72%',
                background: isOwn ? '#2563eb' : '#f3f4f6',
                color: isOwn ? '#fff' : '#111827',
                borderRadius: isOwn ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                padding: '10px 14px',
                opacity: msg.id.startsWith('opt-') ? 0.7 : 1,
                transition: 'opacity 0.2s',
              }}>
                {!isOwn && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
                    {SENDER_LABEL[msg.senderType] ?? msg.senderType}
                  </div>
                )}
                <p style={{ fontSize: 14, lineHeight: 1.45, margin: 0, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                <p style={{ fontSize: 11, marginTop: 5, color: isOwn ? 'rgba(255,255,255,0.6)' : '#9ca3af', textAlign: 'right', margin: '5px 0 0' }}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Type a message…"
          disabled={isPending}
          style={{ flex: 1, borderRadius: 8, border: '1px solid #e5e7eb', padding: '10px 14px', fontSize: 14, outline: 'none', background: isPending ? '#f9fafb' : 'white' }}
        />
        <button
          onClick={handleSend}
          disabled={isPending || !draft.trim()}
          style={{ borderRadius: 8, background: '#2563eb', color: 'white', border: 'none', padding: '0 20px', fontWeight: 600, fontSize: 14, cursor: isPending ? 'wait' : 'pointer', opacity: !draft.trim() || isPending ? 0.5 : 1, transition: 'opacity 0.15s' }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
