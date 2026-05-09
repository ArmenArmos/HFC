'use client'

import React, { useState } from 'react'
import { Phone, BottomNav, RoundBtn, ChevLeft, ChevRight } from '../primitives'

// ── Shared sub-component ─────────────────────────────────────

function SectionH({ title, right, mt = 8 }: { title: string; right?: string; mt?: number }) {
  return (
    <div style={{ padding: '0 20px', marginTop: mt, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-1)', letterSpacing: -0.005 }}>{title}</div>
      {right && <div style={{ fontSize: 11, color: 'var(--t-3)', fontWeight: 500 }}>{right}</div>}
    </div>
  )
}

// ── J23: Today ───────────────────────────────────────────────

const TODAY_TASKS = [
  { l: 'Sat fat under 16 g', sub: 'Logged 11 g', on: true, lane: 'Plan' },
  { l: 'Z2 cardio · 50 min', sub: 'Treadmill 6.4', on: true, lane: 'Plan' },
  { l: 'Vitamin D 4,000 IU', sub: 'Morning · taken 7:24a', on: true, lane: 'Plan' },
  { l: 'Magnesium glycinate', sub: '30 min before bed', on: false, lane: 'Plan' },
  { l: 'Wind-down · screens off 9:30', sub: 'Tonight', on: false, lane: 'Plan' },
]

const SIGNALS = [
  { l: 'Sleep', v: '6h 42m', sub: 'Below your 7h goal', c: '#E89B85', trend: [7, 7.5, 6.8, 6.5, 6.2, 7, 6.7] },
  { l: 'HRV', v: '48', sub: 'ms · last night', c: '#7DA679', trend: [42, 44, 46, 45, 47, 46, 48] },
  { l: 'Resting HR', v: '58', sub: 'bpm · 7-day avg', c: '#7DA679', trend: [62, 60, 59, 58, 59, 58, 58] },
  { l: 'Steps', v: '4,210', sub: 'so far today', c: '#241814', trend: [1, 2, 2.5, 3, 3.5, 4, 4.2] },
]

const WEEKLY_ADHERENCE = [80, 100, 90, 75, 60, 0, 0]

export function J23_Today() {
  const [tasks, setTasks] = useState(TODAY_TASKS)
  const doneCount = tasks.filter(t => t.on).length

  return (
    <Phone label="23 Today" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 100 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px 14px' }}>
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--t-3)', fontWeight: 500 }}>Wednesday, November 11</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 26, lineHeight: 1.1, letterSpacing: -0.02, marginTop: 2 }}>
              Good morning,<br /><span style={{ fontStyle: 'italic' }}>Maya.</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <RoundBtn size={40}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 6a5 5 0 0110 0v3l1 2H2l1-2V6z" stroke="var(--t-1)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 13a1.5 1.5 0 003 0" stroke="var(--t-1)" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </RoundBtn>
            <div style={{ width: 40, height: 40, borderRadius: 99, background: 'linear-gradient(135deg, #E87A3E, #D14829)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FBF4E8', fontSize: 14, fontWeight: 600 }}>M</div>
          </div>
        </div>

        {/* Today's focus hero */}
        <div style={{ margin: '0 16px 16px', borderRadius: 22, padding: '20px 20px', background: 'linear-gradient(135deg, #241814 0%, #2E1F1A 100%)', color: '#FBF4E8', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -30, top: -30, width: 180, height: 180, borderRadius: 99, background: 'radial-gradient(circle, rgba(245,199,160,0.32) 0%, transparent 70%)' }} />
          <div className="caps caps-ink">{"TODAY'S FOCUS · DAY 28 OF 90"}</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 26, lineHeight: 1.15, letterSpacing: -0.01, marginTop: 8, position: 'relative' }}>
            Get ApoB <span style={{ fontStyle: 'italic', color: '#F5C7A0' }}>under 80.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, position: 'relative', paddingTop: 14, borderTop: '1px solid rgba(244,241,234,0.12)' }}>
            <div>
              <div style={{ fontSize: 9.5, color: 'rgba(244,241,234,0.5)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600 }}>VitaLens</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 30, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>82</span>
                <span style={{ fontSize: 11, color: '#7DA679', fontWeight: 600 }}>+3</span>
              </div>
            </div>
            <div style={{ width: 1, height: 32, background: 'rgba(244,241,234,0.15)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9.5, color: 'rgba(244,241,234,0.5)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600 }}>ApoB</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>105</span>
                <ChevRight size={11} c="#F5C7A0" />
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1, fontStyle: 'italic', color: '#F5C7A0', fontFeatureSettings: '"tnum"' }}>&lt;80</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tasks lane */}
        <SectionH title="Daily tasks" right={`${doneCount} of ${tasks.length} done`} />
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((t, i) => (
            <button
              key={i}
              onClick={() => setTasks(prev => prev.map((x, j) => j === i ? { ...x, on: !x.on } : x))}
              style={{
                padding: '12px 14px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                background: t.on ? 'rgba(125,166,121,0.08)' : '#FBF4E8',
                border: t.on ? '1px solid rgba(125,166,121,0.22)' : '1px solid var(--line-bone-2)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: t.on ? '#7DA679' : 'transparent', border: t.on ? 'none' : '1.4px solid var(--line-bone)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {t.on && <svg width="13" height="13" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: t.on ? 'var(--t-2)' : 'var(--t-1)', textDecoration: t.on ? 'line-through' : 'none' }}>{t.l}</div>
                <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>{t.sub}</div>
              </div>
              <span style={{ fontSize: 9.5, fontWeight: 600, padding: '3px 8px', borderRadius: 99, background: 'rgba(36,24,20,0.06)', color: 'var(--t-3)', letterSpacing: 0.04 }}>{t.lane}</span>
            </button>
          ))}
        </div>

        {/* Signals lane */}
        <SectionH title="Signals · today" right="from your wearables" mt={22} />
        <div style={{ padding: '0 16px', display: 'flex', gap: 10, overflowX: 'auto' }}>
          {SIGNALS.map((s, i) => (
            <div key={i} style={{ minWidth: 160, padding: '14px 14px', borderRadius: 16, background: '#FBF4E8', border: '1px solid var(--line-bone-2)', flexShrink: 0 }}>
              <div className="caps">{s.l}</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, lineHeight: 1.05, marginTop: 6, fontFeatureSettings: '"tnum"' }}>{s.v}</div>
              <div style={{ fontSize: 10.5, color: s.c, fontWeight: 600, marginTop: 3 }}>{s.sub}</div>
              <svg viewBox={`0 0 100 24`} preserveAspectRatio="none" style={{ width: '100%', height: 24, marginTop: 8 }}>
                <polyline
                  points={s.trend.map((v, k) => `${k * 100 / (s.trend.length - 1)},${24 - v * 3}`).join(' ')}
                  stroke={s.c} strokeWidth="1.4" fill="none"
                />
              </svg>
            </div>
          ))}
        </div>

        {/* Plan lane */}
        <SectionH title="This week's plan" right="Adherence 78%" mt={22} />
        <div style={{ margin: '0 16px', padding: '14px 16px', borderRadius: 16, background: '#FBF4E8', border: '1px solid var(--line-bone-2)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 54 }}>
            {WEEKLY_ADHERENCE.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: '100%', height: `${Math.max(v, 8)}%`, borderRadius: 6, background: v === 0 ? 'rgba(36,24,20,0.06)' : i === 4 ? '#F5C7A0' : '#241814' }} />
                <span style={{ fontSize: 9, color: i === 4 ? 'var(--t-1)' : 'var(--t-3)', fontWeight: i === 4 ? 600 : 500 }}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-bone)', fontSize: 11.5 }}>
            <span style={{ color: 'var(--t-3)' }}>{"Today's tasks"}</span>
            <span style={{ color: 'var(--t-1)', fontWeight: 600 }}>{doneCount} / {tasks.length} done</span>
          </div>
        </div>
        <div style={{ height: 30 }} />
      </div>
      <BottomNav active="home" />
    </Phone>
  )
}

