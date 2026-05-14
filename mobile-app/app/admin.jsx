// Admin / Doctor view — separate desktop layout. Advance test status, edit values, approve report.

const { useState: useStateA } = React;

function AdminScreen({ adminState, setAdminState, goApp }) {
  const u = window.NoreonData.user;
  const statuses = window.NoreonData.testStatuses;
  const [tab, setTab] = useStateA("users");
  const [selectedUser, setSelectedUser] = useStateA(0);

  return (
    <div className="admin-page">
      <Noise opacity={0.025}/>
      <header style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--bg-cream)", borderBottom: "1px solid var(--hairline)",
        padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--ink)", color: "#FBF9F5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontFamily: "var(--font-serif)", fontStyle: "italic" }}>N</div>
            <span style={{ fontFamily: "var(--font-serif)", fontSize: 18, letterSpacing: "-0.01em" }}>Noreon · <span className="serif-i">Clinical console</span></span>
          </div>
          <span style={{ fontSize: 11, padding: "3px 10px", border: "1px solid var(--signal-doctor)", color: "var(--signal-doctor)", borderRadius: 999, letterSpacing: "0.12em", textTransform: "uppercase" }}>Internal</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>Dr. Inês Almeida</span>
          <button onClick={goApp} style={{ fontSize: 12, color: "var(--ink-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}>Switch to user app →</button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "calc(100vh - 65px)" }}>
        {/* Sidebar — users list */}
        <aside style={{ borderRight: "1px solid var(--hairline)", padding: "24px 16px" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 12, paddingLeft: 8 }}>Users</div>
          {[
            { name: u.name, completeness: 100, status: adminState.statusId || "—", id: 0 },
            { name: "Jonas Petri",   completeness: 64,  status: "—",         id: 1 },
            { name: "Aisha Bremer",  completeness: 92,  status: "scheduled", id: 2 },
            { name: "Luca Marini",   completeness: 78,  status: "processing",id: 3 },
          ].map((p, i) => (
            <button key={p.id} onClick={() => setSelectedUser(i)} style={{
              width: "100%", textAlign: "left", padding: "12px 12px",
              borderRadius: 12,
              background: selectedUser === i ? "var(--surface-card)" : "transparent",
              border: selectedUser === i ? "1px solid var(--hairline)" : "1px solid transparent",
              marginBottom: 4, cursor: "pointer",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{p.name}</span>
                <span className="tabular" style={{ fontSize: 11, color: "var(--ink-muted)" }}>{p.completeness}%</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2, textTransform: "capitalize" }}>{p.status}</div>
            </button>
          ))}
        </aside>

        {/* Main */}
        <main style={{ padding: "28px 32px 48px", maxWidth: 920 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: "var(--ink-muted)" }}>Patient · {u.name.toLowerCase()}@noreon.health</div>
          <h2 style={{ fontSize: 36, lineHeight: 1.05 }}>{u.name} · <span className="serif-i">{u.age}</span></h2>

          <div style={{ marginTop: 24, display: "flex", gap: 4, borderBottom: "1px solid var(--hairline)" }}>
            {[
              ["users", "Overview"],
              ["status", "Advance test"],
              ["values", "Biomarker values"],
              ["report", "Report editor"],
            ].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                padding: "12px 14px", fontSize: 13, fontWeight: 500,
                color: tab === k ? "var(--ink)" : "var(--ink-muted)",
                borderBottom: tab === k ? "1px solid var(--ink)" : "1px solid transparent",
                marginBottom: -1,
              }}>{l}</button>
            ))}
          </div>

          {tab === "users" && <AdminOverview adminState={adminState}/>}
          {tab === "status" && <AdminStatus adminState={adminState} setAdminState={setAdminState}/>}
          {tab === "values" && <AdminValues adminState={adminState} setAdminState={setAdminState}/>}
          {tab === "report" && <AdminReport adminState={adminState} setAdminState={setAdminState}/>}
        </main>
      </div>
    </div>
  );
}

