// Today — Zoe chat-first home, missions strip, rhythm row, food photo button, biomarker CTA.

const { useState: useStateT, useRef: useRefT, useEffect: useEffectT } = React;

const ZOE_PRESETS = {
  "How should I eat today?":
    "Today leans gentle — you slept well and your last two meals were balanced. Lead with protein at lunch (around 30g), keep the plate colourful, and finish three hours before bed. If you crave something sweet around four, eat it with a handful of almonds first.",
  "I slept badly":
    "Noticed. That happens. Today is allowed to be quieter. Move your coffee to after breakfast so it doesn't ride an empty system, walk for ten gentle minutes after lunch instead of training, and try a 22:30 wind-down. Tomorrow tends to follow.",
  "What's my walking goal?":
    "Your daily target is seven and a half thousand steps, with a twelve-minute walk after your largest meal. Don't chase a single big number — three small walks count more than one heroic one. We will adjust this once your biomarker results return.",
  "Why does my report matter?":
    "It is the moment your body stops being a guess. A doctor reads your foundation panel and we translate the findings into one or two small actions — not a lecture. Until then, your starter rhythm is doing real work.",
};

function defaultZoeReply(q) {
  return `Sitting with that for a moment. I'll always answer in five steps — acknowledge what you said, place it against your goals (${(window.NoreonData.user.goals || []).slice(0,2).join(" and ")}), explain why it matters, give you one small next action, and leave you with a quiet bit of encouragement. Ask me about food, sleep, walking, your test, or anything in between.`;
}

function GreetingHeader({ name }) {
  const hour = new Date().getHours();
  const tod = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "70px 24px 16px" }}>
      <ZoeOrb size={42}/>
      <div style={{ flex: 1 }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 2 }}>
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <h4 className="serif" style={{ fontSize: 22 }}>
          Good {tod}, {name}.<br/>
          <span className="serif-i" style={{ color: "var(--ink-soft)" }}>Today is gentle.</span>
        </h4>
      </div>
    </div>
  );
}

function DailyFocusCard() {
  return (
    <div style={{ padding: "8px 24px 4px" }}>
      <Card style={{ padding: "18px 20px 20px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -20, right: -30, opacity: 0.85 }}>
          <Orb palette="coral" size={130} blur={22}/>
        </div>
        <div className="uppercase-eyebrow" style={{ marginBottom: 6 }}>One mission today</div>
        <div className="serif" style={{ fontSize: 22, lineHeight: 1.15, position: "relative" }}>
          A twelve-minute walk<br/>
          <span className="serif-i" style={{ color: "var(--ink-soft)" }}>after lunch.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14, position: "relative" }}>
          <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Everything else is bonus.</span>
          <button style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
            Open <IconChevron size={14}/>
          </button>
        </div>
      </Card>
    </div>
  );
}

function ZoeChatPanel() {
  const { openZoe } = React.useContext(ZoeCtx);
  return (
    <div style={{ padding: "16px 24px 4px" }}>
      <Card style={{ padding: "16px 16px 14px", position: "relative", overflow: "hidden" }}>
        <Orb palette="coral" size={120} blur={24} opacity={0.4} style={{ top: -30, right: -30 }}/>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, position: "relative" }}>
          <ZoeOrb size={22}/>
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }} className="serif-i">Zoe is here.</span>
        </div>

        <button onClick={() => openZoe(null)} style={{
          width: "100%", textAlign: "left",
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", background: "var(--surface-elevated)",
          border: "1px solid var(--hairline)", borderRadius: 14,
          position: "relative",
        }}>
          <span style={{ flex: 1, fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--ink-faint)" }}>
            Ask Zoe anything about today.
          </span>
          <IconArrow size={18} color="var(--ink-faint)"/>
        </button>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, position: "relative" }}>
          {window.NoreonData.zoeSuggestedQuestions.slice(0, 3).map(q => (
            <Chip key={q} size="sm" onClick={() => openZoe({ type: "term", word: q })}>{q}</Chip>
          ))}
        </div>
      </Card>
    </div>
  );
}