// ── J24: AI Chat ─────────────────────────────────────────────

const AiOrb = ({ size = 28 }: { size?: number }) => (
  <span style={{ position: 'relative', width: size, height: size, display: 'inline-block', flexShrink: 0 }}>
    <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 50% 40%, #FFE8C8 0%, #F6B15A 30%, #E87A3E 60%, #A2331A 100%)' }} />
    <span style={{ position: 'absolute', inset: Math.round(size * 0.14), borderRadius: '50%', background: 'radial-gradient(circle at 50% 60%, rgba(255,232,200,0.85) 0%, transparent 65%)', mixBlendMode: 'screen' }} />
    <span style={{ position: 'absolute', inset: -Math.round(size * 0.1), borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,122,62,0.4) 0%, transparent 65%)', filter: 'blur(2px)' }} />
  </span>
)

export function J24_AIChat() {
  return (
    <Phone label="24 AI Chat" bg="#F5EBDD" time="9:41">
      <div style={{ position: 'absolute', inset: 0, paddingTop: 54, display: 'flex', flexDirection: 'column' }}>
        {/* Top bar */}
        <div style={{ padding: '10px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line-bone)' }}>
          <RoundBtn><ChevLeft size={18} /></RoundBtn>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <AiOrb size={20} />
              Ask Vita
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>Voice-AI assistant · Knows your 104 markers</div>
          </div>
          <RoundBtn>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="var(--t-1)" strokeWidth="1.3" /><path d="M7 4v3l2 1.5" stroke="var(--t-1)" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </RoundBtn>
        </div>

        {/* Sound-wave banner */}
        <div style={{ margin: '12px 14px 0', height: 54, borderRadius: 14, position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg, #C9C2D5 0%, #F5C7A0 60%, #E87A3E 100%)', flexShrink: 0 }}>
          <svg viewBox="0 0 320 54" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55, mixBlendMode: 'soft-light' }}>
            {Array.from({ length: 64 }).map((_, i) => {
              const t = i / 63
              const env = Math.sin(t * Math.PI)
              const h = (0.25 + 0.75 * Math.abs(Math.sin(i * 0.83) * Math.cos(i * 0.41))) * env * 38 + 4
              return <rect key={i} x={i * 5} y={(54 - h) / 2} width="2.4" height={h} rx="1.2" fill="#241814" />
            })}
          </svg>
          <div style={{ position: 'absolute', left: 14, top: 8, fontSize: 10, color: 'rgba(36,24,20,0.72)', fontWeight: 600, letterSpacing: 0.08, textTransform: 'uppercase' }}>Listening · Tap to speak</div>
          <div style={{ position: 'absolute', right: 12, bottom: 8, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(36,24,20,0.7)', fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#D14829', boxShadow: '0 0 8px rgba(209,72,41,0.7)' }} />
            Live
          </div>
        </div>

        {/* Messages */}
        <div className="phone-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Suggestion chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {['Why is my ApoB high?', 'Explain HRV', 'What should I eat today?', 'Compare to last test'].map(s => (
              <span key={s} style={{ fontSize: 11.5, padding: '6px 12px', borderRadius: 99, background: '#FBF4E8', border: '1px solid var(--line-bone-2)', color: 'var(--t-2)', fontWeight: 500 }}>{s}</span>
            ))}
          </div>

          {/* User message */}
          <div style={{ alignSelf: 'flex-end', maxWidth: '82%' }}>
            <div style={{ padding: '10px 14px', borderRadius: '18px 18px 4px 18px', background: '#241814', color: '#FBF4E8', fontSize: 14, lineHeight: 1.4 }}>
              Why is my ApoB still climbing even though I cut red meat?
            </div>
          </div>

          {/* AI response */}
          <div style={{ alignSelf: 'flex-start', maxWidth: '88%', display: 'flex', gap: 8 }}>
            <AiOrb size={28} />
            <div>
              <div style={{ padding: '12px 14px', borderRadius: '18px 18px 18px 4px', background: '#FBF4E8', border: '1px solid var(--line-bone-2)', fontSize: 14, lineHeight: 1.5 }}>
                Cutting red meat helped — your saturated fat dropped 22% — but ApoB is influenced more by{' '}
                <strong style={{ color: '#7A2E1A' }}>total saturated fat</strong> than red meat alone. Your latest food log shows cheese and butter making up 9 g/day, putting total sat fat at 21 g (target: &lt;16 g).
                <div style={{ margin: '10px 0', padding: '10px 12px', borderRadius: 10, background: 'rgba(232,122,62,0.08)', border: '1px solid rgba(232,122,62,0.2)' }}>
                  <div style={{ fontSize: 11.5, color: '#7A2E1A', fontWeight: 600, letterSpacing: 0.04, textTransform: 'uppercase', marginBottom: 4 }}>Linked biomarker</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>ApoB · 105 mg/dL</span>
                    <span style={{ fontSize: 11.5, color: '#E87A3E', fontWeight: 600 }}>↑ +8% in 90d</span>
                  </div>
                </div>
                Try swapping butter for olive oil and limiting cheese to 2 servings/week. I can update your plan.
              </div>
              {/* Action chips */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button style={{ height: 30, padding: '0 12px', borderRadius: 99, background: '#241814', color: '#FBF4E8', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Update plan</button>
                <button style={{ height: 30, padding: '0 12px', borderRadius: 99, background: 'transparent', color: 'var(--t-1)', border: '1px solid var(--line-bone-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>See ApoB detail</button>
                <button style={{ height: 30, padding: '0 12px', borderRadius: 99, background: 'transparent', color: 'var(--t-1)', border: '1px solid var(--line-bone-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Sources (3)</button>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="4.5" stroke="var(--t-3)" strokeWidth="1" /><path d="M5.5 3v3l1.5 1" stroke="var(--t-3)" strokeWidth="1" /></svg>
                Reviewed by Dr. Richina · 2 days ago
              </div>
            </div>
          </div>

          {/* Confirmation */}
          <div style={{ alignSelf: 'flex-start', maxWidth: '82%', display: 'flex', gap: 8 }}>
            <div style={{ width: 28 }} />
            <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(125,166,121,0.1)', border: '1px solid rgba(125,166,121,0.25)', fontSize: 13, lineHeight: 1.45 }}>
              ✓ Added 2 new tasks to your <strong>Plan</strong>:
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5, color: 'var(--t-2)' }}>
                <span>· Swap butter → olive oil at breakfast</span>
                <span>· Cap cheese at 2 servings/week</span>
              </div>
            </div>
          </div>
        </div>

        {/* Composer */}
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--line-bone)', background: '#F5EBDD' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FBF4E8', border: '1px solid var(--line-bone-2)', borderRadius: 24, padding: '6px 6px 6px 16px' }}>
            <span style={{ fontSize: 14, color: 'var(--t-3)', flex: 1 }}>Ask anything about your health…</span>
            <button style={{ height: 36, width: 36, borderRadius: 99, background: '#241814', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l10-4-4 10-1.5-4.5L2 7z" stroke="#FBF4E8" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10, color: 'var(--t-3)' }}>
            Always ask a clinician before changing meds. Answers cite your records.
          </div>
        </div>
      </div>
    </Phone>
  )
}

// ── J25: Wearables Connect ───────────────────────────────────

const WEARABLES = [
  { n: 'Apple Health', sub: 'Steps · sleep · HR · workouts', connected: true, ic: '❤', primary: true },
  { n: 'Oura Ring', sub: 'Sleep stages · HRV · readiness', connected: true, ic: '○' },
  { n: 'Whoop 4.0', sub: 'Recovery · strain · sleep', connected: false, ic: 'W' },
  { n: 'Garmin Connect', sub: 'GPS · workouts · HR', connected: false, ic: 'G' },
  { n: 'Dexcom G7', sub: 'Continuous glucose monitor', connected: false, ic: '⌬', beta: true },
]

export function J25_Wearables() {
  const [connected, setConnected] = useState(new Set(['Apple Health', 'Oura Ring']))

  return (
    <Phone label="25 Wearables" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 120 }}>
        <div style={{ padding: '10px 20px' }}><RoundBtn><ChevLeft size={18} /></RoundBtn></div>
        <div style={{ padding: '6px 20px 18px' }}>
          <div className="caps">Optional · 30 seconds</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02, marginTop: 8 }}>
            Connect your<br /><span style={{ fontStyle: 'italic' }}>wearables.</span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--t-2)', marginTop: 10, lineHeight: 1.45 }}>
            {"We'll layer your daily signals on top of your blood markers — sleep next to cortisol, HRV next to inflammation. Your data stays yours."}
          </div>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {WEARABLES.map((d, i) => {
            const isConn = connected.has(d.n)
            return (
              <div key={i} style={{ padding: '14px 14px', borderRadius: 16, background: isConn ? 'rgba(125,166,121,0.06)' : '#FBF4E8', border: isConn ? '1px solid rgba(125,166,121,0.25)' : '1px solid var(--line-bone-2)', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, background: d.primary ? 'linear-gradient(135deg, #F5C7A0, #A2331A)' : '#FBF4E8', border: d.primary ? 'none' : '1px solid var(--line-bone-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600 }}>{d.ic}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: -0.005 }}>{d.n}</div>
                    {d.beta && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(36,24,20,0.08)', color: 'var(--t-2)', letterSpacing: 0.05 }}>BETA</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--t-3)', marginTop: 2 }}>{d.sub}</div>
                </div>
                {isConn ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: '#7DA679' }} />
                    <span style={{ fontSize: 11.5, color: '#7DA679', fontWeight: 600 }}>Connected</span>
                  </div>
                ) : (
                  <button onClick={() => setConnected(prev => new Set([...prev, d.n]))}
                    style={{ height: 32, padding: '0 14px', borderRadius: 99, background: '#241814', color: '#FBF4E8', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Connect
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ margin: '22px 16px 0', padding: '14px 16px', borderRadius: 16, background: '#FBF4E8', border: '1px dashed var(--line-bone-2)' }}>
          <div className="caps" style={{ marginBottom: 8 }}>How we use your data</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--t-2)', lineHeight: 1.5 }}>
            {['Show daily signals on your Today screen alongside biomarkers.', 'Personalize tasks (e.g. earlier bedtime when HRV drops).', 'Train your AI assistant on your full picture, not just one panel.'].map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}><span style={{ color: '#7DA679' }}>✓</span><span>{t}</span></div>
            ))}
            <div style={{ display: 'flex', gap: 8, paddingTop: 6, borderTop: '1px solid var(--line-bone)' }}>
              <span style={{ color: 'var(--t-3)' }}>✗</span>
              <span style={{ color: 'var(--t-3)' }}>Never sold or shared with third parties.</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 20px 38px', background: 'linear-gradient(180deg, rgba(241,236,227,0) 0%, rgba(245,235,221,0.96) 30%, rgba(245,235,221,1) 100%)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ flex: 1, height: 54, borderRadius: 99, background: 'transparent', color: 'var(--t-1)', border: '1px solid var(--line-bone-2)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Skip for now</button>
          <button className="btn-prim" style={{ flex: 1.4 }}>Continue with {connected.size} sources</button>
        </div>
      </div>
    </Phone>
  )
}