function AdminOverview({ adminState }) {
  const u = window.NoreonData.user;
  const cards = [
    { eyebrow: "Onboarding", value: "Complete", sub: "10 sections · 0 skipped" },
    { eyebrow: "Test status", value: adminState.statusId ? adminState.statusId : "Not booked", sub: adminState.statusId === "ready" ? "Released to user" : "Pending" },
    { eyebrow: "Report",     value: adminState.reportApproved ? "Approved" : "Draft", sub: adminState.reportApproved ? "Visible to user" : "Hidden from user" },
    { eyebrow: "Age · Sex",   value: `${u.age} · ${u.sex}`, sub: `${u.height}cm · ${u.weight}kg · ${u.city}` },
  ];
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {cards.map((c, i) => (
          <Card key={i} style={{ padding: "16px 18px" }}>
            <div className="uppercase-eyebrow" style={{ marginBottom: 6 }}>{c.eyebrow}</div>
            <div className="serif" style={{ fontSize: 24, lineHeight: 1.1, textTransform: "capitalize" }}>{c.value}</div>
            <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 6 }}>{c.sub}</div>
          </Card>
        ))}
      </div>
      <Card style={{ marginTop: 16, padding: "18px 20px" }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 8 }}>Goals</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {u.goals.map(g => <Chip key={g} size="sm" style={{ cursor: "default" }}>{g}</Chip>)}
        </div>
        <div className="uppercase-eyebrow" style={{ marginTop: 18, marginBottom: 6 }}>Family history</div>
        <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>{u.family.join(" · ")}</div>
      </Card>
    </div>
  );
}

function AdminStatus({ adminState, setAdminState }) {
  const statuses = window.NoreonData.testStatuses;
  const currentIdx = Math.max(-1, statuses.findIndex(s => s.id === adminState.statusId));
  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.55, marginBottom: 16, maxWidth: 540 }}>
        Advance this patient's test through the six stages. The user app reflects each change in real time. The report only appears on their side once you approve it in the Report editor.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        {statuses.map((s, i) => {
          const done = i <= currentIdx;
          return (
            <button key={s.id} onClick={() => setAdminState({ ...adminState, statusId: s.id })}
              style={{
                textAlign: "left", padding: "14px 16px",
                borderRadius: 14,
                border: i === currentIdx ? "1px solid var(--ink)" : "1px solid var(--hairline)",
                background: done ? "var(--surface-card)" : "transparent",
                opacity: done ? 1 : 0.7,
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Step {i+1}</span>
                {done && <IconCheck size={14} color="var(--signal-affirm)"/>}
              </div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}>{s.note}</div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button variant="secondary" onClick={() => setAdminState({ ...adminState, statusId: null })}>Reset</Button>
        <Button variant="primary" onClick={() => setAdminState({ ...adminState, statusId: statuses[Math.min(statuses.length - 1, currentIdx + 1)].id })}>
          Advance to next <IconArrow size={14}/>
        </Button>
      </div>
    </div>
  );
}

function AdminValues({ adminState, setAdminState }) {
  const r = window.NoreonData.report;
  const values = adminState.values || r.biomarkers;
  const update = (i, key, v) => {
    const next = values.map((b, j) => j === i ? { ...b, [key]: key === "value" ? parseFloat(v || 0) : v } : b);
    setAdminState({ ...adminState, values: next });
    window.NoreonData.report.biomarkers = next;
  };
  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", maxWidth: 540, lineHeight: 1.55, marginBottom: 16 }}>
        Enter laboratory values. Flags are not traffic lights — use <em>ok / watch / low / attention</em> only.
      </p>
      <Card padded={false} style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 0, padding: "12px 18px", background: "var(--surface-elevated)", borderBottom: "1px solid var(--hairline)" }}>
          {["Marker", "Value", "Unit", "Range", "Flag"].map(h => (
            <div key={h} className="uppercase-eyebrow" style={{ fontSize: 10 }}>{h}</div>
          ))}
        </div>
        {values.map((b, i) => (
          <div key={b.name} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 8, padding: "10px 18px", borderBottom: i === values.length - 1 ? "none" : "1px solid var(--hairline)", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "var(--ink)" }}>{b.name}</div>
            <input value={b.value} type="number" step="0.1" onChange={(e) => update(i, "value", e.target.value)} style={adminInput}/>
            <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{b.unit}</div>
            <div className="tabular" style={{ fontSize: 12, color: "var(--ink-muted)" }}>{b.low}–{b.high}</div>
            <select value={b.flag} onChange={(e) => update(i, "flag", e.target.value)} style={adminInput}>
              <option value="ok">ok</option>
              <option value="low">low</option>
              <option value="watch">watch</option>
              <option value="attention">attention</option>
            </select>
          </div>
        ))}
      </Card>
    </div>
  );
}

