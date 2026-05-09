'use client'

import React, { useState } from 'react'
import { Phone, BottomNav, RoundBtn, ChevLeft, ChevRight, Arrow } from '../primitives'

// ── J17: Recommendations ────────────────────────────────────

const RECOMMENDATIONS = [
  {
    rank: '01',
    tag: 'Nutrition',
    title: 'Reduce saturated fat to < 16 g/day',
    impact: 'ApoB ↓ 15–20%',
    impactColor: '#7DA679',
    hero: true,
  },
  {
    rank: '02',
    tag: 'Movement',
    title: '3× Zone 2 cardio per week',
    impact: 'ApoB ↓ 10%, Insulin ↓ 18%',
    impactColor: '#7DA679',
    hero: false,
  },
  {
    rank: '03',
    tag: 'Supplements',
    title: 'Vitamin D 4,000 IU/day',
    impact: 'Vitamin D → optimal in 60d',
    impactColor: '#7DA679',
    hero: false,
    flag: 'Talk to doctor about statin if ApoB persists',
    flagColor: '#E87A3E',
  },
  {
    rank: '04',
    tag: 'Sleep',
    title: 'Wind-down ritual, screens off by 9:30',
    impact: 'Cortisol ↓, HRV ↑',
    impactColor: '#7DA679',
    hero: false,
  },
  {
    rank: '05',
    tag: 'Monitoring',
    title: 'Retest ApoB in 90 days',
    impact: 'Track progress',
    impactColor: 'var(--t-3)',
    hero: false,
  },
]

export function J17_Recommendations() {
  return (
    <Phone label="17 Recommendations" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 100 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center' }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <div style={{ padding: '10px 20px 20px' }}>
          <div className="caps">Your plan</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 36, lineHeight: 1.0, letterSpacing: -0.02, marginTop: 6 }}>
            Ranked by<br /><span style={{ fontStyle: 'italic' }}>impact.</span>
          </div>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {RECOMMENDATIONS.map((r, i) => {
            if (r.hero) {
              return (
                <div key={i} style={{ background: '#241814', color: '#FBF4E8', borderRadius: 22, padding: '20px 20px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: 99, background: 'radial-gradient(circle, rgba(232,122,62,0.4), transparent 60%)' }} />
                  <div className="caps caps-ink" style={{ marginBottom: 6 }}>{r.tag}</div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, lineHeight: 1.2, letterSpacing: -0.01 }}>{r.title}</div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '5px 12px', borderRadius: 999, background: 'rgba(125,166,121,0.22)', color: '#7DA679', fontSize: 12.5, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: '#7DA679' }} />
                    {r.impact}
                  </div>
                  <div style={{ marginTop: 14, fontFamily: 'var(--font-serif)', fontSize: 72, lineHeight: 0.85, letterSpacing: -0.05, color: 'rgba(244,241,234,0.12)', position: 'absolute', right: 20, bottom: 14, fontFeatureSettings: '"tnum"' }}>
                    {r.rank}
                  </div>
                </div>
              )
            }
            return (
              <div key={i} style={{ background: '#FBF4E8', borderRadius: 18, border: '1px solid var(--line-bone-2)', padding: '16px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--t-3)', fontFeatureSettings: '"tnum"', minWidth: 28, marginTop: 2 }}>{r.rank}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', marginBottom: 4 }}>{r.tag}</div>
                  <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.3 }}>{r.title}</div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12, fontWeight: 600, color: r.impactColor }}>
                    <Arrow dir="up" size={9} c={r.impactColor} />{r.impact}
                  </div>
                  {r.flag && (
                    <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(232,122,62,0.08)', border: '1px solid rgba(232,122,62,0.2)', fontSize: 12, color: '#7A2E1A', fontWeight: 500 }}>
                      ⚕ {r.flag}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ height: 30 }} />
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 20px 46px', background: 'linear-gradient(180deg, rgba(245,235,221,0) 0%, rgba(245,235,221,0.96) 30%, rgba(245,235,221,1) 100%)' }}>
        <button className="btn-prim" style={{ width: '100%' }}>
          Start my plan
          <ChevRight c="#fff" size={14} />
        </button>
      </div>
    </Phone>
  )
}

