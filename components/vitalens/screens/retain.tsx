'use client'

import React from 'react'
import { Phone, RoundBtn, ChevLeft, ChevRight } from '../primitives'

// ── J20: Progress (90-day retest) ────────────────────────────

export function J20_Progress() {
  return (
    <Phone label="20 Progress (90-day)" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 80 }}>
        <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <RoundBtn><ChevLeft size={18} /></RoundBtn>
          <span style={{ fontSize: 13, color: 'var(--t-2)', fontWeight: 500 }}>Share</span>
        </div>
        <div style={{ padding: '6px 20px 18px' }}>
          <div className="caps">Retest · Jan 13</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02, marginTop: 8 }}>
            90 days of<br /><span style={{ fontStyle: 'italic' }}>quiet work.</span>
          </div>
        </div>

        {/* Hero before/after */}
        <div style={{ margin: '0 16px 14px', padding: '22px 20px', borderRadius: 20, background: '#241814', color: '#FBF4E8', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: 99, background: 'radial-gradient(circle, rgba(232,122,62,0.35) 0%, transparent 70%)' }} />
          <div className="caps caps-ink">APOB · MG/DL</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8, position: 'relative' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 54, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>78</div>
              <div style={{ fontSize: 11, color: '#7DA679', fontWeight: 600, marginTop: 6 }}>● Now optimal</div>
            </div>
            <div style={{ flex: 1, marginLeft: 14, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5, color: 'rgba(244,241,234,0.65)' }}>
              {[['Was', '105 mg/dL'], ['Target', '<80 mg/dL'], ['Change', '−27 (−26%)']].map(([l, v], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: i === 2 ? '#F5C7A0' : undefined, fontWeight: i === 2 ? 500 : 400 }}>
                  <span>{l}</span><span className="num">{v}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Mini chart */}
          <svg viewBox="0 0 320 80" style={{ width: '100%', marginTop: 18, position: 'relative' }}>
            <defs>
              <linearGradient id="prgg" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#D14829" /><stop offset="100%" stopColor="#F5C7A0" />
              </linearGradient>
              <linearGradient id="prggfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E87A3E" stopOpacity="0.4" /><stop offset="100%" stopColor="#E87A3E" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="35" x2="320" y2="35" stroke="rgba(125,166,121,0.4)" strokeWidth="1" strokeDasharray="3 3" />
            <text x="316" y="32" fontSize="9" fill="#7DA679" textAnchor="end">target 80</text>
            <path d="M0 10 C 60 12, 90 18, 120 22 S 200 38, 240 50 S 290 62, 320 65" stroke="url(#prgg)" strokeWidth="2.5" fill="none" />
            <path d="M0 10 C 60 12, 90 18, 120 22 S 200 38, 240 50 S 290 62, 320 65 L 320 80 L 0 80 Z" fill="url(#prggfill)" />
            <circle cx="0" cy="10" r="4" fill="#FBF4E8" />
            <circle cx="320" cy="65" r="5" fill="#F5C7A0" />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'rgba(244,241,234,0.55)' }}>
            {['Oct 15', 'Nov 14', 'Dec 14', 'Jan 13'].map(d => <span key={d}>{d}</span>)}
          </div>
        </div>

        {/* Other movers */}
        <div style={{ padding: '0 16px' }}>
          <div className="caps" style={{ marginBottom: 10 }}>Other movers</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { l: 'hs-CRP', was: '2.8', now: '1.1', d: '−61%' },
              { l: 'Vitamin D', was: '22', now: '42', d: '+91%' },
              { l: 'Resting HR', was: '68', now: '58', d: '−10 bpm' },
              { l: 'Sleep score', was: '68', now: '82', d: '+14' },
            ].map((m, i) => (
              <div key={i} style={{ padding: '12px 14px', borderRadius: 14, background: '#FBF4E8', border: '1px solid var(--line-bone-2)' }}>
                <div style={{ fontSize: 11.5, color: 'var(--t-3)', fontWeight: 500 }}>{m.l}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                  <span className="num" style={{ fontSize: 13, color: 'var(--t-3)', textDecoration: 'line-through' }}>{m.was}</span>
                  <ChevRight size={11} c="var(--t-3)" />
                  <span className="num" style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-serif)' }}>{m.now}</span>
                </div>
                <div style={{ fontSize: 11, color: '#7DA679', fontWeight: 600, marginTop: 4 }}>● {m.d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Habits that moved the needle */}
        <div style={{ margin: '18px 16px 0', padding: '16px 18px', borderRadius: 18, background: 'rgba(232,122,62,0.06)', border: '1px solid rgba(232,122,62,0.18)' }}>
          <div className="caps" style={{ color: '#7A2E1A' }}>What moved the needle</div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { l: 'Z2 cardio', v: '38 / 39 weeks', w: 97 },
              { l: 'Sat fat <16 g', v: '82 of 90 days', w: 91 },
              { l: 'Vitamin D daily', v: '88 of 90 days', w: 98 },
            ].map((h, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{h.l}</span>
                  <span className="num" style={{ color: 'var(--t-2)' }}>{h.v}</span>
                </div>
                <div style={{ marginTop: 4, height: 4, borderRadius: 99, background: 'rgba(232,122,62,0.15)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${h.w}%`, background: 'linear-gradient(90deg, #F5C7A0, #D14829)', borderRadius: 99 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Phone>
  )
}

// ── J21: Retest Reminder ─────────────────────────────────────

export function J21_RetestReminder() {
  return (
    <Phone label="21 Re-test Reminder" bg="#F5EBDD" time="9:41">
      <div style={{ position: 'absolute', inset: 0, paddingTop: 54, overflow: 'hidden' }}>
        <div style={{ padding: '10px 20px' }}><RoundBtn><ChevLeft size={18} /></RoundBtn></div>
        <div style={{ padding: '6px 20px 0' }}>
          <div className="caps">Up next</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02, marginTop: 8 }}>
            Time to<br /><span style={{ fontStyle: 'italic' }}>check in.</span>
          </div>
        </div>

        {/* Calendar hero */}
        <div style={{
          margin: '22px 16px 0', padding: '20px 20px 22px', borderRadius: 22,
          background: 'radial-gradient(120% 100% at 50% 0%, #FFE5C2 0%, #FBF4E8 60%)',
          border: '1px solid var(--line-bone-2)',
        }}>
          <div className="caps" style={{ color: '#7A2E1A' }}>SCHEDULED · APR 14</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 64, lineHeight: 0.9, letterSpacing: -0.02 }}>14</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>April</div>
              <div style={{ fontSize: 12, color: 'var(--t-3)', marginTop: 2 }}>Tuesday · 8:00 am</div>
            </div>
          </div>
          <div style={{ marginTop: 14, fontSize: 13.5, color: 'var(--t-2)', lineHeight: 1.45 }}>
            It's been almost 90 days since your last panel. Same Complete panel — same time, same phlebotomist if available.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button style={{ flex: 1, height: 46, borderRadius: 14, background: '#241814', color: '#FBF4E8', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
            <button style={{ flex: 1, height: 46, borderRadius: 14, background: '#FBF4E8', color: 'var(--t-1)', border: '1px solid var(--line-bone-2)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Reschedule</button>
          </div>
        </div>

        {/* Why now */}
        <div style={{ margin: '14px 16px 0', padding: '16px 18px', borderRadius: 18, background: '#FBF4E8', border: '1px solid var(--line-bone-2)' }}>
          <div className="caps">Why now</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {[
              { l: 'Confirm ApoB stays under 80', sub: 'You hit it once. Now make it stick.' },
              { l: 'Catch ferritin trajectory early', sub: 'Borderline last time. Easier to fix early.' },
              { l: 'Add 2 markers from new research', sub: 'GlycA, omega-3 index. Free for members.' },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: '#E87A3E', lineHeight: 1, marginTop: 2 }}>0{i + 1}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{r.l}</div>
                  <div style={{ fontSize: 12, color: 'var(--t-3)', marginTop: 2 }}>{r.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Membership */}
        <div style={{ margin: '14px 16px 0', padding: '12px 16px', borderRadius: 14, background: 'transparent', border: '1px dashed var(--line-bone)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: '#241814', color: '#F5C7A0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-serif)', fontSize: 13 }}>m</div>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--t-2)', lineHeight: 1.4 }}>
            Member · 4 panels included this year ·{' '}
            <span style={{ color: 'var(--t-1)', textDecoration: 'underline', fontWeight: 500 }}>view plan</span>
          </div>
        </div>
      </div>
    </Phone>
  )
}

// ── J22: Habits (Long-term) ──────────────────────────────────

export function J22_Habits() {
  return (
    <Phone label="22 Long-term Habits" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 80 }}>
        <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <RoundBtn><ChevLeft size={18} /></RoundBtn>
          <span style={{ fontSize: 13, color: 'var(--t-2)', fontWeight: 500 }}>Year</span>
        </div>
        <div style={{ padding: '6px 20px 0' }}>
          <div className="caps">Year one · 327 days in</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.05, letterSpacing: -0.02, marginTop: 8 }}>
            The shape of<br /><span style={{ fontStyle: 'italic' }}>a healthier year.</span>
          </div>
        </div>

        {/* Heatmap calendar */}
        <div style={{ margin: '24px 16px 0', padding: 18, borderRadius: 20, background: '#241814', color: '#FBF4E8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <div>
              <div className="caps caps-ink">HABIT CONSISTENCY</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>Z2 cardio · 327 days</div>
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 30, color: '#F5C7A0', fontFeatureSettings: '"tnum"' }}>83%</div>
          </div>
          {/* GitHub-style heatmap grid */}
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: 48 }).map((_, col) => (
              <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {Array.from({ length: 7 }).map((_, row) => {
                  const seed = col * 7 + row
                  const intensity = Math.min(1, Math.max(0, Math.sin(seed * 0.7) * 0.4 + 0.55 + (col < 8 ? -0.3 : 0) + (col > 40 ? 0.1 : 0)))
                  const cellColor = intensity < 0.2 ? 'rgba(244,241,234,0.06)'
                    : intensity < 0.4 ? 'rgba(245,199,160,0.25)'
                      : intensity < 0.65 ? 'rgba(232,122,62,0.55)'
                        : '#F5C7A0'
                  return <div key={row} style={{ width: 5, height: 5, borderRadius: 1.5, background: cellColor }} />
                })}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 9.5, color: 'rgba(244,241,234,0.45)' }}>
            {['JAN', 'APR', 'JUL', 'OCT'].map(m => <span key={m}>{m}</span>)}
          </div>
        </div>

        {/* Streaks */}
        <div style={{ padding: '18px 16px 0' }}>
          <div className="caps" style={{ marginBottom: 10 }}>Habit streaks</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { l: 'Vitamin D daily', days: 312, all: 327, ic: '☀' },
              { l: 'Z2 cardio · 3×/wk', days: 48, all: 48, sub: 'weeks', ic: '↗' },
              { l: 'Sat fat under 16 g', days: 268, all: 327, ic: '⌥' },
              { l: 'Wind-down ritual', days: 184, all: 327, ic: '☾' },
            ].map((h, i) => (
              <div key={i} style={{ padding: '14px 14px', borderRadius: 14, background: '#FBF4E8', border: '1px solid var(--line-bone-2)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #FFE5C2, #F5C7A0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#7A2E1A' }}>{h.ic}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{h.l}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t-3)', marginTop: 2 }}>{h.days} of {h.all} {h.sub ?? 'days'}</div>
                </div>
                <span className="num" style={{ fontSize: 18, fontFamily: 'var(--font-serif)', color: 'var(--t-1)' }}>{Math.round(h.days / h.all * 100)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Biological age trend */}
        <div style={{ margin: '18px 16px 0', padding: 18, borderRadius: 20, background: '#FBF4E8', border: '1px solid var(--line-bone-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div className="caps">Biological age</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 38, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>32.4</span>
                <span style={{ fontSize: 12, color: 'var(--t-3)' }}>vs chronological 34</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#7DA679', fontWeight: 600 }}>● −1.6 yrs</div>
              <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>since first test</div>
            </div>
          </div>
          <svg viewBox="0 0 320 60" style={{ width: '100%', marginTop: 14 }}>
            <line x1="0" y1="40" x2="320" y2="40" stroke="rgba(36,24,20,0.06)" strokeWidth="1" strokeDasharray="2 3" />
            <path d="M0 18 L 80 24 L 160 30 L 240 36 L 320 38" stroke="#E87A3E" strokeWidth="2.5" fill="none" />
            {[18, 24, 30, 36, 38].map((y, i) => <circle key={i} cx={i * 80} cy={y} r="3.5" fill="#E87A3E" />)}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--t-3)' }}>
            {["Oct '24", "Jan '25", "Apr '25", "Jul '25", 'Now'].map(d => <span key={d}>{d}</span>)}
          </div>
        </div>

        <div style={{ padding: '18px 20px 0', textAlign: 'center', fontSize: 14, color: 'var(--t-3)', lineHeight: 1.5, fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>
          "Small things, repeated. That's the whole game."
        </div>
      </div>
    </Phone>
  )
}
