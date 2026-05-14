// Test tab — Browse packages → Booking (with location toggle) → Tracker (7 stages).

const { useState: useStateTst, useContext: useContextTst, useEffect: useEffectTst } = React;

function TestScreen({ testStatusId, onBook, onAdvance, onApprove, onResetTest, adminState, goTo, onBack }) {
  // Default view depends on test status
  const [view, setView] = useStateTst(testStatusId ? "tracker" : "browse");
  const [pickedPkg, setPickedPkg] = useStateTst(null);

  useEffectTst(() => {
    if (testStatusId && view === "browse") setView("tracker");
  }, [testStatusId]);

  if (view === "browse") {
    return <PackagesScreen
      onBack={onBack}
      onPick={(p) => { setPickedPkg(p); setView("booking"); }}
    />;
  }
  if (view === "booking") {
    return <BookingScreen
      pkg={pickedPkg || window.NoreonData.labPackages.find(p => p.id === "foundation")}
      onBack={() => setView("browse")}
      onConfirm={() => { onBook(); setView("tracker"); }}
    />;
  }
  return <TrackerScreen
    statusId={testStatusId || "selected"}
    reportApproved={adminState?.reportApproved}
    onBack={() => setView("browse")}
    onBrowse={() => setView("browse")}
    onAdvance={onAdvance}
    onApprove={onApprove}
    onResetTest={onResetTest}
    goTo={goTo}
  />;
}

