'use client'

import React, { useState } from 'react'
import { Phone, RoundBtn, ChevLeft, ChevRight, BottomNav } from '../primitives'

// ── J8: Lab Selection ───────────────────────────────────────

const PANELS = [
  {
    name: 'Essentials',
    price: '$149',
    markers: '42 markers',
    turnaround: '3–5 days',
    highlight: false,
    features: ['Complete blood count', 'Metabolic panel', 'Lipid panel', 'Thyroid (TSH)'],
  },
  {
    name: 'Complete',
    price: '$289',
    markers: '87 markers',
    turnaround: '2–3 days',
    highlight: true,
    badge: 'Recommended',
    features: ['Everything in Essentials', 'ApoB · Lp(a) · Insulin', 'Hormones (full panel)', 'Inflammation (hs-CRP)', 'Vitamins D · B12 · Ferritin'],
  },
  {
    name: 'Longevity+',
    price: '$449',
    markers: '104 markers',
    turnaround: '2–4 days',
    highlight: false,
    features: ['Everything in Complete', 'Biological age estimate', 'Omega-3 index · GlycA', 'Telomere length', 'Full methylation panel'],
  },
]

export function J8_LabSelection() {
  const [selected, setSelected] = useState('Complete')

  return (
    <Phone label="08 Lab Selection" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 100 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.07, textTransform: 'uppercase', marginBottom: 6 }}>Lab panel</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02 }}>
            Choose your<br /><span style={{ fontStyle: 'italic' }}>panel.</span>
          </div>
        </div>
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {PANELS.map((p) => {
            const sel = selected === p.name
            return (
              <div
                key={p.name}
                onClick={() => setSelected(p.name)}
                style={{
                  borderRadius: 22,
                  border: sel ? '2px solid #241814' : '1px solid var(--line-bone-2)',
                  background: sel ? '#241814' : '#FBF4E8',
                  color: sel ? '#FBF4E8' : 'var(--t-1)',
                  padding: '18px 18px',
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                {p.badge && (
                  <div style={{
                    position: 'absolute', top: -10, left: 18,
                    background: '#E87A3E', color: '#fff',
                    fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                    letterSpacing: 0.04,
                  }}>
                    {p.badge}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.05, textTransform: 'uppercase', opacity: 0.6, marginBottom: 4 }}>{p.markers} · {p.turnaround}</div>
                    <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, lineHeight: 1 }}>{p.name}</div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1, letterSpacing: -0.02 }}>{p.price}</div>
                </div>
                <div style={{ marginTop: 14, borderTop: sel ? '1px solid rgba(244,241,234,0.15)' : '1px solid var(--line-bone)', paddingTop: 12 }}>
                  {p.features.map(f => (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6, opacity: 0.85 }}>
                      <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke={sel ? '#FBF4E8' : '#241814'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 24px 46px',
        background: 'linear-gradient(180deg, rgba(245,235,221,0) 0%, rgba(245,235,221,0.96) 30%, rgba(245,235,221,1) 100%)',
      }}>
        <button className="btn-prim" style={{ width: '100%' }}>
          Select {selected} · {PANELS.find(p => p.name === selected)?.price}
          <ChevRight c="#fff" size={14} />
        </button>
      </div>
    </Phone>
  )
}

// ── J9: Payment ─────────────────────────────────────────────

