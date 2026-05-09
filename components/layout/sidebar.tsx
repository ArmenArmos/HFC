'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

// ── Icons ──────────────────────────────────────────────────────

const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconHome = () => <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
const IconFolder = () => <svg {...S}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
const IconPlus = () => <svg {...S}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
const IconUser = () => <svg {...S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
const IconCalendar = () => <svg {...S}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
const IconUsers = () => <svg {...S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
const IconBuilding = () => <svg {...S}><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
const IconChart = () => <svg {...S}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" /></svg>
const IconList = () => <svg {...S}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
const IconLogout = () => <svg {...S}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
const IconMenu = () => <svg {...S}><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
const IconX = () => <svg {...S}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>

// ── Nav config ─────────────────────────────────────────────────

type NavItem = { label: string; href: string; icon: React.ReactNode; exact?: boolean }

function getNavItems(role: string, locale: string): NavItem[] {
  if (role === 'patient') return [
    { label: 'Dashboard', href: `/${locale}/patient/dashboard`, icon: <IconHome />, exact: true },
    { label: 'My Cases', href: `/${locale}/patient/cases`, icon: <IconFolder /> },
    { label: 'New Case', href: `/${locale}/patient/cases/new`, icon: <IconPlus />, exact: true },
    { label: 'Profile', href: `/${locale}/patient/profile`, icon: <IconUser />, exact: true },
  ]
  if (role === 'doctor') return [
    { label: 'Dashboard', href: `/${locale}/doctor/dashboard`, icon: <IconHome />, exact: true },
    { label: 'Cases', href: `/${locale}/doctor/cases`, icon: <IconFolder /> },
    { label: 'Profile', href: `/${locale}/doctor/profile`, icon: <IconUser />, exact: true },
    { label: 'Availability', href: `/${locale}/doctor/availability`, icon: <IconCalendar />, exact: true },
  ]
  return [
    { label: 'Dashboard', href: `/${locale}/admin/dashboard`, icon: <IconHome />, exact: true },
    { label: 'Cases', href: `/${locale}/admin/cases`, icon: <IconFolder /> },
    { label: 'Doctors', href: `/${locale}/admin/doctors`, icon: <IconUsers /> },
    { label: 'Users', href: `/${locale}/admin/users`, icon: <IconUser /> },
    { label: 'Organizations', href: `/${locale}/admin/organizations`, icon: <IconBuilding /> },
    { label: 'Analytics', href: `/${locale}/admin/analytics`, icon: <IconChart />, exact: true },
    { label: 'Audit Logs', href: `/${locale}/admin/audit-logs`, icon: <IconList />, exact: true },
  ]
}

// ── Sidebar component ──────────────────────────────────────────

export function AppSidebar({ role, userName, locale }: {
  role: 'patient' | 'doctor' | 'admin'
  userName: string
  locale: string
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const navItems = getNavItems(role, locale)

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href
    // "My Cases" should not activate on /cases/new
    if (item.href.endsWith('/cases')) return pathname.startsWith(item.href) && !pathname.endsWith('/new')
    return pathname.startsWith(item.href)
  }

  const roleLabel = role === 'patient' ? 'Patient Portal' : role === 'doctor' ? 'Doctor Portal' : 'Admin Console'

  const Inner = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      {/* Brand */}
      <div style={{ padding: '20px 16px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(59,130,246,0.2)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 3a9 9 0 1 1 0 18A9 9 0 0 1 12 3z" fill="rgba(255,255,255,0.15)" />
              <path d="M12 7v5l3 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 12h8" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14, letterSpacing: -0.3 }}>MSO Platform</div>
            <div style={{ color: 'rgba(148,163,184,0.7)', fontSize: 11, marginTop: 1 }}>{roleLabel}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {navItems.map(item => {
          const active = isActive(item)
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }} onClick={() => setMobileOpen(false)}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '9px 12px', borderRadius: 8,
                background: active ? 'rgba(59,130,246,0.82)' : 'transparent',
                color: active ? '#fff' : 'rgba(148,163,184,0.85)',
                fontSize: 13.5, fontWeight: active ? 600 : 400,
                transition: 'background 0.12s, color 0.12s',
              }}>
                {item.icon}
                {item.label}
              </div>
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div style={{ padding: '12px 10px 22px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 4 }}>
          <div style={{ width: 32, height: 32, borderRadius: 999, flexShrink: 0, background: 'linear-gradient(135deg, #334155, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 700, border: '1.5px solid rgba(255,255,255,0.1)' }}>
            {(userName?.[0] ?? '?').toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
            <div style={{ color: 'rgba(148,163,184,0.6)', fontSize: 11, textTransform: 'capitalize' }}>{role}</div>
          </div>
        </div>
        <Link href={`/${locale}/auth/signout`} style={{ textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 12px', borderRadius: 8, color: 'rgba(148,163,184,0.65)', fontSize: 13.5, cursor: 'pointer' }}>
            <IconLogout />
            Sign Out
          </div>
        </Link>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:block" style={{ width: 240, flexShrink: 0, height: '100vh', position: 'sticky', top: 0, overflowY: 'auto' }}>
        {Inner}
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 56, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', zIndex: 50 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>MSO Platform</span>
        <button onClick={() => setMobileOpen(o => !o)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 4, display: 'flex' }}>
          {mobileOpen ? <IconX /> : <IconMenu />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden" style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
          <aside style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 240, overflowY: 'auto' }}>
            {Inner}
          </aside>
        </div>
      )}
    </>
  )
}