// ── Booking ──────────────────────────────────────────────────
function BookingScreen({ pkg, onConfirm, onBack }) {
  const [slot, setSlot] = useStateTst("morning");
  const [day, setDay] = useStateTst(2);
  const [address, setAddress] = useStateTst("Rua das Flores 28, Lisbon");
  const [editAddr, setEditAddr] = useStateTst(false);
  const [location, setLocation] = useStateTst("home"); // "home" | "office" | "clinic"

  const today = new Date();
  const days = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    return d;
  });

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110 }}>
      <Noise opacity={0.04}/>
      <div style={{ padding: "60px 24px 6px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Book a draw</div>
      </div>

      {/* Selected package summary */}
      <div style={{ padding: "12px 24px 0" }}>
        <Card style={{ padding: "14px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -30 }}>
            <Orb palette={pkg.orb} size={120} blur={22} opacity={0.7}/>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <OrbSwatch palette={pkg.orb} size={32}/>
            <div style={{ flex: 1, position: "relative" }}>
              <div className="uppercase-eyebrow" style={{ marginBottom: 2 }}>Selected panel</div>
              <div style={{ fontSize: 15, color: "var(--ink)" }}>{pkg.name}</div>
              <div className="tabular" style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 2 }}>{pkg.biomarkerCount} biomarkers · €{pkg.price}</div>
            </div>
            <button onClick={onBack} style={{ fontSize: 12, color: "var(--ink-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}>Change</button>
          </div>
        </Card>
      </div>

      <div style={{ padding: "20px 24px 6px" }}>
        <h2 style={{ fontSize: 28, lineHeight: 1.05 }}>Choose a quiet<br/><span className="serif-i">morning.</span></h2>
        <p style={{ marginTop: 8, fontSize: 13.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>The whole visit is about twelve minutes — paperwork, a single draw, and a friendly handoff.</p>
      </div>

      {/* Location picker */}
      <div style={{ marginTop: 16, padding: "0 24px" }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 10 }}>Where</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            ["home",   "At home",   "Phlebotomist visits"],
            ["office", "At office", "Discreet desk-side draw"],
            ["clinic", "Clinic",    "Partner lab walk-in"],
          ].map(([k, l, sub]) => (
            <button key={k} onClick={() => setLocation(k)} style={{
              padding: "12px 10px", borderRadius: 14, textAlign: "left",
              border: location === k ? "1px solid var(--ink)" : "1px solid var(--hairline)",
              background: location === k ? "var(--ink)" : "var(--surface-card)",
              color: location === k ? "#FBF9F5" : "var(--ink)",
              transition: "all 200ms",
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 10.5, opacity: 0.72 }}>{sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Date strip */}
      <div style={{ marginTop: 18, padding: "0 24px" }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 10 }}>Next 14 days</div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, paddingRight: 24, marginRight: -24 }}>
          {days.map((d, i) => {
            const sel = i === day;
            return (
              <button key={i} onClick={() => setDay(i)} style={{
                minWidth: 56, padding: "10px 4px",
                borderRadius: 14,
                border: sel ? "1px solid var(--ink)" : "1px solid var(--hairline)",
                background: sel ? "var(--ink)" : "var(--surface-card)",
                color: sel ? "#FBF9F5" : "var(--ink)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                flexShrink: 0, transition: "all 200ms",
              }}>
                <span style={{ fontSize: 10, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {d.toLocaleDateString("en-GB", { weekday: "short" })}
                </span>
                <span className="tabular serif" style={{ fontSize: 22, lineHeight: 1, fontStyle: sel ? "italic" : "normal" }}>{d.getDate()}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{d.toLocaleDateString("en-GB", { month: "short" })}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slot toggle */}
      <div style={{ padding: "16px 24px 0" }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 10 }}>Time window</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[["morning", "Morning", "07:00 – 10:00"], ["evening", "Evening", "17:00 – 20:00"]].map(([k, l, sub]) => (
            <button key={k} onClick={() => setSlot(k)} style={{
              padding: "14px 16px", borderRadius: 16, textAlign: "left",
              border: slot === k ? "1px solid var(--ink)" : "1px solid var(--hairline)",
              background: slot === k ? "var(--ink)" : "var(--surface-card)",
              color: slot === k ? "#FBF9F5" : "var(--ink)",
              transition: "all 200ms",
            }}>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 2 }}>{l}</div>
              <div className="tabular" style={{ fontSize: 12, opacity: 0.7 }}>{sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Address */}
      {location !== "clinic" && (
        <div style={{ padding: "16px 24px 0" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 10 }}>Address</div>
          <Card style={{ padding: "14px 16px" }}>
            {editAddr ? (
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => setEditAddr(false)}
                autoFocus
                style={{
                  width: "100%", border: "none", outline: "none", background: "transparent",
                  fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--ink)",
                }}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 14, color: "var(--ink)", marginBottom: 2 }}>{address}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{location === "home" ? "Home" : "Office"} · pre-filled from your profile</div>
                </div>
                <button onClick={() => setEditAddr(true)} style={{ fontSize: 12, color: "var(--ink-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}>Edit</button>
              </div>
            )}
          </Card>
        </div>
      )}
      {location === "clinic" && (
        <div style={{ padding: "16px 24px 0" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 10 }}>Clinic location</div>
          <Card style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 14, color: "var(--ink)", marginBottom: 2 }}>Noreon Partner Clinic — Chiado</div>
                <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>Rua Garrett 32 · 8 min walk from Baixa-Chiado</div>
              </div>
              <button style={{ fontSize: 12, color: "var(--ink-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}>Change</button>
            </div>
          </Card>
        </div>
      )}

      {/* Preparation note */}
      <div style={{ padding: "16px 24px 0" }}>
        <div style={{ display: "flex", gap: 12, padding: "14px 16px", background: "var(--surface-elevated)", borderRadius: 14, border: "1px solid var(--hairline)" }}>
          <ZoeOrb size={26}/>
          <div style={{ flex: 1, fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.5 }} className="serif-i">
            Zoe will guide your preparation — fasting, hydration, and the small things — in the days before.
          </div>
        </div>
      </div>

      {/* Summary / CTA */}
      <div style={{ padding: "20px 24px 24px" }}>
        <Card style={{ padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Total</span>
            <span className="tabular serif" style={{ fontSize: 22, fontStyle: "italic" }}>€{pkg.price}</span>
          </div>
          <div className="uppercase-eyebrow" style={{ marginTop: 4, fontSize: 10 }}>Payment simulated in MVP</div>
        </Card>
        <Button variant="primary" size="lg" fullWidth onClick={onConfirm}>Confirm booking <IconCheck size={16}/></Button>
      </div>
    </div>
  );
}

// ── Tracker ──────────────────────────────────────────────────
function TrackerScreen({ statusId, reportApproved, onBrowse, onAdvance, onApprove, onResetTest, goTo }) {
  const { openZoe } = useContextTst(ZoeCtx);
  const statuses = window.NoreonData.testStatuses;
  const currentIdx = Math.max(0, statuses.findIndex(s => s.id === statusId));
  const resultsLive = currentIdx >= statuses.findIndex(s => s.id === "ready") && reportApproved;
  const aiLive      = currentIdx >= statuses.findIndex(s => s.id === "ai") && reportApproved;
  const atEnd       = currentIdx >= statuses.length - 1 && reportApproved;
  const [autoplay, setAutoplay] = useStateTst(false);

  // Autoplay loop — advance every 1.6s until reaching the final stage
  useEffectTst(() => {
    if (!autoplay) return;
    if (atEnd) { setAutoplay(false); return; }
    const t = setTimeout(() => onAdvance(), 1600);
    return () => clearTimeout(t);
  }, [autoplay, currentIdx, atEnd]);

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110, position: "relative" }}>
      <Orb palette="amber" size={300} blur={70} opacity={0.45} style={{ top: -150, right: -100 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 24px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="uppercase-eyebrow">Your test</div>
        <button onClick={onBrowse} style={{ fontSize: 12, color: "var(--ink-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}>Browse panels</button>
      </div>

      <div style={{ position: "relative", padding: "8px 24px 12px" }}>
        <h2 style={{ fontSize: 28, lineHeight: 1.05 }}>
          Advanced Biomarker Panel<br/>
          <span className="serif-i">{currentIdx >= 5 ? "is ready." : "in progress."}</span>
        </h2>
      </div>

      <div style={{ position: "relative", padding: "12px 24px 4px" }}>
        {(statusId === "scheduled") && <TestPreparationCard/>}

        {/* Results CTA (sticky top of timeline if results live) */}
        {resultsLive && (
          <Card style={{ marginBottom: 14, padding: "18px 20px", background: "linear-gradient(135deg, #14130F 0%, #2A2218 100%)", color: "#FBF9F5", position: "relative", overflow: "hidden" }}>
            <Orb palette="amber" size={140} blur={26} opacity={0.5} style={{ top: -30, right: -30 }}/>
            <Noise opacity={0.06}/>
            <div className="uppercase-eyebrow" style={{ position: "relative", color: "var(--signal-doctor)" }}>✦ Doctor-reviewed</div>
            <div className="serif" style={{ marginTop: 8, fontSize: 22, lineHeight: 1.15, position: "relative" }}>
              Your report is ready.
            </div>
            <p style={{ marginTop: 8, fontSize: 13, color: "rgba(251,249,245,0.78)", lineHeight: 1.5, position: "relative" }}>
              {aiLive ? "Zoe has read every line. Open the report and tap any biomarker — she will explain." : "Open the report. Zoe is preparing her interpretation."}
            </p>
            <div style={{ position: "relative", marginTop: 14, display: "flex", gap: 8 }}>
              <Button variant="cream" size="sm" onClick={() => goTo("report")} style={{ background: "#FBF9F5", color: "#1A1A1A" }}>
                Open report <IconArrow size={12}/>
              </Button>
              {aiLive && <Button variant="ghost" size="sm" onClick={() => openZoe(null)} style={{ color: "rgba(251,249,245,0.85)" }}>Walk me through</Button>}
            </div>
          </Card>
        )}

        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: 17, top: 8, bottom: 8, width: 1, background: "var(--hairline)" }}/>
          {statuses.map((s, i) => {
            const done = i < currentIdx;
            const current = i === currentIdx;
            const pending = i > currentIdx;
            return (
              <div key={s.id} style={{ display: "flex", gap: 16, marginBottom: 12, position: "relative" }}>
                <div style={{ flexShrink: 0, width: 36, display: "flex", justifyContent: "center", paddingTop: 8 }}>
                  {current ? (
                    <div style={{ position: "relative", width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Orb palette="coral" size={36} blur={4} breathe style={{ position: "absolute", inset: 0 }}/>
                      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--ink)", position: "relative", zIndex: 2 }}/>
                    </div>
                  ) : (
                    <div style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 4,
                      background: done ? "var(--ink)" : "transparent",
                      border: done ? "none" : "1px solid var(--hairline-strong)",
                    }}/>
                  )}
                </div>
                <Card style={{
                  padding: "12px 16px", flex: 1,
                  opacity: pending ? 0.55 : 1,
                  borderColor: current ? "transparent" : "var(--hairline)",
                  boxShadow: current ? "0 1px 2px rgba(26,26,26,0.05), 0 0 0 1px rgba(232,150,80,0.3)" : undefined,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 14.5, color: "var(--ink)", fontWeight: 500 }}>{s.title}</span>
                    <span className="tabular" style={{ fontSize: 11, color: "var(--ink-muted)" }}>{s.when}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>{s.note}</div>
                  {current && s.voice && (
                    <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <ZoeOrb size={20}/>
                      <div className="serif-i" style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.5, flex: 1 }}>{s.voice}</div>
                    </div>
                  )}
                </Card>
              </div>
            );
          })}
        </div>

        {/* Demo controls — internal MVP affordance to walk the journey */}
        <DemoTrackerControls
          atEnd={atEnd}
          autoplay={autoplay}
          onAdvance={onAdvance}
          onAutoplay={() => setAutoplay(true)}
          onReset={onResetTest}
        />
      </div>
    </div>
  );
}

function DemoTrackerControls({ atEnd, autoplay, onAdvance, onAutoplay, onReset }) {
  return (
    <div style={{ marginTop: 18, padding: "14px 16px", background: "transparent", border: "1px dashed var(--hairline-strong)", borderRadius: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="uppercase-eyebrow" style={{ fontSize: 10, color: "var(--signal-doctor)" }}>✦ Demo controls</div>
        <span style={{ fontSize: 10.5, color: "var(--ink-faint)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Internal MVP</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5, marginBottom: 12 }}>
        Walk the lab journey without leaving the user app. Each step is real on the user side; the doctor review and AI interpretation are simulated.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {!atEnd && (
          <>
            <Button variant="primary" size="sm" onClick={onAdvance} disabled={autoplay} style={{ flex: 1 }}>
              {autoplay ? "Playing…" : "Advance stage"} <IconArrow size={12}/>
            </Button>
            <Button variant="secondary" size="sm" onClick={onAutoplay} disabled={autoplay} style={{ flex: 1 }}>
              Auto-play
            </Button>
          </>
        )}
        {atEnd && (
          <Button variant="secondary" size="sm" onClick={onReset} style={{ flex: 1 }}>
            Reset journey
          </Button>
        )}
      </div>
    </div>
  );
}

function TestPreparationCard() {
  const items = [
    ["Fast 10 hours before the draw", "Water is encouraged. No coffee, no breakfast."],
    ["Hydrate well the day before", "Two extra glasses of water in the evening."],
    ["Sleep your normal hours", "Don't try to be heroic — be ordinary."],
    ["Take medications as usual", "Unless your doctor has said otherwise."],
  ];
  return (
    <Card style={{ padding: "18px 20px", position: "relative", overflow: "hidden", marginBottom: 14 }}>
      <div style={{ position: "absolute", top: -20, right: -30 }}>
        <Orb palette="amber" size={120} blur={22} opacity={0.6}/>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, position: "relative" }}>
        <ZoeOrb size={26} palette="amber"/>
        <div className="uppercase-eyebrow" style={{ color: "var(--signal-doctor)" }}>✦ Preparation</div>
      </div>
      <h4 className="serif" style={{ position: "relative", marginBottom: 12, fontSize: 19 }}>
        The night before, <span className="serif-i">quietly.</span>
      </h4>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
        {items.map(([k, v], i) => (
          <li key={i} style={{ display: "flex", gap: 12 }}>
            <IconCheck size={16} color="var(--signal-affirm)" style={{ marginTop: 3, flexShrink: 0 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: "var(--ink)" }}>{k}</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2, lineHeight: 1.5 }}>{v}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

Object.assign(window, { TestScreen, TestPreparationCard });