// ── J26: Signals ─────────────────────────────────────────────

const SIGNAL_GRID = [
  { l: 'HRV', v: '48', u: 'ms', trend: '↑', c: '#7DA679', note: 'Trending up' },
  { l: 'Resting HR', v: '58', u: 'bpm', trend: '−', c: 'var(--t-2)', note: 'Stable' },
  { l: 'Steps', v: '7,420', u: 'avg/day', trend: '↑', c: '#7DA679', note: 'Above goal' },
  { l: 'Workouts', v: '4', u: '/ week', trend: '↑', c: '#7DA679', note: 'Z2 hitting target' },
  { l: 'Stress', v: 'Moderate', u: '', trend: '↑', c: '#E89B85', note: 'Up Mon–Wed' },
  { l: 'Glucose', v: '94', u: 'mg/dL avg', trend: '−', c: '#7DA679', note: 'Stable in range' },
]

const PATTERNS = [
  { i: 'Sleep ↔ ApoB', n: 'Nights under 7h correlate with +12% next-day saturated fat intake.', c: '#E89B85' },
  { i: 'HRV ↔ Stress', n: 'Your HRV recovers ~10ms after Z2 cardio days.', c: '#7DA679' },
  { i: 'Steps ↔ Glucose', n: 'Days over 8k steps show 14 mg/dL lower post-meal glucose.', c: '#7DA679' },
]

