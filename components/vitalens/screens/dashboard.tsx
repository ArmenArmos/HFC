'use client'

import React from 'react'
import { Phone, BottomNav, Sparkline, Arrow, Plus, ChevRight } from '../primitives'

export function J14_Dashboard() {
  return (
    <Phone label="14 Dashboard" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 100 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px 16px' }}>
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--t-3)', fontWeight: 500 }}>
              {new Date(2026, 4, 2).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 26, lineHeight: 1.1, letterSpacing: -0.02, marginTop: 2 }}>
              Good morning,<br /><span style={{ fontStyle: 'italic' }}>Maya.</span>
            </div>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: 999, overflow: 'hidden',
            background: 'linear-gradient(135deg, #E87A3E, #D14829)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FBF4E8', fontSize: 16, fontWeight: 600,
            border: '1px solid rgba(36,24,20,0.08)',
          }}>M</div>
        </div>

        {/* Hero card — dawn sky over sunrise arc */}
        <div style={{
          margin: '0 16px 20px', height: 300, borderRadius: 26, overflow: 'hidden',
          background: 'linear-gradient(180deg, #C9C2D5 0%, #B8B0CC 18%, #D9C5C2 38%, #F5C7A0 60%, #E87A3E 82%, #A2331A 100%)',
          color: '#FBF4E8', position: 'relative',
          boxShadow: '0 24px 48px -20px rgba(122,46,26,0.55), inset 0 1px 0 rgba(255,232,200,0.25)',
        }}>
          {/* Sunrise arc */}
          <div style={{
            position: 'absolute', left: '50%', bottom: -90, transform: 'translateX(-50%)',
            width: 380, height: 380, borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 50%, #FFE8C8 0%, #F6B15A 24%, #E87A3E 48%, transparent 72%)',
            filter: 'blur(2px)', opacity: 0.9,
          }} />
          {/* Bloom */}
          <div style={{
            position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)',
            width: 200, height: 200, borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 60%, rgba(255,232,200,0.85) 0%, rgba(246,177,90,0.45) 30%, transparent 65%)',
            mixBlendMode: 'screen',
          }} />
          {/* Chladni rings */}
          <svg viewBox="0 0 360 300" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.32, mixBlendMode: 'soft-light' }}>
            {[60, 92, 128, 168, 212].map((r, i) => (
              <circle key={i} cx="180" cy="270" r={r} fill="none" stroke="#FFE8C8" strokeWidth="0.6" opacity={1 - i * 0.16} />
            ))}
          </svg>

          <div style={{ position: 'absolute', top: 18, left: 20, right: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 10.5, color: 'rgba(36,24,20,0.65)', fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase' }}>VITALENS SCORE</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 104, lineHeight: 0.92, letterSpacing: -0.05, marginTop: 4, color: '#241814', textShadow: '0 2px 24px rgba(255,232,200,0.5)', fontFeatureSettings: '"tnum","lnum"' }}>82</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, marginTop: 4, color: 'rgba(36,24,20,0.75)' }}>
                <Arrow dir="up" size={11} c="rgba(36,24,20,0.75)" />
                +3 vs. last test
              </div>
            </div>
            <div style={{
              padding: '5px 10px', borderRadius: 999,
              background: 'rgba(251,244,232,0.55)', backdropFilter: 'blur(10px)',
              border: '1px solid rgba(36,24,20,0.10)',
              fontSize: 11.5, fontWeight: 600, color: '#241814',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: '#D14829' }} />
              Watch a few items
            </div>
          </div>

          {/* Sub-scores */}
          <div style={{ position: 'absolute', bottom: 16, left: 20, right: 20, display: 'flex', gap: 12 }}>
            {[{ l: 'Heart', v: 78 }, { l: 'Metabolic', v: 80 }, { l: 'Hormonal', v: 88 }].map(s => (
              <div key={s.l} style={{ flex: 1, borderTop: '1px solid rgba(251,244,232,0.35)', paddingTop: 10 }}>
                <div style={{ fontSize: 10.5, color: 'rgba(251,244,232,0.85)', fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase' }}>{s.l}</div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, lineHeight: 1, marginTop: 3, color: '#FBF4E8', fontFeatureSettings: '"tnum"' }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority actions */}
        <div style={{ padding: '0 20px', marginBottom: 14 }}>
          <div className="sect-h">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-1)' }}>Priority actions</span>
            <span className="more">3 of 8</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: '0 20px 4px', overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
          {[
            { tag: 'Diet', title: 'Cut refined carbs at lunch', linked: 'HbA1c', days: '14d' },
            { tag: 'Movement', title: '30-min walk after dinner', linked: 'ApoB', days: '7d' },
            { tag: 'Sleep', title: 'Wind-down by 10:30pm', linked: 'Cortisol', days: '21d' },
          ].map((a, i) => (
            <div key={i} style={{
              minWidth: 220, scrollSnapAlign: 'start',
              background: i === 0 ? '#241814' : '#FBF4E8',
              color: i === 0 ? '#FBF4E8' : '#241814',
              border: i === 0 ? '1px solid #241814' : '1px solid var(--line-bone-2)',
              borderRadius: 22, padding: 18, position: 'relative', minHeight: 168,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: i === 0 ? 'rgba(244,241,234,0.6)' : 'var(--t-3)', letterSpacing: 0.08, textTransform: 'uppercase' }}>{a.tag}</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1.15, marginTop: 6, letterSpacing: -0.01 }}>{a.title}</div>
              <div style={{
                position: 'absolute', left: 18, right: 18, bottom: 14,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 11.5, fontWeight: 500, color: i === 0 ? 'rgba(244,241,234,0.7)' : 'var(--t-3)',
              }}>
                <span>Linked: {a.linked}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 999, background: i === 0 ? 'rgba(244,241,234,0.12)' : 'rgba(36,24,20,0.06)' }}>
                  <Plus size={11} c={i === 0 ? '#FBF4E8' : '#241814'} />
                  Add
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Recently changed */}
        <div style={{ padding: '24px 20px 0' }}>
          <div className="sect-h">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-1)' }}>Recently changed · 30 days</span>
            <span className="more" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              See all <ChevRight size={11} c="var(--t-2)" />
            </span>
          </div>
          <div style={{ background: '#FBF4E8', borderRadius: 22, border: '1px solid var(--line-bone-2)', overflow: 'hidden' }}>
            {[
              { name: 'ApoB', cat: 'Cardiovascular', v: '105', u: 'mg/dL', trend: [88, 92, 95, 98, 100, 102, 105], color: '#E87A3E', delta: '+8%', up: true },
              { name: 'HbA1c', cat: 'Metabolic', v: '5.4', u: '%', trend: [5.7, 5.7, 5.6, 5.5, 5.5, 5.5, 5.4], color: '#4FB45C', delta: '−0.2', up: false },
              { name: 'Vitamin D', cat: 'Hormonal', v: '34', u: 'ng/mL', trend: [22, 24, 27, 29, 31, 33, 34], color: '#4FB45C', delta: '+12%', up: true },
              { name: 'Lp(a)', cat: 'Cardiovascular', v: '62', u: 'nmol/L', trend: [58, 59, 60, 60, 61, 62, 62], color: '#E87A3E', delta: '+3%', up: true },
            ].map((r, i, arr) => (
              <div key={r.name} style={{
                display: 'flex', alignItems: 'center', padding: '14px 16px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--line-bone-2)' : 'none',
                gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: -0.01 }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t-3)', marginTop: 1 }}>{r.cat}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Sparkline points={r.trend} color={r.color} w={56} height={24} fill={false} />
                  <div style={{ textAlign: 'right', minWidth: 70 }}>
                    <div className="num" style={{ fontSize: 14.5, fontWeight: 500 }}>
                      {r.v} <span style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 500 }}>{r.u}</span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 500, marginTop: 2, color: r.up ? '#E87A3E' : '#4FB45C', display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'var(--font-mono)' }}>
                      <Arrow dir={r.up ? 'up' : 'down'} size={9} c={r.up ? '#E87A3E' : '#4FB45C'} />
                      {r.delta}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Retest reminder */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ background: '#241814', color: '#FBF4E8', borderRadius: 22, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg, #E87A3E, #D14829)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="11" r="6.5" stroke="#FBF4E8" strokeWidth="1.5" />
                <path d="M10 8v3l2 1.5M8 2h4" stroke="#FBF4E8" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'rgba(244,241,234,0.6)', fontWeight: 500, letterSpacing: 0.06, textTransform: 'uppercase' }}>Retest reminder</div>
              <div style={{ fontSize: 14.5, fontWeight: 500, marginTop: 3 }}>HbA1c retest in 14 days</div>
            </div>
            <button style={{ height: 36, padding: '0 14px', borderRadius: 999, background: '#FBF4E8', color: '#241814', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Book</button>
          </div>
        </div>

        {/* Edu card */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ background: '#FBF4E8', borderRadius: 22, padding: 18, border: '1px solid var(--line-bone-2)', display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, flexShrink: 0, background: 'radial-gradient(circle at 30% 30%, #F5C7A0, #D14829 70%)' }} />
            <div style={{ flex: 1 }}>
              <div className="caps">4 MIN READ · CLINICIAN-REVIEWED</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, lineHeight: 1.2, marginTop: 4, letterSpacing: -0.01 }}>
                Why ApoB matters more<br />than total cholesterol
              </div>
            </div>
          </div>
        </div>
        <div style={{ height: 30 }} />
      </div>

      {/* FAB */}
      <button style={{
        position: 'absolute', right: 20, bottom: 110, zIndex: 65,
        height: 56, padding: '0 22px', borderRadius: 999,
        background: '#241814', color: '#FBF4E8', border: 'none',
        boxShadow: '0 14px 32px rgba(36,24,20,0.35)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontSize: 15, fontWeight: 600, cursor: 'pointer',
      }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 1.5l1.7 4 4 .4-3 2.7.9 4-3.6-2.2-3.6 2.2.9-4-3-2.7 4-.4L9 1.5z" fill="#F5C7A0" />
        </svg>
        Ask AI
      </button>

      <BottomNav active="home" />
    </Phone>
  )
}
