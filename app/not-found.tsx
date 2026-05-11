import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480, padding: '0 24px' }}>
        <div style={{
          fontSize: 96,
          fontWeight: 800,
          background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 1,
          marginBottom: 16,
        }}>
          404
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
          Page not found
        </h1>
        <p style={{ fontSize: 15, color: '#6b7280', marginBottom: 32, lineHeight: 1.6 }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/en" style={{
            display: 'inline-block',
            background: '#2563eb',
            color: 'white',
            padding: '10px 24px',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            textDecoration: 'none',
          }}>
            Go Home
          </Link>
          <Link href="/en/patient/dashboard" style={{
            display: 'inline-block',
            background: 'white',
            color: '#374151',
            border: '1px solid #e5e7eb',
            padding: '10px 24px',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            textDecoration: 'none',
          }}>
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
