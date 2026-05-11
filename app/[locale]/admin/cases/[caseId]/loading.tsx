function Skeleton({ w = '100%', h = 16, r = 6 }: { w?: string | number; h?: number; r?: number }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
}

export default function AdminCaseDetailLoading() {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        <div style={{ marginBottom: 6 }}><Skeleton w={80} h={12} r={4} /></div>
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Skeleton w={280} h={26} r={6} />
          <Skeleton w={80} h={22} r={999} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
          <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ background: 'white', borderRadius: 12, border: '1px solid #f3f4f6', padding: 20 }}>
                <Skeleton w={120} h={16} r={4} />
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[0, 1, 2, 3].map(j => <Skeleton key={j} h={13} r={4} />)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f3f4f6', padding: 20 }}>
              <Skeleton w={140} h={16} r={4} />
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Skeleton h={36} r={8} />
                <Skeleton h={36} r={8} />
                <Skeleton h={40} r={8} />
                <Skeleton h={80} r={8} />
                <Skeleton w={100} h={34} r={8} />
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f3f4f6', padding: 20 }}>
              <Skeleton w={120} h={16} r={4} />
              <div style={{ marginTop: 16 }}><Skeleton h={13} r={4} /></div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
