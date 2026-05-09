'use client'

import React from 'react'
import { Phone, BottomNav, StatusPill, RangeBar, Sparkline, RoundBtn, ChevLeft, ChevRight, Arrow } from '../primitives'

// ── TrendChart ───────────────────────────────────────────────

function TrendChart({ points, optMin, optMax, min, max }: { points: number[]; optMin: number; optMax: number; min: number; max: number }) {
  const W = 320, H = 170
  const PADL = 28, PADR = 8, PADT = 8, PADB = 26
  const innerW = W - PADL - PADR
  const innerH = H - PADT - PADB
  const xAt = (i: number) => PADL + (i / (points.length - 1)) * innerW
  const yAt = (v: number) => PADT + (1 - (v - min) / (max - min)) * innerH

  const optTop = yAt(optMax), optBottom = yAt(optMin)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(p).toFixed(1)}`).join(' ')
  const fillPath = path + ` L${xAt(points.length - 1)} ${H - PADB} L${PADL} ${H - PADB} Z`
  const lastX = xAt(points.length - 1), lastY = yAt(points[points.length - 1])

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[min, optMin, optMax, max].map((g, i) => (
        <g key={i}>
          <line x1={PADL} x2={W - PADR} y1={yAt(g)} y2={yAt(g)} stroke="rgba(36,24,20,0.06)" strokeWidth="1" strokeDasharray={g === optMin || g === optMax ? '0' : '2 3'} />
          <text x={PADL - 6} y={yAt(g) + 3} textAnchor="end" fontSize="9" fill="rgba(36,24,20,0.4)" fontFamily="var(--font-mono)">{g}</text>
        </g>
      ))}
      <rect x={PADL} y={optTop} width={innerW} height={optBottom - optTop} fill="rgba(75,166,82,0.10)" />
      <text x={W - PADR - 4} y={optTop + 11} textAnchor="end" fontSize="9" fill="#7DA679" fontWeight="600">OPTIMAL</text>
      <defs>
        <linearGradient id="apobGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E87A3E" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#E87A3E" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#apobGrad)" />
      <path d={path} stroke="#241814" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(p)} r={i === points.length - 1 ? 4 : 2} fill={i === points.length - 1 ? '#E87A3E' : '#241814'} />
      ))}
      <g transform={`translate(${lastX - 36}, ${lastY - 22})`}>
        <rect x="0" y="0" width="42" height="18" rx="4" fill="#241814" />
        <text x="21" y="12" textAnchor="middle" fontSize="10" fontWeight="600" fill="#FBF4E8" fontFamily="var(--font-mono)">105</text>
      </g>
      {['Dec', 'Jan', 'Feb', 'Mar'].map((m, i) => (
        <text key={m} x={PADL + (i / 3) * innerW} y={H - 8} textAnchor="middle" fontSize="9.5" fill="rgba(36,24,20,0.5)" fontWeight="500">{m}</text>
      ))}
    </svg>
  )
}

// ── J15: Biomarker Detail ────────────────────────────────────

export function J15_BiomarkerDetail() {
  const trend = [88, 90, 92, 94, 91, 95, 97, 100, 98, 102, 104, 105]

  return (
    <Phone label="15 Biomarker Detail" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 110 }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px 14px' }}>
          <RoundBtn><ChevLeft size={18} c="#241814" /></RoundBtn>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 500, letterSpacing: 0.06, textTransform: 'uppercase' }}>Cardiovascular</div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.01, marginTop: 1 }}>ApoB</div>
          </div>
          <RoundBtn>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7" stroke="#241814" strokeWidth="1.5" />
              <path d="M9 12V8M9 5.5v.01" stroke="#241814" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </RoundBtn>
        </div>

        {/* Safety banner */}
        <div style={{
          margin: '0 16px 14px', padding: '10px 14px', borderRadius: 14,
          background: 'rgba(232,122,62,0.10)', border: '1px solid rgba(232,122,62,0.25)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 12.5, color: '#7A2E1A',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5l7 12.5H1L8 1.5z" stroke="#7A2E1A" strokeWidth="1.4" fill="rgba(232,122,62,0.25)" />
            <path d="M8 6v3.5M8 11.5v.01" stroke="#7A2E1A" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontWeight: 500 }}>This is a signal, not a diagnosis.</span>
        </div>

        {/* Hero value card */}
        <div style={{ margin: '0 16px 14px', borderRadius: 26, overflow: 'hidden', background: '#241814', color: '#FBF4E8', padding: 22, position: 'relative' }}>
          <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: 999, background: 'radial-gradient(circle, rgba(232,122,62,0.45), rgba(232,122,62,0) 60%)', pointerEvents: 'none' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div className="caps caps-ink" style={{ fontSize: 10.5 }}>ApoB · MAR 12 · 2026</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 80, lineHeight: 0.95, letterSpacing: -0.05, marginTop: 8, fontFeatureSettings: '"tnum","lnum"' }}>
                105
                <span style={{ fontSize: 18, color: 'rgba(244,241,234,0.6)', marginLeft: 6, fontFamily: 'var(--font-sans)', letterSpacing: 0 }}>mg/dL</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12.5, color: '#F5C7A0', fontWeight: 500 }}>
                <Arrow dir="up" size={11} c="#F5C7A0" /> +8% over 90 days
              </div>
            </div>
            <StatusPill kind="out" dark />
          </div>
          <div style={{ marginTop: 22 }}>
            <RangeBar min={50} max={140} optMin={60} optMax={90} value={105} status="out" dark />
          </div>
          <button style={{
            marginTop: 20, height: 50, width: '100%', borderRadius: 999,
            background: 'linear-gradient(180deg, #F6B15A 0%, #D14829 100%)',
            color: '#fff', border: 'none', fontWeight: 600, fontSize: 15,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
          }}>
            Talk to a clinician <ChevRight c="#fff" size={14} />
          </button>
        </div>

        {/* Trend */}
        <div style={{ padding: '8px 20px 0' }}>
          <div className="sect-h">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-1)' }}>Trend</span>
            <div style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'rgba(36,24,20,0.05)', border: '1px solid var(--line-bone-2)' }}>
              {['6m', '1y', 'All'].map((s, i) => (
                <span key={s} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: i === 0 ? '#241814' : 'transparent', color: i === 0 ? '#FBF4E8' : 'var(--t-2)' }}>{s}</span>
              ))}
            </div>
          </div>
          <div style={{ background: '#FBF4E8', borderRadius: 22, border: '1px solid var(--line-bone-2)', padding: '18px 16px 14px', height: 220, position: 'relative' }}>
            <TrendChart points={trend} optMin={60} optMax={90} min={50} max={130} />
          </div>
        </div>

        {/* What this means */}
        <div style={{ padding: '20px 20px 0' }}>
          <div className="caps">What this means</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1.3, marginTop: 6, letterSpacing: -0.01, color: 'var(--t-1)' }}>
            ApoB counts the cholesterol-carrying particles most linked to heart-disease risk.
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--t-2)', marginTop: 10 }}>
            Lower ApoB is associated with lower long-term cardiovascular risk. Your reading is modestly above optimal —{' '}
            <span style={{ color: 'var(--t-1)', fontWeight: 500 }}>lifestyle changes often move it measurably</span> within 90 days.
          </div>
        </div>

        {/* What affects this */}
        <div style={{ padding: '22px 20px 0' }}>
          <div className="caps">What affects this marker</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {[['Diet', '🥗'], ['Sleep', '😴'], ['Exercise', '🏃'], ['Medications', '💊'], ['Body composition', '⚖'], ['Genetics', '🧬']].map(([t, ic]) => (
              <span key={t} className="chip" style={{ height: 34, fontSize: 13 }}>
                <span style={{ fontSize: 14 }}>{ic}</span>{t}
              </span>
            ))}
          </div>
        </div>

        {/* Related biomarkers */}
        <div style={{ padding: '22px 20px 0' }}>
          <div className="sect-h">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-1)' }}>Related biomarkers</span>
            <span className="more">Cardiovascular</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { n: 'LDL-C', v: '138 mg/dL', st: 'watch' as const, trend: [120, 125, 130, 128, 132, 135, 138], c: '#E58A0A' },
              { n: 'Lp(a)', v: '62 nmol/L', st: 'out' as const, trend: [58, 59, 60, 60, 61, 62, 62], c: '#E87A3E' },
              { n: 'Triglyc.', v: '118 mg/dL', st: 'inrange' as const, trend: [140, 135, 130, 125, 120, 118, 118], c: '#7DA679' },
              { n: 'HDL-C', v: '58 mg/dL', st: 'optimal' as const, trend: [50, 52, 54, 55, 56, 57, 58], c: '#4FB45C' },
            ].map(b => (
              <div key={b.n} style={{ background: '#FBF4E8', borderRadius: 18, border: '1px solid var(--line-bone-2)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{b.n}</span>
                  <StatusPill kind={b.st} />
                </div>
                <div className="num" style={{ fontSize: 12.5, color: 'var(--t-2)', marginTop: 2 }}>{b.v}</div>
                <div style={{ marginTop: 8 }}>
                  <Sparkline points={b.trend} color={b.c} w={130} height={28} fill />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Discuss with doctor */}
        <div style={{ padding: '22px 20px 0' }}>
          <div style={{ background: '#241814', color: '#FBF4E8', borderRadius: 22, padding: 20 }}>
            <div className="caps caps-ink">Discuss with your doctor</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, lineHeight: 1.25, marginTop: 8, letterSpacing: -0.01 }}>Three questions to bring with you.</div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {['Should I retest in 90 days?', 'Do my family history & ApoB change my CVD risk plan?', 'Are lifestyle changes enough — or should I consider medication?'].map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: i > 0 ? '1px solid rgba(244,241,234,0.10)' : 'none', paddingTop: i > 0 ? 12 : 0, fontSize: 14, lineHeight: 1.4 }}>
                  <div className="num" style={{ fontFamily: 'var(--font-serif)', color: '#F5C7A0', fontSize: 16, lineHeight: 1, minWidth: 14 }}>0{i + 1}</div>
                  <div>{q}</div>
                </div>
              ))}
            </div>
            <button style={{ marginTop: 16, height: 42, width: '100%', borderRadius: 999, background: 'rgba(244,241,234,0.10)', color: '#FBF4E8', border: '1px solid rgba(244,241,234,0.18)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Copy questions</button>
          </div>
        </div>

        {/* Sources */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: '1px solid var(--line-bone)', fontSize: 12.5, color: 'var(--t-2)' }}>
            <span>2 sources · AHA 2024, NEJM 2023</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>View <ChevRight size={11} c="var(--t-2)" /></span>
          </div>
        </div>
        <div style={{ height: 30 }} />
      </div>

      {/* Floating Ask AI */}
      <button style={{
        position: 'absolute', right: 16, bottom: 110, zIndex: 65,
        height: 50, padding: '0 18px', borderRadius: 999,
        background: '#241814', color: '#FBF4E8', border: '1px solid rgba(244,241,234,0.15)',
        boxShadow: '0 14px 32px rgba(36,24,20,0.35)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontSize: 14, fontWeight: 600, cursor: 'pointer',
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1.2l1.4 3.1 3.1.4-2.4 2 .8 3.1L7 8.2l-2.9 1.6.8-3.1-2.4-2 3.1-.4L7 1.2z" fill="#F5C7A0" />
        </svg>
        Ask about ApoB
      </button>

      <BottomNav active="results" />
    </Phone>
  )
}
