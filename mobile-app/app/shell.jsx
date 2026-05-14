// Shell — phone frame chrome + bottom tab bar.

function PhoneShell({ children, hideTabBar = false, tab, onTab, zoeFab, onOpenZoe }) {
  return (
    <div className="phone-shell">
      <div className="dynamic-island"/>
      <StatusBar/>
      <div className="screen">
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {children}
          {zoeFab && <ZoeFAB onOpen={onOpenZoe}/>}
        </div>
        {!hideTabBar && <TabBar tab={tab} onTab={onTab}/>}
      </div>
      <div className="home-indicator"><div className="home-indicator-bar"/></div>
    </div>
  );
}

const TAB_DEFS = [
  { id: "today",    label: "Today",    Icon: IconHome },
  { id: "missions", label: "Missions", Icon: IconTarget },
  { id: "test",     label: "Tests",    Icon: IconLab },
  { id: "profile",  label: "Profile",  Icon: IconUser },
];

function TabBar({ tab, onTab }) {
  return (
    <div style={{
      position: "absolute", left: 12, right: 12, bottom: 16,
      zIndex: 50,
      background: "rgba(251,249,245,0.78)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      borderRadius: 28,
      border: "1px solid rgba(217,211,202,0.6)",
      boxShadow: "0 8px 24px rgba(26,26,26,0.08), 0 1px 0 rgba(255,255,255,0.6) inset",
      padding: "8px 10px",
      display: "flex", justifyContent: "space-around", alignItems: "center",
    }}>
      {TAB_DEFS.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => onTab(t.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            padding: "8px 12px",
            color: active ? "var(--ink)" : "var(--ink-faint)",
            transition: "color 200ms",
          }}>
            <t.Icon size={20} color={active ? "var(--ink)" : "var(--ink-faint)"} strokeWidth={active ? 1.8 : 1.4}/>
            <span style={{
              fontSize: 10, fontWeight: 500,
              letterSpacing: "0.04em", textTransform: "uppercase",
              opacity: active ? 1 : 0.7,
            }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { PhoneShell, TabBar });
