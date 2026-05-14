// Atoms — Orb, Noise, Button, Chip, Card, ZoeOrb, RhythmDots, HairlineBar, Avatar
// All depend on React (global). No styles object name collisions: prefix everything with atom*.

const ORB_PALETTES = {
  coral:    ["#FFE0D6", "#FF8A6F", "#E85A4F"],
  twilight: ["#D9CCEF", "#9B7FD4", "#F5A3A0"],
  sage:     ["#DDE4CC", "#8FA876", "#5F7A50"],
  blush:    ["#FFF1EC", "#F5C4B8", "#E8A89B"],
  lilac:    ["#EDE5F5", "#B5A3D8", "#9484C4"],
  amber:    ["#FBE6CC", "#E6B36A", "#C8893D"],
  storm:    ["#D5DAE2", "#8893A8", "#5A6478"],
};

function Noise({ opacity = 0.06, blend = "overlay" }) {
  // Inline SVG noise — cheap, single rect filtered with turbulence
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        opacity, mixBlendMode: blend, pointerEvents: "none",
      }}
    >
      <filter id="noiseFilter">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
        <feColorMatrix values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0   0 0 0 0.6 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#noiseFilter)" />
    </svg>
  );
}

function Orb({
  palette = "coral",
  size = 240,
  blur = 30,
  opacity = 1,
  breathe = false,
  style = {},
  withCore = false,
}) {
  const stops = ORB_PALETTES[palette] || ORB_PALETTES.coral;
  return (
    <div
      style={{
        position: "absolute",
        width: size, height: size,
        borderRadius: "50%",
        filter: `blur(${blur}px)`,
        opacity,
        background:
          // a stack of overlapping radial gradients = depth and "weather"
          `radial-gradient(60% 50% at 70% 30%, ${stops[2]} 0%, transparent 65%),
           radial-gradient(70% 60% at 30% 70%, ${stops[1]} 0%, transparent 70%),
           radial-gradient(100% 100% at 50% 50%, ${stops[0]} 0%, ${stops[0]} 40%, transparent 100%)`,
        animation: breathe ? "orbBreathe 4s ease-in-out infinite" : "none",
        pointerEvents: "none",
        ...style,
      }}
    >
      {withCore && (
        <div style={{
          position: "absolute", inset: "20%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${stops[2]} 0%, transparent 70%)`,
          filter: "blur(8px)",
          mixBlendMode: "screen",
        }} />
      )}
    </div>
  );
}

// Small, crisp Zoe orb avatar — visible at avatar scale (no heavy blur)
function ZoeOrb({ size = 28, breathe = true, palette = "coral", style = {} }) {
  const stops = ORB_PALETTES[palette];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      position: "relative", overflow: "hidden",
      background:
        `radial-gradient(60% 60% at 35% 35%, ${stops[0]} 0%, transparent 60%),
         radial-gradient(80% 80% at 65% 65%, ${stops[2]} 0%, transparent 70%),
         linear-gradient(135deg, ${stops[1]} 0%, ${stops[2]} 100%)`,
      boxShadow: `0 0 0 1px rgba(255,255,255,0.4) inset, 0 1px 4px ${stops[1]}55`,
      animation: breathe ? "orbBreathe 4s ease-in-out infinite" : "none",
      flexShrink: 0,
      ...style,
    }}>
      <Noise opacity={0.18} blend="soft-light"/>
    </div>
  );
}

