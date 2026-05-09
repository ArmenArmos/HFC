function Skeleton({ w = '100%', h = 16, r = 6 }: { w?: string | number; h?: number; r?: number }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
}

export default function DoctorLoading() {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div style={{ padding: '24px 32px', maxWidth: 1000 }}>
        <div style={{ marginBottom: 28 }}><Skeleton w={200} h={28} r={6} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #f3f4f6' }}>
              <Skeleton w={80} h={12} r={4} />
              <div style={{ marginTop: 12 }}><Skeleton w={50} h={32} r={6} /></div>
            </div>
          ))}
        </div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f3f4f6', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f9fafb' }}><Skeleton w={140} h={18} r={4} /></div>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ padding: '16px 20px', borderBottom: '1px solid #f9fafb', display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <Skeleton w={100} h={12} r={4} />
                <div style={{ marginTop: 8 }}><Skeleton w={220} h={16} r={4} /></div>
                <div style={{ marginTop: 6 }}><Skeleton w={140} h={11} r={4} /></div>
              </div>
              <Skeleton w={16} h={16} r={4} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
