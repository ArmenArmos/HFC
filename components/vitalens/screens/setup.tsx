'use client'

import React, { useState } from 'react'
import { Phone, RoundBtn, ChevLeft, ChevRight } from '../primitives'

// ── Shared setup sub-components ─────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ padding: '0 24px', marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--t-3)', fontWeight: 500 }}>Step {step} of {total}</span>
        <span style={{ fontSize: 11, color: 'var(--t-3)', fontWeight: 500 }}>{Math.round((step / total) * 100)}%</span>
      </div>
      <div style={{ height: 3, background: 'var(--line-bone-2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(step / total) * 100}%`, background: '#241814', borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function SetupHeader({ step, title, sub }: { step: number; title: string; sub?: string }) {
  return (
    <div style={{ padding: '0 24px 24px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.07, textTransform: 'uppercase', marginBottom: 6 }}>
        {step < 5 ? `Step ${step}` : 'Almost done'}
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02 }}>
        {title}
      </div>
      {sub && <div style={{ fontSize: 14, color: 'var(--t-3)', marginTop: 8, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

function StickyFooter({ label = 'Continue', onNext }: { label?: string; onNext?: () => void }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 24px 46px',
      background: 'linear-gradient(180deg, rgba(245,235,221,0) 0%, rgba(245,235,221,0.96) 30%, rgba(245,235,221,1) 100%)',
    }}>
      <button className="btn-prim" style={{ width: '100%' }} onClick={onNext}>
        {label}
        <ChevRight c="#fff" size={14} />
      </button>
    </div>
  )
}

// ── J4: Consent ─────────────────────────────────────────────

export function J4_Consent() {
  const [toggles, setToggles] = useState({ required: true, optional1: true, optional2: false })

  const Toggle = ({ on, locked, onChange }: { on: boolean; locked?: boolean; onChange?: () => void }) => (
    <button
      onClick={!locked ? onChange : undefined}
      style={{
        width: 44, height: 26, borderRadius: 13,
        background: on ? '#241814' : 'rgba(36,24,20,0.12)',
        border: 'none', cursor: locked ? 'default' : 'pointer',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: on ? 21 : 3,
        width: 20, height: 20, borderRadius: 10, background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
      }} />
    </button>
  )

  return (
    <Phone label="04 Consent" bg="#F5EBDD" time="9:41">
      <div style={{ position: 'absolute', inset: 0, paddingTop: 54, paddingBottom: 100 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <ProgressBar step={1} total={4} />
        <SetupHeader
          step={1}
          title={'Your privacy,\nyour rules.'}
          sub="Review how your data is used. Required settings are locked for your protection."
        />
        <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            {
              key: 'required' as const,
              title: 'Secure health data storage',
              desc: 'Required to use VitaLens. Encrypted at rest and in transit.',
              locked: true,
            },
            {
              key: 'optional1' as const,
              title: 'Personalized recommendations',
              desc: 'Help us tailor tasks and insights to your specific markers.',
              locked: false,
            },
            {
              key: 'optional2' as const,
              title: 'Anonymous research contribution',
              desc: 'Help improve population-level health models (no PII shared).',
              locked: false,
            },
          ].map((item) => (
            <div key={item.key} style={{
              background: '#FBF4E8',
              borderRadius: 18,
              border: '1px solid var(--line-bone-2)',
              padding: '16px 16px',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-1)' }}>{item.title}</span>
                  {item.locked && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, padding: '2px 6px',
                      borderRadius: 4, background: 'rgba(36,24,20,0.06)', color: 'var(--t-3)',
                      letterSpacing: 0.05, textTransform: 'uppercase',
                    }}>Required</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--t-3)', lineHeight: 1.45 }}>{item.desc}</div>
              </div>
              <Toggle
                on={toggles[item.key]}
                locked={item.locked}
                onChange={() => setToggles(p => ({ ...p, [item.key]: !p[item.key] }))}
              />
            </div>
          ))}
        </div>
      </div>
      <StickyFooter label="Agree & Continue" />
    </Phone>
  )
}

// ── J5: Goals ───────────────────────────────────────────────

const GOALS = [
  { id: 'longevity', label: 'Longevity', icon: '🕰' },
  { id: 'heart', label: 'Heart health', icon: '❤' },
  { id: 'metabolic', label: 'Metabolic', icon: '⚡' },
  { id: 'hormonal', label: 'Hormonal balance', icon: '⚖' },
  { id: 'cognition', label: 'Cognition', icon: '🧠' },
  { id: 'energy', label: 'Energy', icon: '☀' },
  { id: 'sleep', label: 'Sleep', icon: '🌙' },
  { id: 'weight', label: 'Body composition', icon: '📊' },
]

export function J5_Goals() {
  const [selected, setSelected] = useState(new Set(['longevity', 'heart', 'metabolic']))

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  return (
    <Phone label="05 Goals" bg="#F5EBDD" time="9:41">
      <div style={{ position: 'absolute', inset: 0, paddingTop: 54, paddingBottom: 100 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <ProgressBar step={2} total={4} />
        <SetupHeader
          step={2}
          title={'What are you\noptimising for?'}
          sub="Pick as many as you like. We'll weight your biomarker scoring accordingly."
        />
        <div style={{ padding: '0 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {GOALS.map((g) => {
            const sel = selected.has(g.id)
            return (
              <button
                key={g.id}
                onClick={() => toggle(g.id)}
                style={{
                  padding: '16px 14px',
                  borderRadius: 18,
                  border: sel ? '1.5px solid #241814' : '1px solid var(--line-bone-2)',
                  background: sel ? '#241814' : '#FBF4E8',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 8 }}>{g.icon}</div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: sel ? '#FBF4E8' : 'var(--t-1)', lineHeight: 1.2 }}>{g.label}</div>
              </button>
            )
          })}
        </div>
        <div style={{ padding: '12px 24px 0', textAlign: 'center', fontSize: 12, color: 'var(--t-3)' }}>
          {selected.size} selected
        </div>
      </div>
      <StickyFooter label={`Continue with ${selected.size} goals`} />
    </Phone>
  )
}

// ── J6: Medical History ─────────────────────────────────────

const FAMILY_HISTORY = [
  'Heart disease (parent or sibling)',
  'Type 2 diabetes',
  'High blood pressure',
  'High cholesterol',
  'Cancer (any)',
  'Autoimmune condition',
  'None of the above',
]

export function J6_MedicalQ() {
  const [checked, setChecked] = useState(new Set(['Heart disease (parent or sibling)']))
  const [meds, setMeds] = useState(['Lisinopril 10mg'])

  const toggleCheck = (item: string) => setChecked(prev => {
    const n = new Set(prev)
    if (n.has(item)) n.delete(item); else n.add(item)
    return n
  })

  return (
    <Phone label="06 Medical History" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 100 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <ProgressBar step={3} total={4} />
        <SetupHeader
          step={3}
          title={'Any family\nhistory?'}
          sub="This helps calibrate your risk model. Your answers never affect insurance."
        />

        {/* Checkboxes */}
        <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FAMILY_HISTORY.map((item) => {
            const on = checked.has(item)
            return (
              <button
                key={item}
                onClick={() => toggleCheck(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 14px',
                  borderRadius: 14,
                  border: on ? '1.5px solid #241814' : '1px solid var(--line-bone-2)',
                  background: on ? 'rgba(36,24,20,0.04)' : '#FBF4E8',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: on ? '#241814' : 'transparent',
                  border: on ? 'none' : '1.5px solid var(--line-bone)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#FBF4E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <span style={{ fontSize: 13.5, color: 'var(--t-1)', fontWeight: on ? 500 : 400 }}>{item}</span>
              </button>
            )
          })}
        </div>

        {/* Medications */}
        <div style={{ padding: '24px 24px 0' }}>
          <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.07, textTransform: 'uppercase', marginBottom: 12 }}>
            Current medications (optional)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {meds.map(m => (
              <span key={m} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 999,
                background: '#241814', color: '#FBF4E8',
                fontSize: 13, fontWeight: 500,
              }}>
                {m}
                <button onClick={() => setMeds(prev => prev.filter(x => x !== m))}
                  style={{ background: 'none', border: 'none', color: 'rgba(244,241,234,0.6)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
          <input
            placeholder="Add medication…"
            style={{
              width: '100%', height: 46, borderRadius: 12,
              border: '1px solid var(--line-bone)', background: '#FBF4E8',
              padding: '0 14px', fontSize: 14, color: 'var(--t-1)', fontFamily: 'var(--font-sans)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
      <StickyFooter />
    </Phone>
  )
}

// ── J7: Lifestyle ───────────────────────────────────────────

export function J7_Lifestyle() {
  const [sleep, setSleep] = useState(6.5)
  const [movement, setMovement] = useState<'sedentary' | 'light' | 'moderate' | 'active'>('light')
  const [alcohol, setAlcohol] = useState(3)
  const [stress, setStress] = useState(6)

  const MOVEMENT_OPTS = [
    { id: 'sedentary', label: 'Sedentary' },
    { id: 'light', label: 'Light' },
    { id: 'moderate', label: 'Moderate' },
    { id: 'active', label: 'Active' },
  ]

  return (
    <Phone label="07 Lifestyle" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 100 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <ProgressBar step={4} total={4} />
        <SetupHeader
          step={4}
          title={'Daily habits\n& lifestyle.'}
          sub="Best estimates are fine. You can update these anytime."
        />

        <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Sleep */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-1)' }}>Average sleep</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, letterSpacing: -0.02 }}>{sleep}h</div>
            </div>
            <input
              type="range" min={4} max={10} step={0.5} value={sleep}
              onChange={e => setSleep(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#241814' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>
              <span>4h</span><span>7–9h optimal</span><span>10h</span>
            </div>
          </div>

          {/* Movement */}
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-1)', marginBottom: 10 }}>Weekly movement</div>
            <div style={{ display: 'flex', gap: 6, background: 'rgba(36,24,20,0.04)', borderRadius: 12, padding: 4 }}>
              {MOVEMENT_OPTS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setMovement(opt.id as typeof movement)}
                  style={{
                    flex: 1, height: 36, borderRadius: 9, border: 'none',
                    background: movement === opt.id ? '#241814' : 'transparent',
                    color: movement === opt.id ? '#FBF4E8' : 'var(--t-2)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alcohol */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-1)' }}>Alcohol</div>
                <div style={{ fontSize: 11.5, color: 'var(--t-3)' }}>drinks per week</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setAlcohol(Math.max(0, alcohol - 1))}
                  style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--line-bone)', background: '#FBF4E8', cursor: 'pointer', fontSize: 18, color: 'var(--t-1)' }}>−</button>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 28, minWidth: 30, textAlign: 'center' }}>{alcohol}</span>
                <button onClick={() => setAlcohol(alcohol + 1)}
                  style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--line-bone)', background: '#FBF4E8', cursor: 'pointer', fontSize: 18, color: 'var(--t-1)' }}>+</button>
              </div>
            </div>
          </div>

          {/* Stress */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-1)' }}>Typical stress level</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22 }}>{stress}/10</div>
            </div>
            <input
              type="range" min={1} max={10} step={1} value={stress}
              onChange={e => setStress(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: '#241814' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>
              <span>Low</span><span>High</span>
            </div>
          </div>
        </div>
      </div>
      <StickyFooter label="Build my profile" />
    </Phone>
  )
}
