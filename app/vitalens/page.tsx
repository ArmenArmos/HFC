import React from 'react'
import { J1_AppStore, J2_Welcome, J3_Signup } from '@/components/vitalens/screens/discover'
import { J4_Consent, J5_Goals, J6_MedicalQ, J7_Lifestyle } from '@/components/vitalens/screens/setup'
import {
  J8_LabSelection, J9_Payment, J10_Booking,
  J11_Visit, J12_Waiting, J13_Notification,
} from '@/components/vitalens/screens/test'
import { J14_Dashboard } from '@/components/vitalens/screens/dashboard'
import { J15_BiomarkerDetail } from '@/components/vitalens/screens/biomarker'
import { J16_RiskInsights } from '@/components/vitalens/screens/risk'
import { J17_Recommendations, J18_ClinicianReview, J19_ActionPlan } from '@/components/vitalens/screens/results'
import { J20_Progress, J21_RetestReminder, J22_Habits } from '@/components/vitalens/screens/retain'
import { J23_Today, J24_AIChat, J25_Wearables, J26_Signals } from '@/components/vitalens/screens/v11'

type Section = {
  id: string
  title: string
  subtitle: string
  screens: { id: string; label: string; component: React.ReactNode }[]
}

const SECTIONS: Section[] = [
  {
    id: 'discover',
    title: '§1 Discover',
    subtitle: 'Acquisition · App Store → Welcome → Sign Up',
    screens: [
      { id: 'j1', label: 'J1 · App Store', component: <J1_AppStore /> },
      { id: 'j2', label: 'J2 · Welcome', component: <J2_Welcome /> },
      { id: 'j3', label: 'J3 · Sign Up', component: <J3_Signup /> },
    ],
  },
  {
    id: 'setup',
    title: '§2 Setup',
    subtitle: 'Onboarding · Consent → Goals → Medical History → Lifestyle',
    screens: [
      { id: 'j4', label: 'J4 · Consent', component: <J4_Consent /> },
      { id: 'j5', label: 'J5 · Goals', component: <J5_Goals /> },
      { id: 'j6', label: 'J6 · Medical History', component: <J6_MedicalQ /> },
      { id: 'j7', label: 'J7 · Lifestyle', component: <J7_Lifestyle /> },
    ],
  },
  {
    id: 'test',
    title: '§3 Test',
    subtitle: 'Lab Journey · Selection → Payment → Booking → Visit → Waiting → Notification',
    screens: [
      { id: 'j8', label: 'J8 · Lab Selection', component: <J8_LabSelection /> },
      { id: 'j9', label: 'J9 · Payment', component: <J9_Payment /> },
      { id: 'j10', label: 'J10 · Booking', component: <J10_Booking /> },
      { id: 'j11', label: 'J11 · Visit', component: <J11_Visit /> },
      { id: 'j12', label: 'J12 · Waiting', component: <J12_Waiting /> },
      { id: 'j13', label: 'J13 · Notification', component: <J13_Notification /> },
    ],
  },
  {
    id: 'results',
    title: '§4 Results',
    subtitle: 'Core App · Dashboard → Biomarker → Insights → Recommendations → Clinician → Plan',
    screens: [
      { id: 'j14', label: 'J14 · Dashboard', component: <J14_Dashboard /> },
      { id: 'j15', label: 'J15 · Biomarker Detail', component: <J15_BiomarkerDetail /> },
      { id: 'j16', label: 'J16 · Risk Insights', component: <J16_RiskInsights /> },
      { id: 'j17', label: 'J17 · Recommendations', component: <J17_Recommendations /> },
      { id: 'j18', label: 'J18 · Clinician Review', component: <J18_ClinicianReview /> },
      { id: 'j19', label: 'J19 · Action Plan', component: <J19_ActionPlan /> },
    ],
  },
  {
    id: 'retain',
    title: '§5 Retain',
    subtitle: 'Long-term · Progress → Retest → Habits → Today → AI Chat → Wearables → Signals',
    screens: [
      { id: 'j20', label: 'J20 · Progress', component: <J20_Progress /> },
      { id: 'j21', label: 'J21 · Retest Reminder', component: <J21_RetestReminder /> },
      { id: 'j22', label: 'J22 · Long-term Habits', component: <J22_Habits /> },
      { id: 'j23', label: 'J23 · Today', component: <J23_Today /> },
      { id: 'j24', label: 'J24 · AI Chat', component: <J24_AIChat /> },
      { id: 'j25', label: 'J25 · Wearables', component: <J25_Wearables /> },
      { id: 'j26', label: 'J26 · Signals', component: <J26_Signals /> },
    ],
  },
]

