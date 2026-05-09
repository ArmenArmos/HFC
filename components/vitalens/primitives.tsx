'use client'

import React from 'react'

// ── SVG Icon primitives ─────────────────────────────────────

export function ChevRight({ size = 12, c = '#241814' }: { size?: number; c?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevLeft({ size = 12, c = '#241814' }: { size?: number; c?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M7.5 2.5L4 6l3.5 3.5" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Arrow({ dir = 'up', size = 11, c = '#241814' }: { dir?: 'up' | 'down'; size?: number; c?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none">
      {dir === 'up'
        ? <path d="M5.5 9V2M2.5 5l3-3 3 3" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M5.5 2v7M8.5 6l-3 3-3-3" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      }
    </svg>
  )
}

export function Plus({ size = 11, c = '#241814' }: { size?: number; c?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none">
      <path d="M5.5 1v9M1 5.5h9" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Star({ filled = false, size = 13 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <path
        d="M6.5 1.5l1.4 3 3.1.4-2.3 2.2.6 3.1L6.5 8.7l-2.8 1.5.6-3.1L2 4.9l3.1-.4L6.5 1.5z"
        fill={filled ? '#E87A3E' : 'none'}
        stroke={filled ? '#E87A3E' : 'rgba(36,24,20,0.25)'}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SunriseMark({ size = 28, fg = '#FBF4E8' }: { size?: number; fg?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M4 18a10 10 0 0120 0" stroke={fg} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="5" x2="14" y2="8" stroke={fg} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="5" y1="9" x2="7.5" y2="11.5" stroke={fg} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="23" y1="9" x2="20.5" y2="11.5" stroke={fg} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

// ── RoundBtn ────────────────────────────────────────────────

export function RoundBtn({
  children,
  dark = false,
  size = 36,
  onClick,
}: {
  children?: React.ReactNode
  dark?: boolean
  size?: number
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: dark ? 'none' : '1px solid rgba(36,24,20,0.10)',
        background: dark ? '#241814' : 'rgba(245,235,221,0.8)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
        backdropFilter: 'blur(8px)',
      }}
    >
      {children}
    </button>
  )
}

// ── StatusPill ──────────────────────────────────────────────

const STATUS_CONFIGS = {
  optimal:  { dot: '#4FB45C', label: 'Optimal',   bg: 'rgba(79,180,92,0.12)',   fg: '#1F5A2A' },
  inrange:  { dot: '#7DA679', label: 'In range',  bg: 'rgba(125,166,121,0.12)', fg: '#2A5227' },
  watch:    { dot: '#E8A347', label: 'Watch',     bg: 'rgba(232,163,71,0.15)',  fg: '#7A3D00' },
  out:      { dot: '#E87A3E', label: 'Out of range', bg: 'rgba(232,122,62,0.14)', fg: '#7A2E1A' },
  critical: { dot: '#D14829', label: 'Critical',  bg: 'rgba(209,72,41,0.15)',   fg: '#7A1A0A' },
  pending:  { dot: '#7A6253', label: 'Pending',   bg: 'rgba(122,98,83,0.10)',   fg: '#4A3328' },
} as const

type StatusKind = keyof typeof STATUS_CONFIGS

export function StatusPill({
  kind,
  label,
  dark = false,
}: {
  kind: StatusKind
  label?: string
  dark?: boolean
}) {
  const cfg = STATUS_CONFIGS[kind]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px 4px 8px',
      borderRadius: 999,
      background: dark ? 'rgba(244,241,234,0.12)' : cfg.bg,
      color: dark ? '#FBF4E8' : cfg.fg,
      fontSize: 12,
      fontWeight: 600,
      border: `1px solid ${dark ? 'rgba(244,241,234,0.18)' : 'transparent'}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: cfg.dot, flexShrink: 0 }} />
      {label ?? cfg.label}
    </span>
  )
}

// ── RangeBar ────────────────────────────────────────────────

export function RangeBar({
  min = 0,
  max = 200,
  optMin,
  optMax,
  value,
  status = 'watch',
  dark = false,
}: {
  min?: number
  max?: number
  optMin: number
  optMax: number
  value: number
  status?: StatusKind
  dark?: boolean
}) {
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))
  const dotColors: Record<StatusKind, string> = {
    optimal: '#4FB45C', inrange: '#7DA679', watch: '#E8A347', out: '#E87A3E', critical: '#D14829', pending: '#7A6253',
  }
  const trackBg = dark ? 'rgba(244,241,234,0.15)' : 'rgba(36,24,20,0.08)'
  const optBg   = dark ? 'rgba(125,166,121,0.35)'  : 'rgba(125,166,121,0.18)'

  return (
    <div style={{ position: 'relative', height: 28, display: 'flex', alignItems: 'center' }}>
      {/* track */}
      <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 99, background: trackBg }} />
      {/* optimal band */}
      <div style={{
        position: 'absolute',
        left: `${pct(optMin)}%`,
        width: `${pct(optMax) - pct(optMin)}%`,
        height: 4,
        borderRadius: 2,
        background: optBg,
      }} />
      {/* value dot */}
      <div style={{
        position: 'absolute',
        left: `calc(${pct(value)}% - 7px)`,
        width: 14,
        height: 14,
        borderRadius: 99,
        background: dotColors[status],
        border: `2px solid ${dark ? '#241814' : '#fff'}`,
        boxShadow: `0 1px 4px ${dotColors[status]}55`,
      }} />
      {/* labels */}
      <span style={{
        position: 'absolute',
        left: `${pct(optMin)}%`,
        top: 14,
        fontSize: 9.5,
        color: dark ? 'rgba(244,241,234,0.5)' : 'var(--t-3)',
        fontWeight: 500,
        transform: 'translateX(-50%)',
        fontFamily: 'var(--font-mono)',
      }}>{optMin}</span>
      <span style={{
        position: 'absolute',
        left: `${pct(optMax)}%`,
        top: 14,
        fontSize: 9.5,
        color: dark ? 'rgba(244,241,234,0.5)' : 'var(--t-3)',
        fontWeight: 500,
        transform: 'translateX(-50%)',
        fontFamily: 'var(--font-mono)',
      }}>{optMax}</span>
    </div>
  )
}

// ── Sparkline ───────────────────────────────────────────────

export function Sparkline({
  points,
  color = '#E87A3E',
  height = 28,
  w = 70,
  fill = false,
}: {
  points: number[]
  color?: string
  height?: number
  w?: number
  fill?: boolean
}) {
  if (!points || points.length < 2) return null
  const mn = Math.min(...points), mx = Math.max(...points)
  const range = mx - mn || 1
  const xAt = (i: number) => (i / (points.length - 1)) * w
  const yAt = (v: number) => height - 2 - ((v - mn) / range) * (height - 6)
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p).toFixed(1)}`).join(' ')
  const lastX = xAt(points.length - 1), lastY = yAt(points[points.length - 1])

  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ overflow: 'visible' }}>
      {fill && (
        <path
          d={`${linePath} L${lastX},${height} L0,${height} Z`}
          fill={color}
          opacity={0.15}
        />
      )}
      <path d={linePath} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  )
}

// ── BottomNav ───────────────────────────────────────────────

const NAV_ITEMS = [
  {
    id: 'home', label: 'Home',
    icon: (active: boolean, dark: boolean) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M3 9.5L11 3l8 6.5V19a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"
          fill={active ? (dark ? '#FBF4E8' : '#241814') : 'none'}
          stroke={active ? (dark ? '#FBF4E8' : '#241814') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 20v-8h6v8" stroke={active ? (dark ? '#241814' : '#FBF4E8') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'results', label: 'Results',
    icon: (active: boolean, dark: boolean) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="3" y="3" width="16" height="16" rx="3"
          fill={active ? (dark ? '#FBF4E8' : '#241814') : 'none'}
          stroke={active ? (dark ? '#FBF4E8' : '#241814') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth="1.6" />
        <path d="M7 14l2.5-3 2.5 2 3-4.5"
          stroke={active ? (dark ? '#241814' : '#FBF4E8') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'insights', label: 'Insights',
    icon: (active: boolean, dark: boolean) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="7"
          fill={active ? (dark ? '#FBF4E8' : '#241814') : 'none'}
          stroke={active ? (dark ? '#FBF4E8' : '#241814') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth="1.6" />
        <path d="M11 8v4M11 14.5v.01"
          stroke={active ? (dark ? '#241814' : '#FBF4E8') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'plan', label: 'Plan',
    icon: (active: boolean, dark: boolean) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M6 3v16M10 6h8M10 11h6M10 16h4"
          stroke={active ? (dark ? '#FBF4E8' : '#241814') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth={active ? 2 : 1.6} strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'you', label: 'You',
    icon: (active: boolean, dark: boolean) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="8" r="3"
          fill={active ? (dark ? '#FBF4E8' : '#241814') : 'none'}
          stroke={active ? (dark ? '#FBF4E8' : '#241814') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth="1.6" />
        <path d="M4 19c0-3.866 3.134-7 7-7s7 3.134 7 7"
          stroke={active ? (dark ? '#FBF4E8' : '#241814') : (dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)')}
          strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
]

export function BottomNav({
  active,
  dark = false,
}: {
  active: string
  dark?: boolean
}) {
  const bg = dark ? 'rgba(36,24,20,0.92)' : 'rgba(245,235,221,0.92)'
  const border = dark ? 'rgba(244,241,234,0.08)' : 'rgba(36,24,20,0.08)'
  const activeFg = dark ? '#FBF4E8' : '#241814'
  const inactiveFg = dark ? 'rgba(244,241,234,0.45)' : 'rgba(36,24,20,0.35)'

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 90,
      background: bg,
      backdropFilter: 'blur(20px)',
      borderTop: `1px solid ${border}`,
      display: 'flex',
      alignItems: 'flex-start',
      paddingTop: 10,
      zIndex: 80,
    }}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active
        return (
          <div key={item.id} style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
          }}>
            {item.icon(isActive, dark)}
            <span style={{
              fontSize: 10.5,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? activeFg : inactiveFg,
              letterSpacing: -0.01,
            }}>
              {item.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Phone Frame ─────────────────────────────────────────────

export function Phone({
  children,
  bg = '#F5EBDD',
  dark = false,
  label,
  time = '9:41',
}: {
  children?: React.ReactNode
  bg?: string
  dark?: boolean
  label?: string
  time?: string
}) {
  const fg = dark ? 'rgba(244,241,234,0.85)' : 'rgba(36,24,20,0.75)'

  return (
    <div
      className="vl"
      style={{
        width: 393,
        height: 852,
        borderRadius: 54,
        background: bg,
        position: 'relative',
        overflow: 'hidden',
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.15), 0 24px 80px rgba(0,0,0,0.22), inset 0 0 0 1px rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}
    >
      {/* Status bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 54,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 24px 0',
        zIndex: 100,
      }}>
        {/* Time */}
        <span style={{ fontSize: 15, fontWeight: 600, color: fg, fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </span>

        {/* Dynamic island */}
        <div style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 120,
          height: 34,
          background: '#000',
          borderRadius: 20,
          zIndex: 101,
        }} />

        {/* Status icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Signal */}
          <svg width="17" height="12" viewBox="0 0 17 12" fill={fg}>
            <rect x="0" y="7" width="3" height="5" rx="1" />
            <rect x="4.5" y="4" width="3" height="8" rx="1" />
            <rect x="9" y="1.5" width="3" height="10.5" rx="1" />
            <rect x="13.5" y="0" width="3" height="12" rx="1" opacity="0.3" />
          </svg>
          {/* WiFi */}
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <path d="M8 10.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" fill={fg} />
            <path d="M3.5 6.5A6.5 6.5 0 0112.5 6.5" stroke={fg} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
            <path d="M1 3.5A10.5 10.5 0 0115 3.5" stroke={fg} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          </svg>
          {/* Battery */}
          <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
            <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke={fg} strokeOpacity="0.35" />
            <rect x="2" y="2" width="16" height="8" rx="2" fill={fg} />
            <path d="M23 4v4" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeOpacity="0.4" />
          </svg>
        </div>
      </div>

      {/* Home indicator */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 134,
        height: 5,
        background: dark ? 'rgba(244,241,234,0.25)' : 'rgba(36,24,20,0.20)',
        borderRadius: 99,
        zIndex: 100,
      }} />

      {children}
    </div>
  )
}
