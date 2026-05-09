'use client'

import React from 'react'
import { Phone, BottomNav, RoundBtn, ChevLeft, ChevRight } from '../primitives'

// ── RiskCard ─────────────────────────────────────────────────

type RiskLevel = 'Elevated' | 'Moderate' | 'Low'

const RISK_COLORS: Record<RiskLevel, { bg: string; fg: string; dot: string; arc: string }> = {
  Elevated: { bg: '#FFD7CE', fg: '#7A2E1A', dot: '#E87A3E', arc: '#E87A3E' },
  Moderate: { bg: '#FFE7C4', fg: '#7A3D00', dot: '#E58A0A', arc: '#E58A0A' },
  Low:      { bg: '#E8F5E1', fg: '#1F5A2A', dot: '#4FB45C', arc: '#4FB45C' },
}

const ARC_PCT: Record<RiskLevel, number> = {
  Elevated: 0.78,
  Moderate: 0.5,
  Low: 0.22,
}

function RiskCard({
  cat, ico, level, confidence, reviewed, pending, reviewer, markers, narrative,
}: {
  cat: string
  ico: string
  level: RiskLevel
  confidence: string
  reviewed?: boolean
  pending?: boolean
  reviewer?: string
  markers: string[]
  narrative: string
}) {
  const c = RISK_COLORS[level]
  const arcPct = ARC_PCT[level]

  return (
    <div style={{ background: '#FBF4E8', borderRadius: 22, border: '1px solid var(--line-bone-2)', padding: 18, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        {/* Arc gauge */}
        <div style={{ width: 76, height: 76, position: 'relative', flexShrink: 0 }}>
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="30" stroke="rgba(36,24,20,0.08)" strokeWidth="6" fill="none" />
            <circle cx="38" cy="38" r="30" stroke={c.arc} strokeWidth="6" fill="none"
              strokeDasharray={`${arcPct * 188} 188`} strokeLinecap="round"
              transform="rotate(-90 38 38)" />
            <text x="38" y="42" textAnchor="middle" fontSize="20" fontFamily="var(--font-serif)" fill="#241814">{ico}</text>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="caps">{cat}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ padding: '4px 10px 4px 8px', borderRadius: 999, background: c.bg, color: c.fg, fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: c.dot }} />
              {level}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--t-3)' }}>Confidence: {confidence}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, lineHeight: 1.3, marginTop: 8, letterSpacing: -0.005 }}>{narrative}</div>
        </div>
      </div>

      {reviewed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, color: 'var(--t-2)' }}>
          <span style={{ width: 18, height: 18, borderRadius: 99, background: '#241814', color: '#FBF4E8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#FBF4E8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          Clinician-reviewed · {reviewer}
        </div>
      )}
      {pending && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, color: 'var(--t-2)' }}>
          <span style={{ width: 18, height: 18, borderRadius: 99, background: 'rgba(229,138,10,0.18)', color: '#7A3D00', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="3.5" stroke="#7A3D00" strokeWidth="1.3" /><path d="M5 3v2l1.5 1" stroke="#7A3D00" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </span>
          Clinician review pending · expected within 24h
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-bone)' }}>
        <div style={{ fontSize: 11, color: 'var(--t-3)', marginBottom: 8, fontWeight: 500, letterSpacing: 0.05, textTransform: 'uppercase' }}>Contributing markers</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {markers.map(m => (
            <span key={m} className="chip" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>{m}</span>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-bone)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
        <span>See recommendations</span>
        <ChevRight size={13} c="var(--t-2)" />
      </div>
    </div>
  )
}

// ── J16: Risk Insights ───────────────────────────────────────

export function J16_RiskInsights() {
  return (
    <Phone label="16 Risk Insights" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 110 }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px 8px' }}>
          <RoundBtn><ChevLeft size={18} /></RoundBtn>
          <RoundBtn>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="#241814" strokeWidth="1.5" />
              <path d="M8 11V7M8 4.5v.01" stroke="#241814" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </RoundBtn>
        </div>

        <div style={{ padding: '8px 20px 16px' }}>
          <div className="caps">Insights</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 36, lineHeight: 1.0, letterSpacing: -0.02, marginTop: 6 }}>
            Your risk<br /><span style={{ fontStyle: 'italic' }}>signals.</span>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ margin: '0 16px 14px', padding: '8px 14px', borderRadius: 14, background: 'rgba(36,24,20,0.04)', border: '1px solid var(--line-bone)', fontSize: 12, color: 'var(--t-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="var(--t-2)" strokeWidth="1.3" /><path d="M7 9.5V6.5M7 4.5v.01" stroke="var(--t-2)" strokeWidth="1.4" strokeLinecap="round" /></svg>
          Risk signals are not diagnoses.
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 8, padding: '0 20px 16px', overflowX: 'auto' }}>
          {[{ l: 'All', sel: true }, { l: 'Cardio' }, { l: 'Metabolic' }, { l: 'Hepatic' }, { l: 'Inflammatory' }].map(c => (
            <span key={c.l} className={c.sel ? 'chip chip-sel' : 'chip'} style={{ flexShrink: 0 }}>{c.l}</span>
          ))}
        </div>

        {/* Risk cards */}
        <div style={{ padding: '0 16px' }}>
          <RiskCard
            cat="Cardiovascular"
            ico="❤"
            level="Elevated"
            confidence="High"
            reviewed
            reviewer="Dr. R. Patel · Mar 14"
            markers={['ApoB', 'Lp(a)', 'LDL-C']}
            narrative="Three lipid markers are co-elevated, suggesting moderately raised long-term cardiovascular risk."
          />
        </div>

        <div style={{ padding: '12px 16px 0' }}>
          <RiskCard
            cat="Metabolic"
            ico="◎"
            level="Moderate"
            confidence="Medium"
            pending
            markers={['HbA1c', 'Fasting insulin', 'Triglycerides']}
            narrative="Early signals of insulin resistance — most respond well to dietary changes."
          />
        </div>

        <div style={{ padding: '12px 16px 0' }}>
          <RiskCard
            cat="Hepatic"
            ico="⌬"
            level="Low"
            confidence="High"
            markers={['ALT', 'AST', 'GGT']}
            narrative="All liver markers in optimal range. Keep current habits."
          />
        </div>

        {/* Multi-biomarker pattern */}
        <div style={{ padding: '22px 20px 0' }}>
          <div className="caps" style={{ marginBottom: 10 }}>Patterns we noticed</div>
          <div style={{ background: '#241814', color: '#FBF4E8', borderRadius: 22, padding: 20, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -50, right: -40, width: 200, height: 200, borderRadius: 999, background: 'radial-gradient(circle, rgba(232,122,62,0.4), rgba(232,122,62,0) 60%)' }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(245,199,160,0.18)', color: '#F5C7A0', fontSize: 10.5, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase' }}>
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 0L0 6h3l-2 4 6-7H4l2-3H3z" fill="#F5C7A0" /></svg>
              Cross-system
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1.2, marginTop: 12, letterSpacing: -0.01 }}>
              Insulin resistance signals across three markers.
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
              {[{ n: 'HOMA-IR', v: '↑', c: '#F5C7A0' }, { n: 'Insulin', v: '↑', c: '#F5C7A0' }, { n: 'Trig', v: '↑', c: '#F5C7A0' }].map(m => (
                <div key={m.n} style={{ flex: 1, borderTop: '1px solid rgba(244,241,234,0.18)', paddingTop: 10 }}>
                  <div style={{ fontSize: 10.5, color: 'rgba(244,241,234,0.55)', textTransform: 'uppercase', letterSpacing: 0.05 }}>{m.n}</div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: m.c, marginTop: 2 }}>{m.v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.5, color: 'rgba(244,241,234,0.78)' }}>
              These often move together. Addressing one tends to nudge the others.
            </div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#FBF4E8', fontWeight: 500 }}>
              ✓ Clinician-reviewed · See plan <ChevRight size={11} c="#FBF4E8" />
            </div>
          </div>
        </div>

        {/* Methodology */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: '1px solid var(--line-bone)', fontSize: 13, color: 'var(--t-1)', fontWeight: 500 }}>
            <div>
              <div>Methodology &amp; sources</div>
              <div className="num" style={{ fontSize: 11, color: 'var(--t-3)', fontWeight: 500, marginTop: 2 }}>Risk model v2.4 · Mar 2026</div>
            </div>
            <ChevRight size={13} c="var(--t-2)" />
          </div>
        </div>
        <div style={{ height: 30 }} />
      </div>

      {/* Floating CTA */}
      <button style={{
        position: 'absolute', left: 20, right: 20, bottom: 100, zIndex: 65,
        height: 54, borderRadius: 999,
        background: 'linear-gradient(180deg, #F6B15A 0%, #D14829 100%)',
        color: '#fff', border: 'none',
        boxShadow: '0 14px 32px rgba(232,122,62,0.4)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 15.5, fontWeight: 600, cursor: 'pointer',
      }}>
        Talk to a clinician <ChevRight c="#fff" size={14} />
      </button>

      <BottomNav active="insights" />
    </Phone>
  )
}