const adminInput = {
  width: "100%", border: "1px solid var(--hairline)", borderRadius: 8,
  padding: "6px 10px", fontFamily: "var(--font-sans)", fontSize: 13, background: "var(--surface-card)",
  outline: "none",
};

function AdminReport({ adminState, setAdminState }) {
  const r = window.NoreonData.report;
  const [draft, setDraft] = useStateA({
    headline: r.headline, executive: r.executive, plan: r.plan.join("\n"),
  });

  const approve = () => {
    window.NoreonData.report.headline = draft.headline;
    window.NoreonData.report.executive = draft.executive;
    window.NoreonData.report.plan = draft.plan.split("\n").filter(Boolean);
    setAdminState({ ...adminState, reportApproved: true });
  };

  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", maxWidth: 540, lineHeight: 1.55, marginBottom: 16 }}>
        Review and edit AI-drafted insights. The user-side report is hidden until you approve. Test status must be at <em>Report ready</em> before the user sees it.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card style={{ padding: "16px 18px" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 6 }}>Headline</div>
          <textarea value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
            rows={2} style={{ ...adminInput, padding: "8px 10px", fontSize: 15, fontFamily: "var(--font-serif)" }}/>

          <div className="uppercase-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Executive summary</div>
          <textarea value={draft.executive} onChange={(e) => setDraft({ ...draft, executive: e.target.value })}
            rows={5} style={{ ...adminInput, padding: "8px 10px", fontSize: 13, lineHeight: 1.5 }}/>

          <div className="uppercase-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Daily plan · one per line</div>
          <textarea value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
            rows={6} style={{ ...adminInput, padding: "8px 10px", fontSize: 13, lineHeight: 1.6 }}/>

          <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <Button variant="primary" onClick={approve}>{adminState.reportApproved ? "Re-approve" : "Approve & release"} <IconCheck size={14}/></Button>
            <span style={{ fontSize: 12, color: adminState.reportApproved ? "var(--signal-affirm)" : "var(--ink-muted)" }}>
              {adminState.reportApproved ? "Visible to user" : "Hidden from user"}
            </span>
          </div>
        </Card>

        <Card style={{ padding: "20px 22px", background: "linear-gradient(150deg, #14130F 0%, #1E1A14 100%)", color: "#FBF9F5", position: "relative", overflow: "hidden" }}>
          <Orb palette="amber" size={200} blur={45} opacity={0.45} style={{ top: -80, right: -50 }}/>
          <Noise opacity={0.07}/>
          <div className="uppercase-eyebrow" style={{ color: "var(--signal-doctor)", position: "relative" }}>Preview</div>
          <h3 className="serif" style={{ marginTop: 12, color: "#FBF9F5", lineHeight: 1.15, fontSize: 24, position: "relative" }}>{draft.headline}</h3>
          <p style={{ marginTop: 12, fontSize: 13.5, color: "rgba(251,249,245,0.78)", lineHeight: 1.55, position: "relative" }}>{draft.executive.slice(0, 200)}{draft.executive.length > 200 ? "…" : ""}</p>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { AdminScreen });