export function J26_Signals() {
  const SLEEP_BARS = [6.5, 7.2, 6.8, 5.9, 6.4, 7.0, 6.7]

  return (
    <Phone label="26 Signals" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px' }}>
          <RoundBtn><ChevLeft size={18} /></RoundBtn>
          <RoundBtn>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2" stroke="var(--t-1)" strokeWidth="1.3" /><path d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.4 1.4M9.6 9.6l1.4 1.4M3 11l1.4-1.4M9.6 4.4l1.4-1.4" stroke="var(--t-1)" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </RoundBtn>
        </div>

        <div style={{ padding: '6px 20px 18px' }}>
          <div className="caps">Live · last 7 days</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 30, lineHeight: 1.05, letterSpacing: -0.02, marginTop: 8 }}>
            Daily signals,<br /><span style={{ fontStyle: 'italic' }}>cross-linked.</span>
          </div>
        </div>

        {/* Sleep hero */}
        <div style={{ margin: '0 16px 12px', padding: 18, borderRadius: 20, background: '#241814', color: '#FBF4E8', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -30, top: -30, width: 160, height: 160, borderRadius: 99, background: 'radial-gradient(circle, rgba(255,143,77,0.32) 0%, transparent 70%)' }} />
          <div className="caps caps-ink">SLEEP · 7-DAY AVG</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6, position: 'relative' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 40, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>6h 38m</span>
            <span style={{ fontSize: 11.5, color: '#E89B85', fontWeight: 600 }}>−22 min vs goal</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 14, height: 44, position: 'relative' }}>
            {SLEEP_BARS.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: '100%', height: `${v * 10}%`, borderRadius: 4, background: v >= 7 ? '#7DA679' : v >= 6.5 ? '#F5C7A0' : '#E89B85' }} />
                <span style={{ fontSize: 9, color: 'rgba(244,241,234,0.5)' }}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(244,241,234,0.12)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
              <circle cx="7" cy="7" r="6" stroke="#F5C7A0" strokeWidth="1.3" />
              <path d="M7 4v3l2 1.5" stroke="#F5C7A0" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'rgba(244,241,234,0.85)' }}>
              On nights you sleep <strong style={{ color: '#F5C7A0' }}>under 7h</strong>, your morning <strong style={{ color: '#F5C7A0' }}>cortisol runs 18% higher</strong>.
            </div>
          </div>
        </div>

        {/* Signal grid */}
        <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {SIGNAL_GRID.map((s, i) => (
            <div key={i} style={{ padding: '14px 14px', borderRadius: 14, background: '#FBF4E8', border: '1px solid var(--line-bone-2)' }}>
              <div className="caps">{s.l}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>{s.v}</span>
                <span style={{ fontSize: 10.5, color: 'var(--t-3)' }}>{s.u}</span>
              </div>
              <div style={{ fontSize: 10.5, color: s.c, fontWeight: 600, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span>{s.trend}</span> {s.note}
              </div>
            </div>
          ))}
        </div>

        {/* Cross-link patterns */}
        <SectionH title="Patterns we're noticing" mt={22} />
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PATTERNS.map((p, i) => (
            <div key={i} style={{ padding: '14px 14px', borderRadius: 14, background: '#FBF4E8', border: '1px solid var(--line-bone-2)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: 99, marginTop: 6, flexShrink: 0, background: p.c }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-1)', letterSpacing: 0.04, textTransform: 'uppercase' }}>{p.i}</div>
                <div style={{ fontSize: 13, color: 'var(--t-2)', marginTop: 3, lineHeight: 1.45 }}>{p.n}</div>
              </div>
              <ChevRight size={12} c="var(--t-3)" />
            </div>
          ))}
        </div>
      </div>
      <BottomNav active="insights" />
    </Phone>
  )
}
