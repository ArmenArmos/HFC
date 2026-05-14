// Missions screen — Today + This week segmented tabs

const { useState: useStateM } = React;

const ZOE_AFFIRMS = [
  "Noticed. Small wins compound.",
  "That counts. Recovery is invisible at first.",
  "Quiet work. Tomorrow follows.",
  "One steady step. That's enough.",
];

const MISSION_ICONS = {
  Food: { Icon: IconUtensils, orb: "sage" },
  Walking: { Icon: IconFootprints, orb: "coral" },
  Sleep: { Icon: IconMoon, orb: "lilac" },
  Stress: { Icon: IconWind, orb: "blush" },
  Hydration: { Icon: IconDroplet, orb: "twilight" },
  Exercise: { Icon: IconActivity, orb: "amber" },
};

function MissionRow({ m, onCheck }) {
  const meta = MISSION_ICONS[m.type] || { Icon: IconSparkles, orb: "coral" };
  const [affirm, setAffirm] = useStateM(null);
  const handle = () => {
    if (m.done) return;
    const msg = ZOE_AFFIRMS[Math.floor(Math.random() * ZOE_AFFIRMS.length)];
    setAffirm(msg);
    onCheck(m.id);
    setTimeout(() => setAffirm(null), 2400);
  };
  return (
    <Card padded={false} style={{ padding: "16px 16px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <OrbSwatch palette={meta.orb} size={28}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 4 }}>{m.type}</div>
          <div style={{ fontSize: 14.5, color: "var(--ink)", lineHeight: 1.4 }}>{m.text}</div>
        </div>
        <button onClick={handle} style={{
          width: 32, height: 32, borderRadius: "50%",
          border: m.done ? "none" : "1px solid var(--hairline-strong)",
          background: m.done ? "var(--signal-affirm)" : "var(--surface-card)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 200ms",
        }}>
          {m.done && <IconCheck size={16} color="#FBF9F5" strokeWidth={2}/>}
        </button>
      </div>
      {affirm && (
        <div className="fade-up serif-i" style={{
          marginTop: 12, marginLeft: 42,
          fontSize: 13.5, color: "var(--signal-affirm)",
        }}>{affirm}</div>
      )}
    </Card>
  );
}

function MissionsToday() {
  const [missions, setMissions] = useStateM(window.NoreonData.todayMissions);
  const onCheck = (id) => setMissions(missions.map(m => m.id === id ? { ...m, done: true } : m));
  const dayPct = Math.round(missions.filter(m => m.done).length / missions.length * 100);
  return (
    <div style={{ padding: "8px 24px 24px" }}>
      <Card style={{ padding: "16px 18px", marginBottom: 16, background: "var(--surface-elevated)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <span className="uppercase-eyebrow">Today's rhythm</span>
          <span className="tabular serif" style={{ fontSize: 26, lineHeight: 1, fontStyle: "italic" }}>{dayPct}%</span>
        </div>
        <HairlineBar value={dayPct/100} color="var(--signal-affirm)" height={2}/>
        <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 8, lineHeight: 1.45 }}>
          A complete day lands around four. Two is enough on tired days.
        </p>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {missions.map(m => (
          <MissionRow key={m.id} m={m} onCheck={onCheck}/>
        ))}
      </div>
    </div>
  );
}

function MissionsWeek({ openReview }) {
  const wf = window.NoreonData.weekFocus;
  return (
    <div style={{ padding: "8px 24px 24px" }}>
      <Card style={{ padding: "20px 20px 22px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -30, right: -30 }}>
          <Orb palette="sage" size={150} blur={26} opacity={0.7}/>
        </div>
        <div className="uppercase-eyebrow" style={{ marginBottom: 6, position: "relative" }}>This week's focus</div>
        <h3 className="serif" style={{ fontSize: 28, position: "relative" }}>{wf.title}</h3>
        <p className="serif-i" style={{ marginTop: 6, fontSize: 15, color: "var(--ink-soft)", position: "relative" }}>{wf.sub}</p>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {wf.missions.map((m, i) => (
          <div key={m.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.4, flex: 1, paddingRight: 12 }}>{m.text}</span>
              <span className="tabular" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{Math.round(m.progress * 100)}%</span>
            </div>
            <HairlineBar value={m.progress} color="var(--signal-affirm)" height={2}/>
          </div>
        ))}
      </div>

      <Card style={{ marginTop: 20, padding: "16px 18px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
        <p className="serif-i" style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.5 }}>
          {wf.targetCopy}
        </p>
      </Card>

      <button onClick={openReview} style={{ width: "100%", marginTop: 16, padding: 0, background: "transparent" }}>
        <Card style={{ padding: "18px 18px", position: "relative", overflow: "hidden" }}>
          <Orb palette="amber" size={140} blur={26} opacity={0.6} style={{ top: -30, right: -30 }}/>
          <div className="uppercase-eyebrow" style={{ position: "relative", marginBottom: 6, color: "var(--signal-doctor)" }}>✦ Sunday review</div>
          <div className="serif" style={{ position: "relative", fontSize: 18, lineHeight: 1.2, textAlign: "left" }}>
            Read Zoe's letter for the week<br/>
            <span className="serif-i" style={{ color: "var(--ink-soft)" }}>three minutes, no notes needed.</span>
          </div>
          <div style={{ position: "relative", marginTop: 12, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
            Open review <IconArrow size={12}/>
          </div>
        </Card>
      </button>
    </div>
  );
}

function MissionsScreen({ openReview }) {
  const [tab, setTab] = useStateM("today");
  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110 }}>
      <Noise opacity={0.04}/>
      <div style={{ padding: "64px 24px 8px" }}>
        <div className="uppercase-eyebrow">Missions</div>
        <h2 style={{ marginTop: 8, fontSize: 32, lineHeight: 1.05 }}>
          A daily and weekly<br/><span className="serif-i">rhythm.</span>
        </h2>
      </div>
      <div style={{ padding: "20px 24px 6px" }}>
        <div style={{ display: "flex", background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: 999, padding: 4 }}>
          {[["today","Today"],["week","This week"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              flex: 1, padding: "10px 12px",
              borderRadius: 999,
              background: tab === k ? "var(--ink)" : "transparent",
              color: tab === k ? "#FBF9F5" : "var(--ink-soft)",
              fontWeight: 500, fontSize: 13, fontFamily: "var(--font-sans)",
              transition: "all 200ms",
            }}>{l}</button>
          ))}
        </div>
      </div>
      {tab === "today" ? <MissionsToday/> : <MissionsWeek openReview={openReview}/>}
    </div>
  );
}

Object.assign(window, { MissionsScreen });
