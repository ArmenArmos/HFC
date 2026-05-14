// Food Photo flow — capture stub, shimmer "looking at your plate", Zoe feedback in 3 blocks.

const { useState: useStateF, useEffect: useEffectF } = React;

function FoodPhotoScreen({ onBack }) {
  const [phase, setPhase] = useStateF("intro"); // intro → loading → result
  const [items, setItems] = useStateF(["chicken thigh", "white rice", "side salad"]);

  const start = () => {
    setPhase("loading");
    setTimeout(() => setPhase("result"), 2200);
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", position: "relative", paddingBottom: 60 }}>
      <Noise opacity={0.04}/>
      <div style={{ padding: "60px 24px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Food photo</div>
      </div>

      {phase === "intro" && <FoodIntro onStart={start}/>}
      {phase === "loading" && <FoodLoading/>}
      {phase === "result" && <FoodResult items={items} setItems={setItems} onRedo={() => setPhase("intro")}/>}
    </div>
  );
}

function FoodIntro({ onStart }) {
  return (
    <div style={{ padding: "12px 24px" }}>
      <h2 style={{ fontSize: 32, lineHeight: 1.05 }}>
        Show Zoe<br/><span className="serif-i">your plate.</span>
      </h2>
      <p style={{ marginTop: 12, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.55 }}>
        One photo. Three lines of feedback: what's good in this meal, what to watch, and one thing for the next one.
      </p>

      <button onClick={onStart} style={{
        marginTop: 26, width: "100%", aspectRatio: "4/5",
        border: "1px dashed var(--hairline-strong)", borderRadius: 24,
        background: "var(--surface-elevated)", overflow: "hidden",
        position: "relative", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12,
      }}>
        <Orb palette="coral" size={260} blur={50} opacity={0.5} style={{ top: -40, right: -60 }}/>
        <Orb palette="blush" size={220} blur={50} opacity={0.5} style={{ bottom: -50, left: -50 }}/>
        <div style={{
          position: "relative", zIndex: 2,
          width: 78, height: 78, borderRadius: "50%",
          background: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 8px 24px rgba(26,26,26,0.18)",
        }}>
          <IconCamera size={32} color="#FBF9F5" strokeWidth={1.4}/>
        </div>
        <div className="serif-i" style={{ position: "relative", fontSize: 17, color: "var(--ink-soft)" }}>
          Tap to capture
        </div>
      </button>

      <Card style={{ marginTop: 20, padding: "14px 16px" }}>
        <p style={{ fontSize: 12.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>
          This feedback is not medical advice. Trends matter more than single meals.
        </p>
      </Card>
    </div>
  );
}

function FoodLoading() {
  return (
    <div style={{ padding: "12px 24px" }}>
      <div style={{ width: "100%", aspectRatio: "4/5", borderRadius: 24, overflow: "hidden", position: "relative" }}>
        <div className="shimmer" style={{ position: "absolute", inset: 0 }}/>
        <Orb palette="coral" size={220} blur={48} breathe style={{ top: "32%", left: "30%" }}/>
        <Noise opacity={0.1}/>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="serif-i fade-up" style={{ background: "rgba(255,255,255,0.85)", padding: "12px 18px", borderRadius: 999, fontSize: 15, color: "var(--ink)" }}>
            Looking at your plate…
          </div>
        </div>
      </div>
    </div>
  );
}

function FoodResult({ items, setItems, onRedo }) {
  return (
    <div style={{ padding: "12px 24px" }}>
      <div style={{ width: "100%", aspectRatio: "4/3", borderRadius: 24, overflow: "hidden", position: "relative", background: "#1A1A1A" }}>
        {/* fake "photo" — gradient layered like a meal in low light */}
        <div style={{ position: "absolute", inset: 0,
          background: "radial-gradient(circle at 30% 40%, #D9924A 0%, transparent 40%), radial-gradient(circle at 70% 70%, #C8D5B9 0%, transparent 35%), radial-gradient(circle at 60% 30%, #F5E3C8 0%, transparent 40%), #3B2A1F" }}/>
        <Noise opacity={0.15}/>
        <div style={{ position: "absolute", left: 12, top: 12, padding: "5px 10px", background: "rgba(0,0,0,0.5)", color: "#FBF9F5", fontSize: 11, fontWeight: 500, borderRadius: 999, letterSpacing: "0.08em", textTransform: "uppercase" }}>Tue · 13:24</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 8 }}>Looks like</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((it, i) => (
            <Chip key={i} size="sm" selected style={{ cursor: "default" }}>
              {it} <IconClose size={11} color="rgba(251,249,245,0.7)" style={{ marginLeft: 6 }}/>
            </Chip>
          ))}
          <Chip size="sm"><IconPlus size={11} style={{ marginRight: 4 }}/> Add</Chip>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <ZoeBlock
          tone="affirm"
          eyebrow="Good in this meal"
          text="Lean protein and fibre from the salad. A solid foundation for your afternoon."
        />
        <ZoeBlock
          tone="watch"
          eyebrow="Watch area"
          text="The rice volume leans large for your glucose pattern this week."
        />
        <ZoeBlock
          tone="next"
          eyebrow="For your next meal"
          text="Halve the rice, add a fistful of leafy greens, and take a twelve-minute walk afterwards."
        />
      </div>

      <Card style={{ marginTop: 16, padding: "14px 16px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
        <p style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5 }}>
          This feedback is not medical advice. Trends matter more than single meals.
        </p>
      </Card>

      <Button variant="secondary" size="md" fullWidth style={{ marginTop: 18 }} onClick={onRedo}>Photograph another</Button>
    </div>
  );
}

function ZoeBlock({ tone, eyebrow, text }) {
  const color = tone === "affirm" ? "var(--signal-affirm)" : tone === "watch" ? "var(--signal-watch)" : "var(--ink-soft)";
  return (
    <Card style={{ padding: "14px 16px", borderLeft: `2px solid ${color}` }}>
      <div className="uppercase-eyebrow" style={{ color, marginBottom: 6 }}>{eyebrow}</div>
      <p className="serif-i" style={{ fontSize: 15, color: "var(--ink-soft)", lineHeight: 1.5 }}>{text}</p>
    </Card>
  );
}

Object.assign(window, { FoodPhotoScreen });
