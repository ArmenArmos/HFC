'use client'

import React from 'react'
import { Phone, ChevRight, SunriseMark } from '../primitives'

// ── J1: App Store Listing ───────────────────────────────────

export function J1_AppStore() {
  return (
    <Phone label="01 App Store" bg="#F5EBDD" time="9:41">
      <div className="phone-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingTop: 54, paddingBottom: 32 }}>
        {/* Top nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 8px' }}>
          <button style={{ background: 'transparent', border: 'none', fontSize: 13, fontWeight: 600, color: '#E87A3E', cursor: 'pointer' }}>
            ← Health & Fitness
          </button>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#E87A3E' }}>Get</span>
        </div>

        {/* App hero */}
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* App icon */}
            <div style={{
              width: 88,
              height: 88,
              borderRadius: 20,
              flexShrink: 0,
              background: 'linear-gradient(160deg, #FFE8C8 0%, #E87A3E 45%, #A2331A 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(162,51,26,0.28)',
            }}>
              <SunriseMark size={44} fg="#FBF4E8" />
            </div>
            <div style={{ flex: 1, paddingTop: 4 }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1.1, letterSpacing: -0.01 }}>VitaLens</div>
              <div style={{ fontSize: 13, color: 'var(--t-3)', marginTop: 3 }}>Preventive Health Intelligence</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                {[1,2,3,4,5].map(i => (
                  <svg key={i} width="11" height="11" viewBox="0 0 11 11" fill="#E87A3E"><path d="M5.5 1l1.2 2.8 3 .3-2.2 2 .6 3L5.5 7.8 2.9 9.1l.6-3L1.3 4.1l3-.3L5.5 1z"/></svg>
                ))}
                <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 4 }}>4.9 · 18.2K Ratings</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', borderTop: '1px solid var(--line-bone)', borderBottom: '1px solid var(--line-bone)', margin: '0 20px' }}>
          {[
            { label: 'Category', value: 'Health & Fitness' },
            { label: 'Installs', value: '180K+' },
            { label: 'Age', value: '17+' },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, padding: '12px 0', textAlign: 'center', borderLeft: i > 0 ? '1px solid var(--line-bone)' : 'none' }}>
              <div style={{ fontSize: 10, color: 'var(--t-3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.05 }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: 'var(--t-1)' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Editorial card */}
        <div style={{ margin: '20px 20px 0' }}>
          <div style={{
            borderRadius: 22,
            overflow: 'hidden',
            background: 'linear-gradient(160deg, #C9C2D5 0%, #D9C5C2 40%, #F5C7A0 70%, #E87A3E 100%)',
            padding: '22px 22px 18px',
            position: 'relative',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(36,24,20,0.6)', letterSpacing: 0.08, textTransform: 'uppercase', marginBottom: 8 }}>
              APP OF THE DAY
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, lineHeight: 1.05, letterSpacing: -0.01, color: '#241814' }}>
              Know your<br/>future self.
            </div>
            <div style={{ fontSize: 13, color: 'rgba(36,24,20,0.7)', marginTop: 8, lineHeight: 1.5 }}>
              Blood-based longevity intelligence — reviewed by board-certified physicians.
            </div>
          </div>
        </div>

        {/* Screenshot strip */}
        <div style={{ margin: '20px 0 0', display: 'flex', gap: 10, padding: '0 20px', overflowX: 'auto' }}>
          {['Dashboard', 'Insights', 'Plan'].map((s, i) => (
            <div key={i} style={{
              width: 120,
              height: 200,
              flexShrink: 0,
              borderRadius: 16,
              background: i === 0
                ? 'linear-gradient(160deg, #F5C7A0, #E87A3E 60%, #A2331A)'
                : i === 1
                  ? '#241814'
                  : 'linear-gradient(160deg, #FBF4E8, #F5EBDD)',
              display: 'flex',
              alignItems: 'flex-end',
              padding: 12,
              border: '1px solid var(--line-bone-2)',
            }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: i === 1 ? '#FBF4E8' : '#241814' }}>{s}</span>
            </div>
          ))}
        </div>

        {/* Description */}
        <div style={{ padding: '20px 20px 0', fontSize: 14, color: 'var(--t-2)', lineHeight: 1.55 }}>
          VitaLens turns your blood panel into a clear, actionable health score — reviewed by real doctors, connected to your daily habits.
        </div>
      </div>
    </Phone>
  )
}

// ── J2: Welcome ─────────────────────────────────────────────