export function J9_Payment() {
  const [payMethod, setPayMethod] = useState('apple')

  return (
    <Phone label="09 Payment" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 110 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.07, textTransform: 'uppercase', marginBottom: 6 }}>Payment</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02 }}>
            One payment,<br /><span style={{ fontStyle: 'italic' }}>no subscription.</span>
          </div>
        </div>

        {/* Order summary */}
        <div style={{ margin: '0 20px 20px', borderRadius: 18, background: '#FBF4E8', border: '1px solid var(--line-bone-2)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-bone)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Complete panel</div>
                <div style={{ fontSize: 12, color: 'var(--t-3)', marginTop: 2 }}>87 markers · 2–3 day results</div>
              </div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 26, letterSpacing: -0.02 }}>$289</div>
            </div>
          </div>
          {[
            { label: 'Home draw fee', value: '$0', note: 'included' },
            { label: 'Clinician review', value: '$0', note: 'included' },
            { label: 'Tax', value: '$26' },
          ].map((row, i) => (
            <div key={i} style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-bone)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--t-2)' }}>{row.label}</span>
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: row.note ? 'var(--t-3)' : 'var(--t-1)' }}>
                {row.note ? `${row.value} · ${row.note}` : row.value}
              </span>
            </div>
          ))}
          <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Total</span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 24, letterSpacing: -0.02 }}>$315</span>
          </div>
        </div>

        {/* Payment options */}
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { id: 'apple', label: 'Apple Pay', icon: '🍎' },
            { id: 'card', label: 'Visa ···· 4242', icon: '💳' },
            { id: 'hsa', label: 'HSA / FSA Card', icon: '🏥' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setPayMethod(opt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 16,
                border: payMethod === opt.id ? '2px solid #241814' : '1px solid var(--line-bone-2)',
                background: payMethod === opt.id ? 'rgba(36,24,20,0.03)' : '#FBF4E8',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 22 }}>{opt.icon}</span>
              <span style={{ fontSize: 14, fontWeight: payMethod === opt.id ? 600 : 500, flex: 1 }}>{opt.label}</span>
              <div style={{
                width: 20, height: 20, borderRadius: 10,
                border: payMethod === opt.id ? '6px solid #241814' : '1.5px solid var(--line-bone)',
                background: 'transparent',
                flexShrink: 0,
              }} />
            </button>
          ))}
        </div>

        {/* Money-back badge */}
        <div style={{ margin: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'rgba(125,166,121,0.08)', border: '1px solid rgba(125,166,121,0.2)' }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <span style={{ fontSize: 12.5, color: '#1F5A2A', fontWeight: 500 }}>{"14-day money-back guarantee if we can't process your sample"}</span>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 24px 46px', background: 'linear-gradient(180deg, rgba(245,235,221,0) 0%, rgba(245,235,221,0.96) 30%, rgba(245,235,221,1) 100%)' }}>
        <button className="btn-prim" style={{ width: '100%' }}>
          Pay $315
          <ChevRight c="#fff" size={14} />
        </button>
      </div>
    </Phone>
  )
}

// ── J10: Booking ────────────────────────────────────────────

const DAYS = [
  { d: 'Mon', dt: 10, avail: true },
  { d: 'Tue', dt: 11, avail: true },
  { d: 'Wed', dt: 12, avail: true },
  { d: 'Thu', dt: 13, avail: false },
  { d: 'Fri', dt: 14, avail: true },
  { d: 'Sat', dt: 15, avail: true },
]
const TIMES = ['7:00 am', '8:00 am', '8:30 am', '9:00 am', '9:30 am', '10:00 am', '10:30 am', '11:00 am']