export default function VitaLensPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#F0EDE8',
      backgroundImage: `url("data:image/svg+xml,%3Csvg width='120' height='120' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M120 0H0v120' fill='none' stroke='rgba(36,24,20,0.05)' stroke-width='1'/%3E%3C/svg%3E")`,
      backgroundSize: '120px 120px',
    }}>
      {/* Canvas header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(240,237,232,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(36,24,20,0.08)',
        padding: '14px 60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Brand mark */}
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(160deg, #FFE8C8 0%, #E87A3E 50%, #A2331A 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 28 28" fill="none">
              <path d="M4 18a10 10 0 0120 0" stroke="#FBF4E8" strokeWidth="2" strokeLinecap="round" />
              <line x1="14" y1="5" x2="14" y2="8" stroke="#FBF4E8" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#241814', letterSpacing: -0.3 }}>VitaLens</div>
            <div style={{ fontSize: 11, color: 'rgba(36,24,20,0.55)', marginTop: 1 }}>Full Journey v2 · Warm Sunset</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {SECTIONS.map(s => (
            <a key={s.id} href={`#${s.id}`} style={{
              fontSize: 13, fontWeight: 500, color: 'rgba(36,24,20,0.6)',
              textDecoration: 'none', letterSpacing: -0.01,
            }}>
              {s.title}
            </a>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(36,24,20,0.45)', fontWeight: 500 }}>
          26 screens · 5 sections
        </div>
      </div>

      {/* Canvas intro */}
      <div style={{ padding: '60px 60px 48px' }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(36,24,20,0.45)', letterSpacing: 0.08, textTransform: 'uppercase', marginBottom: 12 }}>Design System · VitaLens Warm Sunset</div>
          <div style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 52, lineHeight: 0.95, letterSpacing: -0.04, color: '#241814', marginBottom: 20,
          }}>
            Preventive health,<br />
            <span style={{ fontStyle: 'italic', color: '#E87A3E' }}>made legible.</span>
          </div>
          <div style={{ fontSize: 16, color: 'rgba(36,24,20,0.6)', lineHeight: 1.6, maxWidth: 520 }}>
            A 26-screen mobile-first health app. Warm Sunset palette — ember orange (#E87A3E), deep coral (#D14829), bone cream (#F5EBDD), ink brown-black (#241814). Instrument Serif headings, Inter Tight UI, JetBrains Mono numbers.
          </div>

          {/* Token swatches */}
          <div style={{ display: 'flex', gap: 10, marginTop: 28, flexWrap: 'wrap' }}>
            {[
              { name: 'Ember', hex: '#E87A3E' },
              { name: 'Coral', hex: '#D14829' },
              { name: 'Bone', hex: '#F5EBDD' },
              { name: 'Ink', hex: '#241814' },
              { name: 'Optimal', hex: '#7DA679' },
              { name: 'Watch', hex: '#E8A347' },
              { name: 'Clay', hex: '#7A2E1A' },
            ].map(t => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: t.hex, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#241814' }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: 'rgba(36,24,20,0.5)', fontFamily: 'monospace' }}>{t.hex}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      {SECTIONS.map(section => (
        <div key={section.id} id={section.id} style={{ marginBottom: 80 }}>
          {/* Section header */}
          <div style={{ padding: '0 60px 48px' }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#241814', letterSpacing: -0.4 }}>{section.title}</div>
            <div style={{ fontSize: 15, color: 'rgba(36,24,20,0.55)', marginTop: 6 }}>{section.subtitle}</div>
          </div>

          {/* Screen row */}
          <div style={{
            display: 'flex',
            gap: 48,
            padding: '0 60px 20px',
            overflowX: 'auto',
            alignItems: 'flex-start',
            scrollSnapType: 'x mandatory',
          }}>
            {section.screens.map(screen => (
              <div key={screen.id} style={{ flexShrink: 0, scrollSnapAlign: 'start' }}>
                {/* Label */}
                <div style={{
                  marginBottom: 12,
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'rgba(36,24,20,0.6)',
                  letterSpacing: -0.01,
                }}>
                  {screen.label}
                </div>
                {/* Phone at 55% scale for canvas view */}
                <div style={{
                  transform: 'scale(0.55)',
                  transformOrigin: 'top left',
                  width: 393,
                  height: 852,
                }}>
                  {screen.component}
                </div>
                {/* Spacer for scaled-down phone */}
                <div style={{ height: 852 * 0.55 - 852, marginTop: 0 }} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Footer */}
      <div style={{
        padding: '40px 60px 60px',
        borderTop: '1px solid rgba(36,24,20,0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 40,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#241814', marginBottom: 6 }}>VitaLens Full Journey v2 · Warm Sunset</div>
          <div style={{ fontSize: 12, color: 'rgba(36,24,20,0.5)', lineHeight: 1.6 }}>
            26 screens · 5 journey sections<br />
            Instrument Serif + Inter Tight + JetBrains Mono<br />
            iPhone 15 Pro (393 × 852) · Mobile-first
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(36,24,20,0.45)', lineHeight: 1.8 }}>
          <div><strong style={{ color: '#241814' }}>Palette</strong> — Warm Sunset</div>
          <div>--sun-3: #E87A3E (ember orange)</div>
          <div>--sun-4: #D14829 (deep coral)</div>
          <div>--bone: #F5EBDD · --ink: #241814</div>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(36,24,20,0.45)', lineHeight: 1.8 }}>
          <div><strong style={{ color: '#241814' }}>Status system</strong></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[['Optimal', '#4FB45C'], ['In range', '#7DA679'], ['Watch', '#E8A347'], ['Out of range', '#E87A3E'], ['Critical', '#D14829']].map(([l, c]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: c, display: 'inline-block' }} />
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