// ── J18: Clinician Review ────────────────────────────────────

export function J18_ClinicianReview() {
  return (
    <Phone label="18 Clinician Review" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 32 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center' }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>

        {/* Doctor card */}
        <div style={{ margin: '12px 20px 0', background: '#FBF4E8', borderRadius: 22, border: '1px solid var(--line-bone-2)', padding: 18 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, flexShrink: 0, background: 'linear-gradient(135deg, #F5C7A0 0%, #7A2E1A 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👩‍⚕️</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Dr. Sara Richina, MD</div>
              <div style={{ fontSize: 12, color: 'var(--t-3)', marginTop: 2 }}>Internal Medicine · Board Certified</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                {[1, 2, 3, 4, 5].map(i => <svg key={i} width="10" height="10" viewBox="0 0 10 10" fill="#E87A3E"><path d="M5 1l1.1 2.5 2.7.3-2 1.8.5 2.7L5 7.1 2.7 8.3l.5-2.7L1.2 3.8l2.7-.3L5 1z" /></svg>)}
                <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 4 }}>4.98 · 312 reviews</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button style={{ flex: 1, height: 40, borderRadius: 12, background: '#241814', color: '#FBF4E8', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Book video call</button>
            <button style={{ flex: 1, height: 40, borderRadius: 12, background: 'transparent', color: 'var(--t-1)', border: '1px solid var(--line-bone-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Message</button>
          </div>
        </div>

        {/* Letter */}
        <div style={{ margin: '16px 20px 0', background: '#FBF4E8', borderRadius: 22, border: '1px solid var(--line-bone-2)', padding: '20px 20px' }}>
          <div className="caps" style={{ marginBottom: 12 }}>Clinical review · March 14, 2026</div>
          <div style={{ fontSize: 14, color: 'var(--t-2)', lineHeight: 1.65 }}>
            <p style={{ marginTop: 0 }}>Your panel shows a <strong style={{ color: 'var(--t-1)' }}>generally healthy profile</strong> with a few items worth monitoring closely.</p>

            <div style={{ margin: '16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { marker: 'ApoB · 105 mg/dL', detail: 'Modestly elevated. Dietary saturated fat reduction and Zone 2 exercise typically move this within 2–3 months.', color: '#FFD7CE', textColor: '#7A2E1A' },
                { marker: 'Lp(a) · 62 nmol/L', detail: 'Above optimal. This marker is largely genetic. I recommend discussing statin therapy at your next in-person visit.', color: '#FFD7CE', textColor: '#7A2E1A' },
                { marker: 'Vitamin D · 34 ng/mL', detail: 'Low-normal. Start 4,000 IU/day. Retest in 60 days.', color: '#FFE7C4', textColor: '#7A3D00' },
              ].map((item, i) => (
                <div key={i} style={{ borderRadius: 12, padding: '12px 14px', background: item.color, border: `1px solid ${item.textColor}22` }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: item.textColor, marginBottom: 4 }}>{item.marker}</div>
                  <div style={{ fontSize: 12.5, color: item.textColor, opacity: 0.85, lineHeight: 1.45 }}>{item.detail}</div>
                </div>
              ))}
            </div>

            <p>Overall, your metabolic and hormonal markers look excellent. <strong style={{ color: 'var(--t-1)' }}>The cardiovascular cluster deserves attention</strong>, but the lifestyle levers here are strong.</p>
            <p style={{ marginBottom: 0 }}>— Dr. Richina</p>
          </div>
        </div>

        {/* CTAs */}
        <div style={{ padding: '16px 20px', display: 'flex', gap: 10 }}>
          <button style={{ flex: 1, height: 50, borderRadius: 14, background: '#241814', color: '#FBF4E8', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Book video · $49</button>
          <button style={{ flex: 1, height: 50, borderRadius: 14, background: 'transparent', color: 'var(--t-1)', border: '1px solid var(--line-bone-2)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Reply by message</button>
        </div>
      </div>
    </Phone>
  )
}

// ── J19: Action Plan ─────────────────────────────────────────

const TASKS = [
  { label: 'Sat fat under 16 g', sub: 'Logged 11 g ✓', done: true },
  { label: 'Zone 2 cardio 50 min', sub: 'Treadmill 6.4 mph', done: true },
  { label: 'Vitamin D 4,000 IU', sub: 'Morning · taken', done: true },
  { label: 'Magnesium glycinate', sub: '30 min before bed', done: false },
  { label: 'Wind-down · screens off 9:30', sub: 'Tonight', done: false },
]

const WEEKLY = [80, 100, 90, 75, 60, 0, 0]

export function J19_ActionPlan() {
  const [tasks, setTasks] = useState(TASKS)
  const doneCount = tasks.filter(t => t.done).length

  return (
    <Phone label="19 Action Plan" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 32 }}>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center' }}>
          <RoundBtn><ChevLeft size={16} /></RoundBtn>
        </div>
        <div style={{ padding: '10px 20px 20px' }}>
          <div className="caps">Action plan</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02, marginTop: 6 }}>
            Get ApoB <span style={{ fontStyle: 'italic', color: '#E87A3E' }}>under 80.</span>
          </div>
        </div>

        {/* Target hero */}
        <div style={{ margin: '0 16px 16px', background: '#241814', color: '#FBF4E8', borderRadius: 22, padding: 20, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -30, right: -30, width: 160, height: 160, borderRadius: 99, background: 'radial-gradient(circle, rgba(232,122,62,0.35), transparent 65%)' }} />
          <div className="caps caps-ink">Target · ApoB mg/dL</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 54, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>105</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F5C7A0' }}>
              <ChevRight size={16} c="#F5C7A0" />
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 36, lineHeight: 1, fontStyle: 'italic', fontFeatureSettings: '"tnum"' }}>&lt;80</span>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(244,241,234,0.65)' }}>90-day target · Day 1 of 90</div>
        </div>

        {/* Daily tasks */}
        <div style={{ padding: '0 20px', marginBottom: 14 }}>
          <div className="sect-h">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-1)' }}>{"Today's tasks"}</span>
            <span className="more">{doneCount} / {tasks.length} done</span>
          </div>
        </div>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((t, i) => (
            <button
              key={i}
              onClick={() => setTasks(prev => prev.map((x, j) => j === i ? { ...x, done: !x.done } : x))}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 14,
                background: t.done ? 'rgba(125,166,121,0.08)' : '#FBF4E8',
                border: t.done ? '1px solid rgba(125,166,121,0.22)' : '1px solid var(--line-bone-2)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: t.done ? '#7DA679' : 'transparent', border: t.done ? 'none' : '1.4px solid var(--line-bone)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {t.done && <svg width="13" height="13" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: t.done ? 'var(--t-2)' : 'var(--t-1)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.label}</div>
                <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>{t.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Weekly adherence */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ background: '#FBF4E8', borderRadius: 18, border: '1px solid var(--line-bone-2)', padding: '16px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-1)' }}>This week</span>
              <span style={{ fontSize: 12, color: 'var(--t-3)' }}>Adherence 78%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 54 }}>
              {WEEKLY.map((v, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: '100%', height: `${Math.max(v, 8)}%`, borderRadius: 6, background: v === 0 ? 'rgba(36,24,20,0.06)' : i === 4 ? '#F5C7A0' : '#241814' }} />
                  <span style={{ fontSize: 9, color: i === 4 ? 'var(--t-1)' : 'var(--t-3)', fontWeight: i === 4 ? 600 : 500 }}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ height: 30 }} />
      </div>
    </Phone>
  )
}