function DailyMissionsStrip({ goTo }) {
  const missions = window.NoreonData.todayMissions;
  return (
    <div style={{ padding: "20px 0 4px 24px", marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginRight: 24, marginBottom: 10 }}>
        <div className="uppercase-eyebrow">Today's missions</div>
        <button onClick={() => goTo("missions")} style={{ fontSize: 12, color: "var(--ink-muted)" }}>See all</button>
      </div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 10, paddingRight: 24 }}>
        {missions.map(m => (
          <div key={m.id} style={{
            minWidth: 156, flexShrink: 0,
            background: "var(--surface-card)", border: "1px solid var(--hairline)",
            borderRadius: 14, padding: "14px 14px 12px",
          }}>
            <OrbSwatch palette={m.orb} size={22}/>
            <div style={{ marginTop: 12 }}>
              <div className="uppercase-eyebrow" style={{ marginBottom: 4, fontSize: 10 }}>{m.type}</div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.4 }}>{m.text}</div>
            </div>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{
                fontSize: 11, color: m.done ? "var(--signal-affirm)" : "var(--ink-faint)",
                fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em",
              }}>{m.done ? "Noticed" : "Open"}</span>
              {m.done ? <IconCheck size={14} color="var(--signal-affirm)"/> : <IconChevron size={14} color="var(--ink-faint)"/>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RhythmRow({ goTo }) {
  const tiles = window.NoreonData.rhythmTiles;
  const handle = (id) => {
    if (id === "walking") goTo("walking");
    else if (id === "sleep") goTo("sleep");
  };
  return (
    <div style={{ padding: "16px 24px 8px" }}>
      <div className="uppercase-eyebrow" style={{ marginBottom: 10 }}>Rhythm — last seven days</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        {tiles.map(t => {
          const tappable = t.id === "walking" || t.id === "sleep";
          return (
            <button key={t.id} onClick={() => handle(t.id)} disabled={!tappable} style={{
              background: "var(--surface-card)", border: "1px solid var(--hairline)",
              borderRadius: 14, padding: "12px 14px", textAlign: "left",
              cursor: tappable ? "pointer" : "default",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 500 }}>{t.label}</span>
                <span className="tabular" style={{ fontSize: 12, color: "var(--ink-muted)" }}>{t.pct}%</span>
              </div>
              <RhythmDots days={t.days}/>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MovementCard({ goTo }) {
  return (
    <div style={{ padding: "16px 24px 0" }}>
      <button onClick={() => goTo("exercise")} style={{
        width: "100%", position: "relative", overflow: "hidden",
        border: "1px solid var(--hairline)", borderRadius: 18,
        background: "var(--surface-card)",
        padding: "18px 18px", textAlign: "left", display: "flex", gap: 14, alignItems: "center",
      }}>
        <Orb palette="amber" size={130} blur={24} opacity={0.7} style={{ top: -30, right: -30 }}/>
        <OrbSwatch palette="amber" size={32}/>
        <div style={{ flex: 1, position: "relative" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 4 }}>Exercise plan</div>
          <div style={{ fontSize: 14, color: "var(--ink)" }}>Strength · foundation · 18 min</div>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>Next session in your beginner plan.</div>
        </div>
        <IconChevron size={16} color="var(--ink-faint)"/>
      </button>
    </div>
  );
}

function FoodPhotoButton({ goTo }) {
  return (
    <div style={{ padding: "20px 24px 12px" }}>
      <button onClick={() => goTo("food")} style={{
        width: "100%", position: "relative", overflow: "hidden",
        border: "1px solid var(--hairline)", borderRadius: 20,
        background: "var(--surface-card)",
        padding: "26px 22px", textAlign: "left",
      }}>
        <div style={{ position: "absolute", right: -30, top: -40 }}>
          <Orb palette="coral" size={170} blur={28} opacity={0.85}/>
        </div>
        <div style={{ position: "absolute", left: -40, bottom: -60 }}>
          <Orb palette="blush" size={140} blur={28} opacity={0.6}/>
        </div>
        <div style={{ position: "relative", display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            background: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <IconCamera size={22} color="#FBF9F5" strokeWidth={1.4}/>
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ marginBottom: 4 }}>Photograph a meal</h4>
            <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Good · Watch · For your next meal — in three lines.</p>
          </div>
        </div>
      </button>
    </div>
  );
}

function BiomarkerCTA({ goTo }) {
  return (
    <div style={{ padding: "12px 24px 8px" }}>
      <Card style={{ padding: "18px 20px 18px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -30, top: -30 }}>
          <Orb palette="amber" size={130} blur={24} opacity={0.7}/>
        </div>
        <div className="uppercase-eyebrow" style={{ marginBottom: 6, color: "var(--signal-doctor)" }}>✦ Next layer</div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, lineHeight: 1.2, marginBottom: 12, position: "relative" }}>
          Your starter rhythm is in motion.<br/>
          <span className="serif-i" style={{ color: "var(--ink-soft)" }}>The biomarker test opens the next layer.</span>
        </div>
        <Button variant="primary" size="sm" onClick={() => goTo("test")}>
          See test package <IconArrow size={12}/>
        </Button>
      </Card>
    </div>
  );
}

function ReportCTA({ goTo }) {
  return (
    <div style={{ padding: "12px 24px 8px" }}>
      <Card style={{ padding: "18px 20px", background: "linear-gradient(135deg, #1A1A1A 0%, #2A2622 100%)", border: "1px solid #2A2622", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -30, bottom: -30 }}>
          <Orb palette="amber" size={140} blur={28} opacity={0.5}/>
        </div>
        <div className="uppercase-eyebrow" style={{ marginBottom: 6, color: "var(--signal-doctor)", position: "relative" }}>✦ Doctor-reviewed</div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, lineHeight: 1.2, marginBottom: 14, color: "#FBF9F5", position: "relative" }}>
          Your report is ready.
        </div>
        <Button variant="cream" size="sm" onClick={() => goTo("report")} style={{ background: "#FBF9F5", color: "#1A1A1A" }}>
          Open report with Zoe <IconArrow size={12}/>
        </Button>
      </Card>
    </div>
  );
}

function TodayScreen({ user, testStatusId, reportApproved, goTo, recoveryWin, dismissRecoveryWin }) {
  const reportReady = reportApproved && (testStatusId === "ready" || testStatusId === "ai");
  const booked = !!testStatusId;
  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", position: "relative" }}>
      <Orb palette="blush" size={320} blur={70} opacity={0.55} style={{ top: -180, right: -120 }}/>
      <Noise opacity={0.04}/>
      <div style={{ position: "relative", zIndex: 2, paddingBottom: 110 }}>
        <GreetingHeader name={user.name}/>
        {recoveryWin && <RecoveryWinBanner onClose={dismissRecoveryWin}/>}
        <DailyFocusCard/>
        <ZoeChatPanel/>
        <DailyMissionsStrip goTo={goTo}/>
        <RhythmRow goTo={goTo}/>
        <MovementCard goTo={goTo}/>
        <FoodPhotoButton goTo={goTo}/>
        {reportReady ? <ReportCTA goTo={goTo}/> : !booked && <BiomarkerCTA goTo={goTo}/>}
      </div>
    </div>
  );
}

Object.assign(window, { TodayScreen });
