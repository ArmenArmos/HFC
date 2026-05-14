// Doctor-reviewed report screen — restructured: summary tile, category-grouped biomarkers,
// change-vs-previous, contextual AskZoe wrappers, 30/60/90 recommendations.

const { useState: useStateR, useContext: useContextR } = React;

function BiomarkerChart({ b }) {
  const W = 100, H = 28;
  const min = Math.min(b.low, b.value, b.previous ?? b.value) * 0.8;
  const max = Math.max(b.high * 1.2, b.value * 1.15, (b.previous ?? b.value) * 1.1);
  const span = max - min || 1;
  const x = (v) => ((v - min) / span) * W;
  const lowX = Math.max(0, x(b.low));
  const highX = Math.min(W, x(b.high));
  const valX = Math.max(2, Math.min(W - 2, x(b.value)));
  const prevX = b.previous != null ? Math.max(2, Math.min(W - 2, x(b.previous))) : null;

  const dotColor =
    b.flag === "watch" ? "var(--signal-watch)" :
    b.flag === "attention" ? "var(--signal-attention)" :
    b.flag === "low" ? "var(--signal-doctor)" :
    "var(--signal-affirm)";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <rect x={lowX} y={H/2 - 2} width={highX - lowX} height={4} rx={2} fill="var(--hairline-strong)"/>
      <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="var(--hairline)" strokeWidth="1"/>
      {prevX != null && (
        <>
          <line x1={prevX} y1={H/2} x2={valX} y2={H/2} stroke="var(--ink-faint)" strokeWidth="0.8" strokeDasharray="2 2"/>
          <circle cx={prevX} cy={H/2} r={2.5} fill="var(--ink-faint)" opacity="0.6"/>
        </>
      )}
      <circle cx={valX} cy={H/2} r={4} fill={dotColor}/>
      <circle cx={valX} cy={H/2} r={2} fill="#FBF9F5"/>
    </svg>
  );
}

