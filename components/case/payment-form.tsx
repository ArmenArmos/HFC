'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { processPayment } from '@/lib/actions/payments'

const inp: React.CSSProperties = { width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', padding: '11px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }

export function PaymentForm({ caseId, price, locale }: { caseId: string; price: number; locale: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [card, setCard] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [method, setMethod] = useState<'card' | 'apple' | 'hsa'>('card')

  function formatCard(v: string) {
    return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim()
  }

  function formatExpiry(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 4)
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (method === 'card') {
      if (!name.trim()) { setError('Name on card is required.'); return }
      if (card.replace(/\s/g, '').length < 16) { setError('Enter a valid 16-digit card number.'); return }
      if (expiry.length < 5) { setError('Enter a valid expiry date (MM/YY).'); return }
      if (cvv.length < 3) { setError('Enter a valid CVV.'); return }
    }
    startTransition(async () => {
      const res = await processPayment(caseId)
      if (res.success) {
        router.push(`/${locale}/patient/cases/${caseId}`)
        router.refresh()
      } else {
        setError(res.error ?? 'Payment failed. Please try again.')
      }
    })
  }

  const methods = [
    { id: 'card' as const, label: '💳 Credit / Debit Card' },
    { id: 'apple' as const, label: '🍎 Apple Pay' },
    { id: 'hsa' as const, label: '🏥 HSA / FSA Card' },
  ]

  return (
    <form onSubmit={handleSubmit}>
      {/* Method selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {methods.map(m => (
          <button key={m.id} type="button" onClick={() => setMethod(m.id)} style={{
            flex: 1, padding: '10px 4px', borderRadius: 10, border: `2px solid ${method === m.id ? '#2563eb' : '#e5e7eb'}`,
            background: method === m.id ? '#eff6ff' : 'white', fontSize: 12, fontWeight: 500,
            color: method === m.id ? '#1d4ed8' : '#6b7280', cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {m.label}
          </button>
        ))}
      </div>

      {method === 'card' && (
        <>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Name on card</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" style={inp} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Card number</label>
            <input value={card} onChange={e => setCard(formatCard(e.target.value))} placeholder="4242 4242 4242 4242" style={inp} inputMode="numeric" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Expiry</label>
              <input value={expiry} onChange={e => setExpiry(formatExpiry(e.target.value))} placeholder="MM/YY" style={inp} inputMode="numeric" />
            </div>
            <div>
              <label style={lbl}>CVV</label>
              <input value={cvv} onChange={e => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="123" style={inp} inputMode="numeric" type="password" />
            </div>
          </div>
        </>
      )}

      {(method === 'apple' || method === 'hsa') && (
        <div style={{ padding: '28px 0 20px', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
          You will be redirected to complete {method === 'apple' ? 'Apple Pay' : 'HSA/FSA'} authentication.
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      <button type="submit" disabled={isPending} style={{
        width: '100%', height: 50, borderRadius: 10,
        background: isPending ? '#93c5fd' : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
        color: 'white', fontSize: 16, fontWeight: 700, border: 'none',
        cursor: isPending ? 'wait' : 'pointer', letterSpacing: -0.2,
        boxShadow: isPending ? 'none' : '0 4px 14px rgba(37,99,235,0.35)',
        transition: 'all 0.15s',
      }}>
        {isPending ? 'Processing payment…' : `Pay $${price}`}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14, color: '#9ca3af', fontSize: 12 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        256-bit SSL encryption · 14-day money-back guarantee
      </div>
    </form>
  )
}
