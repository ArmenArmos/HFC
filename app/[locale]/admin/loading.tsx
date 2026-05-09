function Skeleton({ w = '100%', h = 16, r = 6 }: { w?: string | number; h?: number; r?: number }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
}

export default function AdminLoading() {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div style={{ padding: '24px 32px' }}>
        <div style={{ marginBottom: 28 }}><Skeleton w={220} h={28} r={6} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[0,1,2,3].map(i => <div key={i} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #f3f4f6' }}><Skeleton w={80} h={12} r={4} /><div style={{ marginTop: 12 }}><Skeleton w={50} h={32} r={6} /></div></div>)}
        </div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f3f4f6', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 16 }}>
            {['Case', 'Patient', 'Status', 'Doctor', 'Created', 'Actions'].map(h => <Skeleton key={h} w="60%" h={11} r={3} />)}
          </div>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid #f9fafb', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 16, alignItems: 'center' }}>
              <div><Skeleton w="80%" h={13} r={4} /><div style={{ marginTop: 5 }}><Skeleton w="60%" h={11} r={4} /></div></div>
              <Skeleton h={13} r={4} />
              <Skeleton w={80} h={20} r={999} />
              <Skeleton h={13} r={4} />
              <Skeleton h={13} r={4} />
              <Skeleton w={70} h={28} r={6} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
