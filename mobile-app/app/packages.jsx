// Packages — Browse the lab panels, compare, pick one.

const { useState: useStatePk } = React;

function PackagesScreen({ onBack, onPick }) {
  const packages = window.NoreonData.labPackages;
  const [sort, setSort] = useStatePk("recommended"); // "recommended" | "depth" | "price"
  const sorted = [...packages].sort((a, b) => {
    if (sort === "recommended") return (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0);
    if (sort === "depth") return b.biomarkerCount - a.biomarkerCount;
    if (sort === "price") return a.price - b.price;
    return 0;
  });

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110, position: "relative" }}>
      <Orb palette="coral" size={320} blur={70} opacity={0.5} style={{ top: -160, right: -100 }}/>
      <Orb palette="lilac" size={240} blur={70} opacity={0.4} style={{ top: 220, left: -120 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 24px 6px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Lab panels</div>
      </div>

      <div style={{ position: "relative", padding: "12px 24px 8px" }}>
        <h2 style={{ fontSize: 30, lineHeight: 1.05 }}>
          Read your body<br/>
          <span className="serif-i">at the depth you need.</span>
        </h2>
        <p style={{ marginTop: 12, fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.55, maxWidth: 320 }}>
          Seven panels, each designed for a different question. A clinician reviews every result.
        </p>

        <div style={{ marginTop: 14 }}>
          <AskZoePill context={{ type: "package" }} label="Ask Zoe which fits"/>
        </div>
      </div>

      {/* Sort */}
      <div style={{ position: "relative", padding: "20px 24px 6px" }}>
        <div style={{ display: "flex", background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: 999, padding: 4 }}>
          {[["recommended","Recommended"],["depth","By depth"],["price","By price"]].map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} style={{
              flex: 1, padding: "8px 4px",
              borderRadius: 999,
              background: sort === k ? "var(--ink)" : "transparent",
              color: sort === k ? "#FBF9F5" : "var(--ink-soft)",
              fontWeight: 500, fontSize: 12, fontFamily: "var(--font-sans)",
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div style={{ position: "relative", padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        {sorted.map(p => <PackageCard key={p.id} p={p} onPick={onPick}/>)}
      </div>

      <div style={{ position: "relative", padding: "0 24px 24px" }}>
        <Card style={{ padding: "14px 16px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
          <p style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.55 }}>
            All panels are collected at home by a trained phlebotomist, analysed in our partner laboratory, and reviewed by a clinician before insights are released.
          </p>
        </Card>
      </div>
    </div>
  );
}

function PackageCard({ p, onPick }) {
  return (
    <Card padded={false} style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -40, right: -40, opacity: 0.85 }}>
        <Orb palette={p.orb} size={170} blur={30}/>
      </div>
      <div style={{ position: "relative", padding: "18px 18px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="uppercase-eyebrow">{p.sub}</div>
          {p.recommended && (
            <span style={{ fontSize: 10, padding: "2px 8px", color: "var(--signal-doctor)", border: "1px solid var(--signal-doctor)", borderRadius: 999, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500 }}>
              ✦ Most chosen
            </span>
          )}
        </div>
        <h3 className="serif" style={{ marginTop: 10, fontSize: 24, lineHeight: 1.1 }}>{p.name}</h3>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-muted)", fontStyle: "italic" }} className="serif-i">{p.designedFor}</p>
        <p style={{ marginTop: 10, fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.55 }}>{p.blurb}</p>
      </div>

      <div style={{ position: "relative", padding: "14px 18px 0", display: "flex", flexWrap: "wrap", gap: 5 }}>
        {p.categories.slice(0, 5).map(c => (
          <span key={c} style={{
            fontSize: 11, padding: "3px 10px",
            borderRadius: 999,
            background: "var(--surface-elevated)",
            border: "1px solid var(--hairline)",
            color: "var(--ink-muted)",
          }}>{c}</span>
        ))}
        {p.categories.length > 5 && (
          <span style={{ fontSize: 11, padding: "3px 8px", color: "var(--ink-faint)" }}>+{p.categories.length - 5} more</span>
        )}
      </div>

      <div style={{ position: "relative", padding: "16px 18px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <div>
          <div className="tabular" style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>{p.biomarkerCount} BIOMARKERS</div>
          <div className="tabular serif" style={{ fontSize: 26, fontStyle: "italic", lineHeight: 1, marginTop: 4 }}>€{p.price}</div>
        </div>
        <Button variant="primary" size="sm" onClick={() => onPick(p)}>
          Select <IconArrow size={12}/>
        </Button>
      </div>
    </Card>
  );
}

Object.assign(window, { PackagesScreen });