function Card({ children, style = {}, padded = true, radius = 16, elevated = false, hairline = true, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        background: elevated ? "var(--surface-elevated)" : "var(--surface-card)",
        borderRadius: radius,
        border: hairline ? "1px solid var(--hairline)" : "none",
        boxShadow: "0 1px 2px rgba(26,26,26,0.04)",
        padding: padded ? 20 : 0,
        position: "relative",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Button({ children, variant = "primary", size = "md", fullWidth = false, onClick, style = {}, disabled = false, ...rest }) {
  const sizes = {
    sm: { padding: "10px 16px", fontSize: 14, height: 36 },
    md: { padding: "14px 22px", fontSize: 15, height: 48 },
    lg: { padding: "18px 28px", fontSize: 16, height: 56 },
  };
  const v = sizes[size];
  const variants = {
    primary: {
      background: "var(--ink)", color: "#FBF9F5",
      border: "1px solid var(--ink)",
    },
    secondary: {
      background: "transparent", color: "var(--ink)",
      border: "1px solid var(--hairline-strong)",
    },
    ghost: {
      background: "transparent", color: "var(--ink)",
      border: "none", padding: "8px 4px",
    },
    cream: {
      background: "var(--surface-card)", color: "var(--ink)",
      border: "1px solid var(--hairline)",
    },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        ...v, ...variants[variant],
        borderRadius: 999,
        fontFamily: "var(--font-sans)",
        fontWeight: 500,
        letterSpacing: "-0.005em",
        width: fullWidth ? "100%" : "auto",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        transition: "transform 200ms ease-out, opacity 200ms",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      onMouseDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
      onMouseUp={e => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
      {...rest}
    >
      {children}
    </button>
  );
}

function Chip({ children, selected, onClick, style = {}, size = "md" }) {
  const sz = size === "sm" ? { padding: "6px 12px", fontSize: 13 } : { padding: "10px 16px", fontSize: 14 };
  return (
    <button
      onClick={onClick}
      style={{
        ...sz,
        borderRadius: 999,
        border: selected ? "1px solid var(--ink)" : "1px solid var(--hairline-strong)",
        background: selected ? "var(--ink)" : "var(--surface-card)",
        color: selected ? "#FBF9F5" : "var(--ink-soft)",
        fontFamily: "var(--font-sans)", fontWeight: 500,
        transition: "all 200ms ease-out",
        display: "inline-flex", alignItems: "center", gap: 6,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function HairlineBar({ value = 0, color = "var(--signal-affirm)", height = 2 }) {
  return (
    <div style={{ width: "100%", height, background: "var(--hairline)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, value * 100))}%`, height: "100%",
        background: color, transition: "width 600ms ease-out",
        borderRadius: 99,
      }} />
    </div>
  );
}

// 7-dot rhythm. values: [0..1], where 1 filled, 0.5 grace, 0 missed.
function RhythmDots({ days = [], filledColor = "var(--ink)" }) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      {days.map((d, i) => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: d === 1 ? filledColor : d > 0 ? "var(--ink-faint)" : "transparent",
          border: d === 0 ? "1px solid var(--hairline-strong)" : "none",
        }} />
      ))}
    </div>
  );
}

// Small gradient swatch marker for missions
function OrbSwatch({ palette = "coral", size = 28 }) {
  const stops = ORB_PALETTES[palette];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `radial-gradient(circle at 35% 35%, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 100%)`,
      flexShrink: 0,
      position: "relative", overflow: "hidden",
      boxShadow: `0 1px 3px ${stops[1]}40`,
    }}>
      <Noise opacity={0.12} blend="soft-light"/>
    </div>
  );
}

// Section header for cards / lists
function SectionHeader({ eyebrow, title, sub, align = "left" }) {
  return (
    <div style={{ textAlign: align, marginBottom: 16 }}>
      {eyebrow && <div className="uppercase-eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
      <h3 style={{ marginBottom: sub ? 6 : 0 }}>{title}</h3>
      {sub && <p style={{ color: "var(--ink-muted)", fontSize: 14 }}>{sub}</p>}
    </div>
  );
}

// Phone status bar (simulated)
function StatusBar() {
  return (
    <div className="status-bar">
      <span style={{ fontWeight: 600 }}>9:41</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.9 }}>
        <svg width="18" height="11" viewBox="0 0 18 11"><rect x="0" y="6" width="3" height="5" rx="1" fill="#1A1A1A"/><rect x="5" y="3" width="3" height="8" rx="1" fill="#1A1A1A"/><rect x="10" y="0" width="3" height="11" rx="1" fill="#1A1A1A"/><rect x="15" y="2" width="3" height="9" rx="1" fill="#1A1A1A" opacity="0.5"/></svg>
        <svg width="22" height="10" viewBox="0 0 22 10"><rect x="0.5" y="0.5" width="18" height="9" rx="2.5" fill="none" stroke="#1A1A1A" strokeOpacity="0.5"/><rect x="2" y="2" width="11" height="6" rx="1" fill="#1A1A1A"/><rect x="20" y="3.5" width="1.5" height="3" rx="0.5" fill="#1A1A1A" opacity="0.5"/></svg>
      </div>
    </div>
  );
}

// Grain field — full bleed positioned absolute behind content
function GrainField({ orbs = [], style = {} }) {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", ...style }}>
      {orbs.map((o, i) => <Orb key={i} {...o} />)}
      <Noise opacity={0.05}/>
    </div>
  );
}

Object.assign(window, {
  Orb, Noise, ZoeOrb, Card, Button, Chip, HairlineBar, RhythmDots, OrbSwatch, SectionHeader, StatusBar, GrainField,
  ORB_PALETTES,
});