function ReportScreen({ onBack }) {
  const { openZoe } = useContextR(ZoeCtx);
  const r = window.NoreonData.report;
  const [recsTab, setRecsTab] = useStateR("30");

  // Summary counts
  const counts = { ok: 0, watch: 0, low: 0, attention: 0 };
  r.biomarkers.forEach(b => { counts[b.flag] = (counts[b.flag] || 0) + 1; });

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 160, position: "relative" }}>
      <Noise opacity={0.04}/>

      {/* ── Hero banner ── */}
      <div style={{
        position: "relative",
        background: "linear-gradient(150deg, #14130F 0%, #1E1A14 70%, #2A2218 100%)",
        color: "#FBF9F5",
        padding: "60px 28px 40px",
        overflow: "hidden",
      }}>
        <Orb palette="amber" size={360} blur={70} opacity={0.4} style={{ top: -180, right: -120 }}/>
        <Noise opacity={0.07}/>

        <button onClick={onBack} style={{ padding: 6, color: "#FBF9F5", position: "relative" }}><IconBack size={20} color="#FBF9F5"/></button>

        <div style={{
          marginTop: 20, padding: "6px 12px",
          display: "inline-flex", alignItems: "center", gap: 8,
          border: "1px solid rgba(184,146,79,0.55)",
          borderRadius: 999, position: "relative",
        }}>
          <span style={{ color: "var(--signal-doctor)", fontSize: 12 }}>✦</span>
          <span style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(251,249,245,0.85)", fontWeight: 500 }}>
            Doctor-reviewed
          </span>
        </div>

        <h2 className="serif" style={{
          marginTop: 22, fontSize: 32, lineHeight: 1.1, color: "#FBF9F5",
          maxWidth: 320, position: "relative",
        }}>
          Your metabolic rhythm<br/>
          <span className="serif-i" style={{ color: "rgba(251,249,245,0.85)" }}>is asking for a gentler week.</span>
        </h2>

        <div style={{ marginTop: 28, display: "flex", gap: 16, position: "relative", fontSize: 11.5, color: "rgba(251,249,245,0.65)", letterSpacing: "0.06em" }}>
          <span>{r.reviewedOn.toUpperCase()}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{r.reviewedBy.toUpperCase()}</span>
        </div>
      </div>

      {/* ── Summary tile ── */}
      <div style={{ padding: "20px 28px 0" }}>
        <Card style={{ padding: "18px 20px 18px" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 14 }}>At a glance</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <SummaryStat n={counts.ok || 0} label="Within range" color="var(--signal-affirm)"/>
            <SummaryStat n={counts.watch || 0} label="To watch" color="var(--signal-watch)"/>
            <SummaryStat n={(counts.low || 0) + (counts.attention || 0)} label="Below / attention" color="var(--signal-doctor)"/>
          </div>
        </Card>
      </div>

      {/* ── Executive summary ── */}
      <ReportSection eyebrow="Executive summary">
        <p className="serif" style={{ fontSize: 18, lineHeight: 1.55, color: "var(--ink)" }}>
          {r.executive}
        </p>
      </ReportSection>

      {/* ── What is strong ── */}
      <ReportSection eyebrow="What is strong" accent="affirm">
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {r.strong.map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 12, fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>
              <span style={{ color: "var(--signal-affirm)", fontSize: 11, marginTop: 6 }}>●</span>
              <span style={{ flex: 1 }}>{s}</span>
            </li>
          ))}
        </ul>
      </ReportSection>

      {/* ── What needs attention ── */}
      <ReportSection eyebrow="What needs attention" accent="watch">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {r.watch.map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: 64 }}>
                <div className="uppercase-eyebrow" style={{
                  fontSize: 9,
                  color: w.level === "watch" ? "var(--signal-watch)" :
                         w.level === "low" ? "var(--signal-doctor)" :
                         "var(--ink-muted)",
                  borderLeft: `2px solid ${
                    w.level === "watch" ? "var(--signal-watch)" :
                    w.level === "low" ? "var(--signal-doctor)" :
                    "var(--ink-muted)"
                  }`,
                  paddingLeft: 8, marginTop: 4,
                }}>{w.level}</div>
              </div>
              <div style={{ flex: 1, fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>{w.text}</div>
              <AskZoePill context={{ type: "highlow", name: w.text.split(" ")[0], direction: w.level === "low" ? "below" : "above" }}/>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5, marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
          We use the wording <span className="serif-i">low · watch · medium pattern · doctor follow-up</span>. Not "high risk".
        </p>
      </ReportSection>

      {/* ── Biomarker dashboard grouped by category ── */}
      <BiomarkerDashboard biomarkers={r.biomarkers}/>

      {/* ── Recommendations 30/60/90 ── */}
      <div style={{ padding: "28px 28px 0" }}>
        <div className="uppercase-eyebrow" style={{
          marginBottom: 14, color: "var(--ink-muted)",
          borderTop: "1px solid var(--hairline)", paddingTop: 28,
        }}>Personalised recommendations</div>

        <div style={{ display: "flex", background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: 999, padding: 4, marginBottom: 16 }}>
          {[["30","30 days"],["60","60 days"],["90","90 days"]].map(([k, l]) => (
            <button key={k} onClick={() => setRecsTab(k)} style={{
              flex: 1, padding: "8px 4px",
              borderRadius: 999,
              background: recsTab === k ? "var(--ink)" : "transparent",
              color: recsTab === k ? "#FBF9F5" : "var(--ink-soft)",
              fontWeight: 500, fontSize: 12.5, fontFamily: "var(--font-sans)",
            }}>{l}</button>
          ))}
        </div>

        <RecommendationsPane data={r.recommendations[recsTab]}/>
      </div>

      {/* ── Follow-up ── */}
      <ReportSection eyebrow="Follow-up">
        <p style={{ fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.55 }}>{r.followup}</p>
        <div style={{ marginTop: 14 }}>
          <Card style={{ padding: "12px 14px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <IconLab size={16} color="var(--signal-doctor)" style={{ marginTop: 2 }}/>
              <div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Suggested retest in six months.</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 2 }}>You'll receive a quiet reminder a fortnight before.</div>
              </div>
            </div>
          </Card>
        </div>
      </ReportSection>

      <div style={{ padding: "0 28px 40px" }}>
        <Card style={{ padding: "12px 16px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
          <p style={{ fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>
            This report has been reviewed by a licensed clinician but does not replace medical care. Persistent symptoms warrant an in-person visit.
          </p>
        </Card>
      </div>

      {/* Floating Walk-me-through CTA — compact, bottom-right pill */}
      <div style={{
        position: "sticky", bottom: 18,
        display: "flex", justifyContent: "flex-end",
        padding: "0 20px",
        marginTop: -40, pointerEvents: "none",
      }}>
        <button onClick={() => openZoe(null)} style={{
          pointerEvents: "auto",
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "8px 14px 8px 10px", borderRadius: 999,
          background: "var(--ink)", color: "#FBF9F5",
          boxShadow: "0 6px 18px rgba(26,26,26,0.28)",
          border: "1px solid #2A2622",
          fontSize: 12.5, fontFamily: "var(--font-sans)", fontWeight: 500,
          letterSpacing: "-0.005em",
        }}>
          <ZoeOrb size={18}/>
          <span>Walk me through this</span>
          <IconArrow size={12} color="#FBF9F5"/>
        </button>
      </div>
    </div>
  );
}

function SummaryStat({ n, label, color }) {
  return (
    <div style={{ textAlign: "center", padding: "6px 0" }}>
      <div className="tabular serif" style={{ fontSize: 30, lineHeight: 1, fontStyle: "italic", color: "var(--ink)" }}>{n}</div>
      <div style={{ marginTop: 8, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ color, fontSize: 10 }}>●</span> {label}
      </div>
    </div>
  );
}

function BiomarkerDashboard({ biomarkers }) {
  // Group by category, preserving original order of categories as they appear
  const order = [];
  const groups = {};
  biomarkers.forEach(b => {
    if (!groups[b.category]) { groups[b.category] = []; order.push(b.category); }
    groups[b.category].push(b);
  });

  return (
    <div style={{ padding: "28px 28px 0" }}>
      <div className="uppercase-eyebrow" style={{
        marginBottom: 14, color: "var(--ink-muted)",
        borderTop: "1px solid var(--hairline)", paddingTop: 28,
      }}>Biomarker dashboard</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {order.map(cat => (
          <Card key={cat} padded={false} style={{ overflow: "hidden", padding: "0" }}>
            <div style={{
              padding: "14px 18px",
              background: "var(--surface-elevated)",
              borderBottom: "1px solid var(--hairline)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span className="serif" style={{ fontSize: 15, color: "var(--ink)" }}>{cat}</span>
              <span className="tabular" style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {groups[cat].length} {groups[cat].length === 1 ? "marker" : "markers"}
              </span>
            </div>
            {groups[cat].map((b, i) => <BiomarkerRow key={b.name} b={b} first={i === 0}/>)}
          </Card>
        ))}
      </div>
    </div>
  );
}

function BiomarkerRow({ b, first }) {
  const delta = b.previous != null ? (b.value - b.previous) : null;
  const deltaSign = delta != null ? (delta > 0 ? "+" : "") : "";
  const deltaColor = delta == null ? null :
    // direction-aware: closer to range = good. We treat reduction toward upper limit as good when value > high.
    (b.flag === "ok" ? "var(--ink-faint)" : delta < 0 ? "var(--signal-affirm)" : "var(--signal-watch)");

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1.4fr 0.9fr 1fr",
      alignItems: "center", gap: 10,
      padding: "12px 18px",
      borderTop: first ? "none" : "1px solid var(--hairline)",
    }}>
      <div>
        <AskZoe context={{ type: "biomarker", name: b.name }} style={{ display: "inline" }}>
          <span style={{ fontSize: 13.5, color: "var(--ink)" }}>{b.name}</span>
        </AskZoe>
        <div className="tabular" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{b.low}–{b.high} {b.unit}</div>
      </div>
      <div style={{ width: "100%" }}><BiomarkerChart b={b}/></div>
      <div className="tabular" style={{ textAlign: "right" }}>
        <div>
          <span style={{
            fontFamily: "var(--font-serif)", fontStyle: "italic",
            fontSize: 20, color: "var(--ink)",
          }}>{b.value}</span>
          <span style={{ fontSize: 10.5, color: "var(--ink-muted)", marginLeft: 4 }}>{b.unit}</span>
        </div>
        {delta != null && (
          <div style={{ fontSize: 10, color: deltaColor, marginTop: 2, letterSpacing: "0.04em" }}>
            {deltaSign}{delta.toFixed(delta % 1 === 0 ? 0 : 1)} vs last
          </div>
        )}
      </div>
    </div>
  );
}

function RecommendationsPane({ data }) {
  return (
    <Card style={{ padding: "20px 20px 22px", position: "relative", overflow: "hidden" }}>
      <Orb palette="sage" size={140} blur={24} opacity={0.5} style={{ top: -30, right: -30 }}/>
      <div className="uppercase-eyebrow" style={{ position: "relative", marginBottom: 6 }}>{data.eyebrow}</div>
      <h3 className="serif" style={{ position: "relative", fontSize: 22, lineHeight: 1.15 }}>{data.title}</h3>
      <p className="serif-i" style={{ position: "relative", marginTop: 8, fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>{data.sub}</p>

      <ul style={{ marginTop: 18, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
        {data.items.map((it, i) => <RecItem key={i} it={it} num={i + 1}/>)}
      </ul>
    </Card>
  );
}

const REC_ICON_META = {
  Food:    { Icon: IconUtensils,   orb: "sage" },
  Walking: { Icon: IconFootprints, orb: "coral" },
  Sleep:   { Icon: IconMoon,       orb: "lilac" },
  Stress:  { Icon: IconWind,       orb: "blush" },
  Exercise:{ Icon: IconActivity,   orb: "amber" },
  Lab:     { Icon: IconLab,        orb: "twilight" },
  Doctor:  { Icon: IconSparkles,   orb: "storm" },
};

function RecItem({ it, num }) {
  const meta = REC_ICON_META[it.icon] || REC_ICON_META.Food;
  return (
    <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <span className="serif tabular" style={{
        fontStyle: "italic", fontSize: 22, color: "var(--ink-faint)",
        lineHeight: 1, paddingTop: 2, minWidth: 24,
      }}>0{num}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <meta.Icon size={13} color="var(--ink-muted)"/>
          <span className="uppercase-eyebrow" style={{ fontSize: 9 }}>{it.icon}</span>
        </div>
        <div style={{ fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>{it.text}</div>
        <div style={{ marginTop: 6 }}>
          <AskZoePill context={{ type: "recommendation", text: it.text }} label="Explain how"/>
        </div>
      </div>
    </li>
  );
}

function ReportSection({ eyebrow, accent, children }) {
  const accentColor =
    accent === "affirm" ? "var(--signal-affirm)" :
    accent === "watch"  ? "var(--signal-watch)" :
    null;
  return (
    <div style={{ padding: "28px 28px 4px" }}>
      <div className="uppercase-eyebrow" style={{
        marginBottom: 14, color: accentColor || "var(--ink-muted)",
        borderTop: "1px solid var(--hairline)", paddingTop: 28,
      }}>
        {accent && <span style={{ marginRight: 6 }}>●</span>}
        {eyebrow}
      </div>
      {children}
    </div>
  );
}

Object.assign(window, { ReportScreen });
