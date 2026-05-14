// Exercise — three plan tiles, weekly sessions list, session player with steps + finish state.

const { useState: useStateE, useEffect: useEffectE, useRef: useRefE } = React;

const PLANS = {
  beginner: {
    id: "beginner",
    name: "Beginner",
    orb: "sage",
    weekly: "2 strength + 4 walks",
    blurb: "Gentle entry. Bodyweight strength and a daily walking habit.",
    sessions: [
      { id: "b1", title: "10-minute mobility", type: "Mobility", duration: 10,
        steps: ["Neck rolls — 8 each side", "Shoulder circles — 8 each direction",
                "Hip circles — 6 each side", "Hamstring stretch — 30s per leg",
                "Cat-cow — 8 slow cycles", "Slow nasal breathing — 1 minute"] },
      { id: "b2", title: "Strength · foundation", type: "Strength", duration: 18,
        steps: ["Bodyweight squats — 2×8", "Wall push-ups — 2×8",
                "Glute bridges — 2×10", "Plank — 2×20s", "Slow walk-down — 2 minutes"] },
      { id: "b3", title: "Metabolic walk", type: "Walk", duration: 15,
        steps: ["Step out within 30 min of finishing lunch.",
                "Comfortable pace — you can still talk.",
                "Loop home; loosen shoulders on the return."] },
      { id: "b4", title: "Recovery evening", type: "Recovery", duration: 10,
        steps: ["Five minutes of slow breathing.",
                "Five minutes of stretching — hips, hamstrings, neck.",
                "Dim screens for the rest of the evening."] },
    ],
  },
  intermediate: {
    id: "intermediate",
    name: "Intermediate",
    orb: "coral",
    weekly: "3 strength + 2 cardio + walks",
    blurb: "Build steadily. Strength twice, zone-2 cardio twice, mobility on rest days.",
    sessions: [
      { id: "i1", title: "Lower-body strength", type: "Strength", duration: 30,
        steps: ["Goblet squats — 3×8", "Romanian deadlift — 3×8",
                "Walking lunges — 3×10 each side", "Side plank — 2×30s each side",
                "Slow cool-down walk — 5 minutes"] },
      { id: "i2", title: "Zone-2 cardio", type: "Cardio", duration: 25,
        steps: ["Five-minute easy warm-up.",
                "Twenty minutes at conversational pace — nasal breathing if you can.",
                "Three minutes of cool-down walking.",
                "Hydrate immediately afterwards."] },
      { id: "i3", title: "Push + pull strength", type: "Strength", duration: 30,
        steps: ["Push-ups (kneel if needed) — 3×8", "Inverted rows — 3×8",
                "Overhead press — 3×8", "Hollow hold — 2×20s",
                "Dead bug — 2×8 each side"] },
      { id: "i4", title: "Mobility recovery", type: "Mobility", duration: 15,
        steps: ["90/90 hip stretch — 1 minute per side",
                "Thoracic openers — 8 slow", "Couch stretch — 1 minute per side",
                "Slow breathing — 2 minutes"] },
    ],
  },
  lowEnergy: {
    id: "lowEnergy",
    name: "Low-energy",
    orb: "lilac",
    weekly: "Small recovery actions",
    blurb: "For tired weeks. Five-minute movements that count more than they feel.",
    sessions: [
      { id: "l1", title: "Five-minute walk", type: "Walk", duration: 5,
        steps: ["Step outside, even just to the gate.",
                "Three minutes there, two minutes back.",
                "Notice three things on the way."] },
      { id: "l2", title: "Slow breathing", type: "Recovery", duration: 6,
        steps: ["Four counts in, six counts out.",
                "Continue for six minutes.",
                "If the mind wanders, return to the count gently."] },
      { id: "l3", title: "Gentle stretching", type: "Mobility", duration: 8,
        steps: ["Cat-cow — 6 slow", "Child's pose — 60 seconds",
                "Standing forward fold — 30 seconds",
                "Shoulder rolls — 8 each direction"] },
      { id: "l4", title: "Earlier bedtime", type: "Recovery", duration: 0,
        steps: ["Aim to be in bed thirty minutes earlier than usual.",
                "Phone out of the bedroom.",
                "One soft light only after 22:00."] },
    ],
  },
};

const SESSION_TYPE_META = {
  Mobility:  { orb: "lilac" },
  Strength:  { orb: "amber" },
  Walk:      { orb: "coral" },
  Cardio:    { orb: "twilight" },
  Recovery:  { orb: "sage" },
};

