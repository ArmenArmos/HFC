import { requirePatient } from '@/lib/auth-helpers'
import { getCase } from '@/lib/actions/cases'
import { notFound, redirect } from 'next/navigation'
import { PaymentForm } from '@/components/case/payment-form'
import Link from 'next/link'

export default async function PaymentPage({
  params: { locale, caseId },
}: {
  params: { locale: string; caseId: string }
}) {
  await requirePatient(locale)
  const c = await getCase(caseId)
  if (!c) notFound()
  if (c.status !== 'PENDING_PAYMENT') redirect(`/${locale}/patient/cases/${caseId}`)

  const price = c.priority === 'EXPRESS' ? 299 : 149
  const isExpress = c.priority === 'EXPRESS'

  return (
    <div style={{ padding: '32px 24px', maxWidth: 560, margin: '0 auto' }}>
      {/* Back */}
      <Link href={`/${locale}/patient/cases/${caseId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 13, textDecoration: 'none', marginBottom: 28 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back to case
      </Link>

      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Complete Payment</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 28 }}>Your case will be assigned to a specialist immediately after payment.</p>

      {/* Order summary */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>Order Summary</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 14, color: '#374151' }}>{c.specialty?.nameEn} Second Opinion</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>${price}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 14, color: '#374151' }}>Turnaround</span>
          <span style={{ fontSize: 14, color: isExpress ? '#d97706' : '#6b7280', fontWeight: 500 }}>
            {isExpress ? '⚡ 1–3 business days' : '5–7 business days'}
          </span>
        </div>
        <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Total</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#2563eb' }}>${price} USD</span>
        </div>
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          Includes a written specialist opinion and PDF report
        </div>
      </div>

      {/* Payment form */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>Payment Details</div>
        <PaymentForm caseId={caseId} price={price} locale={locale} />
      </div>
    </div>
  )
}