export function J2_Welcome() {
  return (
    <Phone label="02 Welcome" bg="#241814" dark time="9:41">
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Bloom + Chladni rings hero */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          paddingTop: 54,
        }}>
          {/* Radial bloom */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 320,
            height: 320,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 60%, #FFE8C8 0%, #F6B15A 25%, #E87A3E 50%, rgba(162,51,26,0) 75%)',
            opacity: 0.55,
            filter: 'blur(1px)',
          }} />
          {/* Chladni rings */}
          <svg viewBox="0 0 340 340" style={{ position: 'absolute', width: 340, height: 340, opacity: 0.28 }}>
            {[40, 72, 108, 148, 192, 240].map((r, i) => (
              <circle key={i} cx="170" cy="170" r={r} fill="none" stroke="#FFE8C8" strokeWidth="0.7" opacity={1 - i * 0.14} />
            ))}
          </svg>
          {/* Brand mark */}
          <div style={{ position: 'relative', marginBottom: 32 }}>
            <div style={{
              width: 72,
              height: 72,
              borderRadius: 22,
              background: 'radial-gradient(circle at 40% 35%, #FFE8C8 0%, #F6B15A 30%, #E87A3E 60%, #A2331A 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 40px rgba(232,122,62,0.45), inset 0 1px 0 rgba(255,232,200,0.3)',
            }}>
              <SunriseMark size={38} fg="#FBF4E8" />
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 42, lineHeight: 1.0, letterSpacing: -0.03, color: '#FBF4E8', textAlign: 'center', position: 'relative' }}>
            Know your<br />
            <span style={{ fontStyle: 'italic', color: '#F5C7A0' }}>future self.</span>
          </div>
          <div style={{ fontSize: 15, color: 'rgba(244,241,234,0.65)', marginTop: 14, lineHeight: 1.5, textAlign: 'center', maxWidth: 280, position: 'relative', padding: '0 20px' }}>
            Blood-based longevity intelligence, reviewed by real doctors.
          </div>
        </div>

        {/* Story cards */}
        <div style={{ display: 'flex', gap: 10, padding: '0 20px 20px', overflowX: 'auto' }}>
          {[
            { icon: '🔬', title: 'Know', desc: '100+ biomarkers decoded into plain language' },
            { icon: '⚡', title: 'Act', desc: 'Personalized daily tasks that actually move numbers' },
            { icon: '📈', title: 'Track', desc: 'See your body change over months' },
          ].map((c, i) => (
            <div key={i} style={{
              minWidth: 140,
              background: 'rgba(251,244,232,0.07)',
              border: '1px solid rgba(244,241,234,0.12)',
              borderRadius: 18,
              padding: '14px 14px',
            }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{c.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#FBF4E8' }}>{c.title}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(244,241,234,0.55)', marginTop: 4, lineHeight: 1.4 }}>{c.desc}</div>
            </div>
          ))}
        </div>

        {/* Trust strip */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, padding: '0 20px 16px', fontSize: 11, color: 'rgba(244,241,234,0.45)', fontWeight: 500 }}>
          <span>HIPAA-aligned</span>
          <span>·</span>
          <span>Stanford-advised</span>
          <span>·</span>
          <span>4.9 ★</span>
        </div>

        {/* CTA */}
        <div style={{ padding: '0 20px 46px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn-prim" style={{ width: '100%' }}>
            Get started
          </button>
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(244,241,234,0.4)' }}>
            Already have an account? <span style={{ color: '#F5C7A0', fontWeight: 600 }}>Sign in</span>
          </div>
        </div>
      </div>
    </Phone>
  )
}

// ── J3: Sign Up ─────────────────────────────────────────────

export function J3_Signup() {
  return (
    <Phone label="03 Sign Up" bg="#F5EBDD" time="9:41">
      <div style={{ position: 'absolute', inset: 0, paddingTop: 54, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 24px 0' }}>
          <div style={{ fontSize: 10.5, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.07, textTransform: 'uppercase', marginBottom: 8 }}>
            Create account
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 34, lineHeight: 1.05, letterSpacing: -0.02 }}>
            Your health,<br />
            <span style={{ fontStyle: 'italic' }}>your data.</span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--t-3)', marginTop: 10, lineHeight: 1.5 }}>
            We encrypt everything. You control who sees what.
          </div>
        </div>

        <div style={{ flex: 1, padding: '32px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Apple SSO */}
          <button style={{
            height: 54,
            borderRadius: 999,
            background: '#241814',
            color: '#FBF4E8',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M13.8 9.5c0-2.4 1.9-3.5 2-3.6C14.5 4 12.8 3.8 12.1 3.8c-1.4-.1-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.8-.4 6.9 1.1 9.1.7 1.1 1.6 2.3 2.8 2.3 1.1 0 1.5-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.8-2.2.9-1.2 1.2-2.4 1.2-2.5-.1 0-2.8-1.1-2.8-4z" fill="#FBF4E8"/>
              <path d="M11.5 2.3c.6-.8 1-1.9.9-3C11.5-.6 10.3 0 9.6.9 9 1.6 8.5 2.7 8.6 3.8c.9.1 2-.5 2.9-1.5z" fill="#FBF4E8"/>
            </svg>
            Continue with Apple
          </button>

          {/* Google SSO */}
          <button style={{
            height: 54,
            borderRadius: 999,
            background: '#FBF4E8',
            color: '#241814',
            border: '1.5px solid var(--line-bone)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line-bone)' }} />
            <span style={{ fontSize: 12, color: 'var(--t-3)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--line-bone)' }} />
          </div>

          {/* Email input */}
          <div style={{ position: 'relative' }}>
            <input
              type="email"
              placeholder="your@email.com"
              style={{
                width: '100%',
                height: 54,
                borderRadius: 999,
                border: '1.5px solid var(--line-bone)',
                background: '#FBF4E8',
                padding: '0 54px 0 20px',
                fontSize: 15,
                color: 'var(--t-1)',
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button className="btn-prim" style={{ width: '100%' }}>
            Send magic link
            <ChevRight c="#fff" size={14} />
          </button>
        </div>

        <div style={{ padding: '16px 24px 46px', textAlign: 'center', fontSize: 11.5, color: 'var(--t-3)', lineHeight: 1.5 }}>
          By continuing you agree to our{' '}
          <span style={{ color: 'var(--t-1)', textDecoration: 'underline', fontWeight: 500 }}>Terms</span>
          {' '}and{' '}
          <span style={{ color: 'var(--t-1)', textDecoration: 'underline', fontWeight: 500 }}>Privacy Policy</span>.
          We never sell your data.
        </div>
      </div>
    </Phone>
  )
}