function ExerciseScreen({ onBack }) {
  const [planId, setPlanId] = useStateE("beginner");
  const [openSession, setOpenSession] = useStateE(null);
  const plan = PLANS[planId];

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110, position: "relative" }}>
      <Orb palette={plan.orb} size={320} blur={70} opacity={0.5} style={{ top: -160, right: -100 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 24px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Exercise plan</div>
      </div>

      <div style={{ position: "relative", padding: "10px 24px 4px" }}>
        <h2 style={{ fontSize: 30 }}>Move on the<br/><span className="serif-i">days you have.</span></h2>
      </div>

      {/* Plan tiles */}
      <div style={{ position: "relative", padding: "18px 16px 4px" }}>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 8px 12px" }}>
          {Object.values(PLANS).map(p => {
            const active = p.id === planId;
            return (
              <button key={p.id} onClick={() => setPlanId(p.id)} style={{
                minWidth: 168, flexShrink: 0,
                textAlign: "left", padding: "14px 16px 16px",
                borderRadius: 18,
                position: "relative", overflow: "hidden",
                background: "var(--surface-card)",
                border: active ? "1px solid transparent" : "1px solid var(--hairline)",
                opacity: active ? 1 : 0.78,
                transition: "all 220ms",
                boxShadow: active ? "0 1px 2px rgba(26,26,26,0.05)" : undefined,
              }}>
                {active && (
                  <div style={{
                    position: "absolute", inset: 0,
                    borderRadius: 18,
                    padding: 1.5,
                    background: `linear-gradient(135deg, ${ORB_PALETTES[p.orb][1]} 0%, ${ORB_PALETTES[p.orb][2]} 100%)`,
                    WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                    pointerEvents: "none",
                  }}/>
                )}
                <OrbSwatch palette={p.orb} size={22}/>
                <div className="serif" style={{ marginTop: 10, fontSize: 18, lineHeight: 1.1 }}>{p.name}</div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>{p.weekly}</div>
              </button>
            );
          })}
        </div>
        <p style={{ padding: "0 8px", fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.5 }} className="serif-i">
          {plan.blurb}
        </p>
      </div>

      {/* Sessions list */}
      <div style={{ position: "relative", padding: "22px 24px 12px" }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 12 }}>This week</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {plan.sessions.map(s => {
            const meta = SESSION_TYPE_META[s.type] || { orb: "coral" };
            return (
              <button key={s.id} onClick={() => setOpenSession(s)} style={{
                textAlign: "left", width: "100%",
                padding: 0, background: "transparent",
              }}>
                <Card padded={false} style={{ padding: "16px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                  <OrbSwatch palette={meta.orb} size={32}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="uppercase-eyebrow" style={{ marginBottom: 4, fontSize: 10 }}>{s.type} · {s.duration > 0 ? `${s.duration} min` : "evening"}</div>
                    <div style={{ fontSize: 15, color: "var(--ink)" }}>{s.title}</div>
                  </div>
                  <IconChevron size={16} color="var(--ink-faint)"/>
                </Card>
              </button>
            );
          })}
        </div>
      </div>

      {/* Safety footer (always visible) */}
      <div style={{ position: "relative", padding: "8px 24px 24px" }}>
        <Card style={{ padding: "14px 16px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
          <p style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.55 }}>
            If you feel pain, dizziness, or chest discomfort, stop and consult a doctor.
          </p>
        </Card>
      </div>

      {openSession && <SessionPlayer session={openSession} onClose={() => setOpenSession(null)}/>}
    </div>
  );
}

function SessionPlayer({ session, onClose }) {
  const [stepIdx, setStepIdx] = useStateE(0);
  const [done, setDone] = useStateE(false);
  const total = session.steps.length;
  const meta = SESSION_TYPE_META[session.type] || { orb: "coral" };

  const next = () => {
    if (stepIdx < total - 1) setStepIdx(stepIdx + 1);
    else setDone(true);
  };

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 80,
      background: "var(--bg-cream)",
      display: "flex", flexDirection: "column",
    }}>
      <Orb palette={meta.orb} size={280} blur={70} opacity={0.4} style={{ top: -150, right: -80 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 24px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onClose} style={{ padding: 6 }}><IconClose size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">{session.type} · {session.duration > 0 ? `${session.duration} min` : "ritual"}</div>
        <div style={{ width: 32 }}/>
      </div>

      {!done && (
        <>
          <div style={{ position: "relative", padding: "12px 28px 0" }}>
            <h2 style={{ fontSize: 28, lineHeight: 1.1 }}>{session.title}</h2>
          </div>

          <div style={{ position: "relative", padding: "20px 28px 0" }}>
            <HairlineBar value={(stepIdx + 1) / total} color="var(--ink)" height={2}/>
            <div className="tabular" style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 6, letterSpacing: "0.06em" }}>
              STEP {stepIdx + 1} / {total}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 32px", position: "relative" }}>
            <div className="fade-up" key={stepIdx} style={{ textAlign: "center" }}>
              <Orb palette={meta.orb} size={120} blur={20} breathe opacity={0.7} style={{ top: -40, left: "calc(50% - 60px)" }}/>
              <div className="serif" style={{ position: "relative", fontSize: 26, lineHeight: 1.2, color: "var(--ink)" }}>
                {session.steps[stepIdx]}
              </div>
            </div>
          </div>

          <div style={{ position: "relative", padding: "16px 24px 16px" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {stepIdx > 0 && <Button variant="secondary" onClick={() => setStepIdx(stepIdx - 1)} style={{ flex: 1 }}>Back</Button>}
              <Button variant="primary" onClick={next} style={{ flex: 2 }}>
                {stepIdx === total - 1 ? "Finish" : "Next"} <IconArrow size={14}/>
              </Button>
            </div>
            <Card style={{ marginTop: 14, padding: "12px 14px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
              <p style={{ fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.55 }}>
                If you feel pain, dizziness, or chest discomfort, stop and consult a doctor.
              </p>
            </Card>
          </div>
        </>
      )}

      {done && (
        <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 28px" }}>
          <Orb palette={meta.orb} size={220} blur={50} breathe opacity={0.65} style={{ top: "32%", left: "calc(50% - 110px)" }}/>
          <div className="uppercase-eyebrow" style={{ textAlign: "center", position: "relative", color: "var(--signal-affirm)" }}>● Noticed</div>
          <h2 className="serif" style={{ marginTop: 14, fontSize: 32, textAlign: "center", position: "relative" }}>
            Done.<br/><span className="serif-i">No fanfare.</span>
          </h2>
          <p className="serif-i" style={{ marginTop: 14, textAlign: "center", fontSize: 16, color: "var(--ink-soft)", lineHeight: 1.55, position: "relative" }}>
            Small recovery actions count more than people think. Tomorrow follows.
          </p>
          <div style={{ position: "relative", marginTop: 36 }}>
            <Button variant="primary" size="lg" fullWidth onClick={onClose}>Close <IconCheck size={14}/></Button>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ExerciseScreen, PLANS });