export function J10_Booking() {
  const [drawType, setDrawType] = useState<'home' | 'lab'>('home')
  const [selDay, setSelDay] = useState(1)
  const [selTime, setSelTime] = useState('8:30 am')

  return (
    <Phone label="10 Booking" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 110 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center' }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <div style={{ padding: '8px 24px 20px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.07, textTransform: 'uppercase', marginBottom: 6 }}>Schedule</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02 }}>
            Pick a time<br /><span style={{ fontStyle: 'italic' }}>that works.</span>
          </div>
        </div>

        {/* Draw type toggle */}
        <div style={{ margin: '0 20px 20px', display: 'flex', background: 'rgba(36,24,20,0.05)', borderRadius: 12, padding: 4 }}>
          {[{ id: 'home', label: '🏠 Home draw', sub: 'Phlebotomist comes to you' }, { id: 'lab', label: '🏥 Lab visit', sub: 'Visit a partner lab' }].map(opt => (
            <button
              key={opt.id}
              onClick={() => setDrawType(opt.id as typeof drawType)}
              style={{
                flex: 1, padding: '10px 8px', borderRadius: 9, border: 'none',
                background: drawType === opt.id ? '#FBF4E8' : 'transparent',
                cursor: 'pointer',
                boxShadow: drawType === opt.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: drawType === opt.id ? 'var(--t-1)' : 'var(--t-3)' }}>{opt.label}</div>
              <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>{opt.sub}</div>
            </button>
          ))}
        </div>

        {/* Day picker */}
        <div style={{ padding: '0 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--t-1)' }}>March 2026</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map((day, i) => {
              const sel = selDay === i
              return (
                <button
                  key={i}
                  onClick={() => day.avail && setSelDay(i)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 14,
                    border: sel ? '2px solid #241814' : '1px solid var(--line-bone-2)',
                    background: sel ? '#241814' : day.avail ? '#FBF4E8' : 'rgba(36,24,20,0.03)',
                    cursor: day.avail ? 'pointer' : 'default',
                    opacity: day.avail ? 1 : 0.4,
                  }}
                >
                  <div style={{ fontSize: 11, color: sel ? 'rgba(244,241,234,0.65)' : 'var(--t-3)', fontWeight: 500, textAlign: 'center' }}>{day.d}</div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, textAlign: 'center', color: sel ? '#FBF4E8' : 'var(--t-1)', marginTop: 2 }}>{day.dt}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Time grid */}
        <div style={{ padding: '0 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--t-1)' }}>Available times</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {TIMES.map(t => (
              <button
                key={t}
                onClick={() => setSelTime(t)}
                style={{
                  padding: '10px 0', borderRadius: 12,
                  border: selTime === t ? '2px solid #241814' : '1px solid var(--line-bone-2)',
                  background: selTime === t ? '#241814' : '#FBF4E8',
                  color: selTime === t ? '#FBF4E8' : 'var(--t-1)',
                  fontSize: 13, fontWeight: selTime === t ? 600 : 400, cursor: 'pointer',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 24px 46px', background: 'linear-gradient(180deg, rgba(245,235,221,0) 0%, rgba(245,235,221,0.96) 30%, rgba(245,235,221,1) 100%)' }}>
        <button className="btn-prim" style={{ width: '100%' }}>
          Confirm {DAYS[selDay]?.d}, Mar {DAYS[selDay]?.dt} at {selTime}
          <ChevRight c="#fff" size={14} />
        </button>
      </div>
    </Phone>
  )
}

// ── J11: Visit ──────────────────────────────────────────────

export function J11_Visit() {
  return (
    <Phone label="11 Visit" bg="#241814" dark time="9:41">
      <div style={{ position: 'absolute', inset: 0 }}>
        {/* Map background */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, #1A1410 0%, #2A1E18 40%, #1E1A14 100%)',
        }}>
          {/* Pseudo-map streets */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.35 }} viewBox="0 0 393 852">
            <line x1="0" y1="300" x2="393" y2="300" stroke="#3A3020" strokeWidth="2" />
            <line x1="0" y1="450" x2="393" y2="450" stroke="#3A3020" strokeWidth="2" />
            <line x1="100" y1="0" x2="100" y2="852" stroke="#3A3020" strokeWidth="2" />
            <line x1="250" y1="0" x2="250" y2="852" stroke="#3A3020" strokeWidth="2" />
            <line x1="350" y1="0" x2="350" y2="852" stroke="#3A3020" strokeWidth="2" />
            <path d="M100 300 Q150 350 250 300" stroke="#3A3020" strokeWidth="2" fill="none" />
            <path d="M0 400 Q100 380 200 420 Q300 440 393 400" stroke="#3A3020" strokeWidth="2" fill="none" />
          </svg>
          {/* User location dot */}
          <div style={{ position: 'absolute', left: '50%', top: '45%', transform: 'translate(-50%, -50%)' }}>
            <div style={{ width: 14, height: 14, borderRadius: 99, background: '#E87A3E', boxShadow: '0 0 0 6px rgba(232,122,62,0.25)', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: -12, borderRadius: 99, background: 'rgba(232,122,62,0.1)' }} />
            </div>
          </div>
          {/* Moving phleb dot */}
          <div style={{ position: 'absolute', left: '35%', top: '38%' }}>
            <div style={{ width: 12, height: 12, borderRadius: 99, background: '#4FB45C', boxShadow: '0 0 0 5px rgba(79,180,92,0.22)' }} />
          </div>
        </div>

        {/* Status card */}
        <div style={{
          position: 'absolute', left: 16, right: 16, top: 70,
          background: 'rgba(30,20,14,0.92)', backdropFilter: 'blur(20px)',
          borderRadius: 22, padding: 18, border: '1px solid rgba(244,241,234,0.10)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #4FB45C, #2A5227)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🩺</div>
            <div>
              <div style={{ fontSize: 10.5, color: 'rgba(244,241,234,0.55)', fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase' }}>On the way</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#FBF4E8', marginTop: 2 }}>Sarah M. · Certified phlebotomist</div>
              <div style={{ fontSize: 12.5, color: '#4FB45C', marginTop: 2, fontWeight: 500 }}>● Arrives in ~12 min</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button style={{ flex: 1, height: 40, borderRadius: 12, background: 'rgba(244,241,234,0.1)', color: '#FBF4E8', border: '1px solid rgba(244,241,234,0.15)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Message</button>
            <button style={{ flex: 1, height: 40, borderRadius: 12, background: '#FBF4E8', color: '#241814', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Call</button>
          </div>
        </div>

        {/* Pre-draw checklist */}
        <div style={{
          position: 'absolute', left: 16, right: 16, bottom: 50,
          background: 'rgba(30,20,14,0.92)', backdropFilter: 'blur(20px)',
          borderRadius: 22, padding: 18, border: '1px solid rgba(244,241,234,0.10)',
        }}>
          <div style={{ fontSize: 10.5, color: 'rgba(244,241,234,0.55)', fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', marginBottom: 12 }}>Pre-draw checklist</div>
          {[
            { label: '8-hour fast (water OK)', done: true },
            { label: 'Avoid heavy exercise today', done: true },
            { label: 'Have ID ready', done: false },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid rgba(244,241,234,0.08)' : 'none' }}>
              <div style={{
                width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                background: item.done ? '#4FB45C' : 'rgba(244,241,234,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: item.done ? 'none' : '1px solid rgba(244,241,234,0.2)',
              }}>
                {item.done && <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
              <span style={{ fontSize: 13.5, color: item.done ? 'rgba(244,241,234,0.6)' : '#FBF4E8', fontWeight: item.done ? 400 : 500, textDecoration: item.done ? 'line-through' : 'none' }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Phone>
  )
}

// ── J12: Waiting ────────────────────────────────────────────

export function J12_Waiting() {
  const steps = [
    { label: 'Sample collected', done: true },
    { label: 'Lab received', done: true },
    { label: 'Analysis in progress', done: false, active: true },
    { label: 'Clinician review', done: false },
  ]

  return (
    <Phone label="12 Waiting" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 32 }}>
        {/* Hero — Sunrise progress arc */}
        <div style={{
          margin: '12px 16px 0',
          borderRadius: 26,
          background: 'linear-gradient(160deg, #C9C2D5 0%, #B8B0CC 20%, #D9C5C2 42%, #F5C7A0 62%, #E87A3E 82%, #A2331A 100%)',
          height: 260,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Grain */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.3, mixBlendMode: 'overlay', background: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.1\'/%3E%3C/svg%3E")' }} />
          {/* Sunrise arc glow */}
          <div style={{
            position: 'absolute', left: '50%', bottom: -80, transform: 'translateX(-50%)',
            width: 360, height: 360, borderRadius: '50%',
            background: 'radial-gradient(circle at 50%, #FFE8C8 0%, #F6B15A 22%, #E87A3E 45%, transparent 70%)',
            filter: 'blur(2px)', opacity: 0.85,
          }} />
          {/* Chladni rings */}
          <svg viewBox="0 0 360 260" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.28, mixBlendMode: 'soft-light' }}>
            {[50, 80, 115, 155, 200].map((r, i) => (
              <circle key={i} cx="180" cy="240" r={r} fill="none" stroke="#FFE8C8" strokeWidth="0.6" opacity={1 - i * 0.16} />
            ))}
          </svg>
          <div style={{ position: 'absolute', top: 20, left: 20, right: 20 }}>
            <div style={{ fontSize: 10.5, color: 'rgba(36,24,20,0.65)', fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase' }}>Processing</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 38, lineHeight: 1.0, letterSpacing: -0.02, marginTop: 6, color: '#241814' }}>
              Your results<br />are cooking.
            </div>
            <div style={{ fontSize: 13, color: 'rgba(36,24,20,0.65)', marginTop: 8 }}>Estimated ready: Tue, Mar 12 · 7:00 am</div>
          </div>
        </div>

        {/* Progress tracker */}
        <div style={{ margin: '16px 16px 0', background: '#FBF4E8', borderRadius: 20, border: '1px solid var(--line-bone-2)', padding: 18 }}>
          <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.07, textTransform: 'uppercase', marginBottom: 14 }}>Pipeline</div>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: i < steps.length - 1 ? 16 : 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 12, flexShrink: 0,
                  background: s.done ? '#241814' : s.active ? 'rgba(232,122,62,0.15)' : 'var(--line-bone-2)',
                  border: s.active ? '2px solid #E87A3E' : s.done ? 'none' : '1.5px solid var(--line-bone)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {s.done ? <svg width="11" height="11" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#FBF4E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : s.active ? <div style={{ width: 8, height: 8, borderRadius: 4, background: '#E87A3E' }} />
                      : null}
                </div>
                {i < steps.length - 1 && <div style={{ width: 2, height: 16, marginTop: 4, background: s.done ? '#241814' : 'var(--line-bone-2)', borderRadius: 1 }} />}
              </div>
              <div style={{ paddingTop: 3 }}>
                <div style={{ fontSize: 13.5, fontWeight: s.active ? 600 : s.done ? 500 : 400, color: s.done || s.active ? 'var(--t-1)' : 'var(--t-3)' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Educational card */}
        <div style={{ margin: '14px 16px 0', background: '#FBF4E8', borderRadius: 18, border: '1px solid var(--line-bone-2)', padding: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, flexShrink: 0, background: 'radial-gradient(circle at 30%, #F5C7A0, #D14829 70%)' }} />
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t-3)', letterSpacing: 0.06, textTransform: 'uppercase' }}>4 MIN READ · CLINICIAN-REVIEWED</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, lineHeight: 1.2, marginTop: 4 }}>
              Why ApoB matters more than total cholesterol
            </div>
          </div>
        </div>
      </div>
    </Phone>
  )
}

// ── J13: Notification ───────────────────────────────────────

export function J13_Notification() {
  return (
    <Phone label="13 Notification" bg="#1A1410" dark time="7:42">
      <div style={{ position: 'absolute', inset: 0, paddingTop: 54 }}>
        {/* Lock screen time */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 80, lineHeight: 0.92, letterSpacing: -0.05, color: '#FBF4E8', fontFeatureSettings: '"tnum","lnum"' }}>7:42</div>
          <div style={{ fontSize: 16, color: 'rgba(244,241,234,0.65)', marginTop: 6 }}>Monday, March 12</div>
        </div>

        {/* Notification card */}
        <div style={{
          margin: '40px 16px 0',
          background: 'rgba(30,22,16,0.85)', backdropFilter: 'blur(24px)',
          borderRadius: 20, padding: 18, border: '1px solid rgba(244,241,234,0.12)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg, #F5C7A0 0%, #A2331A 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 18 }}>🌅</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF4E8' }}>VitaLens</div>
                <div style={{ fontSize: 11, color: 'rgba(244,241,234,0.5)', marginTop: 1 }}>now</div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: '#FBF4E8', marginBottom: 6 }}>
            Your results are ready 🎉
          </div>
          <div style={{ fontSize: 13, color: 'rgba(244,241,234,0.72)', lineHeight: 1.45 }}>
            87 biomarkers analyzed. Your VitaLens score is <strong style={{ color: '#F5C7A0' }}>82</strong> — up 3 points from your baseline.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button style={{ flex: 1, height: 36, borderRadius: 10, background: 'rgba(244,241,234,0.12)', color: '#FBF4E8', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Later</button>
            <button style={{ flex: 1, height: 36, borderRadius: 10, background: 'linear-gradient(180deg, #F6B15A 0%, #D14829 100%)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>View results</button>
          </div>
        </div>

        {/* Home indicator */}
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: 134, height: 5, background: 'rgba(244,241,234,0.25)', borderRadius: 99 }} />
      </div>
    </Phone>
  )
}
