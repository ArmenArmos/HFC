// Extras — Helpful Tips Library, Walking detail, Sleep detail, Badges row, Weekly Review,
// Recovery Win banner, Conversion screen.

const { useState: useStateX, useEffect: useEffectX } = React;

// ─────────────────────────────────────────────────────────────
// Helpful Tips Library
// ─────────────────────────────────────────────────────────────
const TIPS = [
  { cat: "Food",      orb: "sage",  body: "Start with protein at breakfast — it changes the shape of the whole day." },
  { cat: "Food",      orb: "sage",  body: "Add fibre to carbohydrate-heavy meals — a salad before bread does real work." },
  { cat: "Food",      orb: "sage",  body: "Try not to drink calories daily. Save them for things you can taste." },
  { cat: "Food",      orb: "sage",  body: "Smaller portions beat total restriction. A finished plate teaches your body to trust you." },
  { cat: "Walking",   orb: "coral", body: "After-meal walks help glucose more than people expect. Twelve minutes is enough." },
  { cat: "Walking",   orb: "coral", body: "Walking during calls counts. Consistency beats intensity." },
  { cat: "Walking",   orb: "coral", body: "Three small walks count more than one heroic one." },
  { cat: "Sleep",     orb: "lilac", body: "Consistent bedtime matters more than total hours, most of the time." },
  { cat: "Sleep",     orb: "lilac", body: "Caffeine has a long tail. A 14:00 cutoff is a kind choice for tonight." },
  { cat: "Sleep",     orb: "lilac", body: "Phone light and unfinished work both delay recovery. Move one of them." },
  { cat: "Exercise",  orb: "amber", body: "Strength supports metabolic health — even one weekly session changes things." },
  { cat: "Exercise",  orb: "amber", body: "Mobility protects consistency. Two minutes a day is plenty." },
  { cat: "Exercise",  orb: "amber", body: "Low-energy days still count if you move gently." },
  { cat: "Stress",    orb: "blush", body: "Stress affects appetite, sleep, and recovery — it isn't a vague feeling." },
  { cat: "Stress",    orb: "blush", body: "Short breaks during the day matter. The shortest one is a breath." },
  { cat: "Stress",    orb: "blush", body: "Breathing isn't magic, but it lowers the pressure you carry to the next thing." },
  { cat: "Biomarkers",orb: "twilight", body: "Biomarkers are signals, not identity. One result rarely tells the whole story." },
  { cat: "Biomarkers",orb: "twilight", body: "Trends matter more than single values. Retest is the answer to most worries." },
  { cat: "Biomarkers",orb: "twilight", body: "A doctor reading your result before you do is a quiet luxury. Use it." },
  { cat: "Motivation",orb: "coral", body: "Missed days are normal. Restart is a skill — it gets easier each time." },
  { cat: "Motivation",orb: "coral", body: "Smaller goals you keep are better than perfect plans you don't." },
];

const TIP_CATS = ["All", "Food", "Walking", "Sleep", "Exercise", "Stress", "Biomarkers", "Motivation"];

function TipsLibraryScreen({ onBack }) {
  const [cat, setCat] = useStateX("All");
  const visible = cat === "All" ? TIPS : TIPS.filter(t => t.cat === cat);

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110, position: "relative" }}>
      <Orb palette="sage" size={280} blur={70} opacity={0.45} style={{ top: -130, left: -80 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 24px 6px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Helpful tips</div>
      </div>

      <div style={{ position: "relative", padding: "10px 24px 8px" }}>
        <h2 style={{ fontSize: 30 }}>Quiet, useful<br/><span className="serif-i">truths.</span></h2>
        <p style={{ marginTop: 10, fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.55 }}>
          Short pieces Zoe leans on. Read what you need. Skip what you don't.
        </p>
      </div>

      {/* Cat filter */}
      <div style={{ position: "relative", padding: "16px 0 6px 24px" }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, paddingRight: 24 }}>
          {TIP_CATS.map(c => (
            <Chip key={c} size="sm" selected={cat === c} onClick={() => setCat(c)}>{c}</Chip>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", padding: "10px 24px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map((t, i) => (
          <Card key={i} style={{ padding: "16px 18px", display: "flex", gap: 14, alignItems: "flex-start" }}>
            <OrbSwatch palette={t.orb} size={22}/>
            <div style={{ flex: 1 }}>
              <div className="uppercase-eyebrow" style={{ marginBottom: 6, fontSize: 10 }}>{t.cat}</div>
              <p className="serif-i" style={{ fontSize: 16, color: "var(--ink-soft)", lineHeight: 1.5 }}>{t.body}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Walking + Sleep details
// ─────────────────────────────────────────────────────────────
function WalkingDetailScreen({ onBack }) {
  const today = 4280;
  const target = 7500;
  const last7 = [6200, 7100, 8400, 4800, 7900, 6600, today];
  const max = Math.max(...last7, target);

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110, position: "relative" }}>
      <Orb palette="coral" size={300} blur={70} opacity={0.55} style={{ top: -150, right: -100 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 24px 6px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Walking</div>
      </div>

      <div style={{ position: "relative", padding: "10px 24px 14px" }}>
        <h2 style={{ fontSize: 30 }}>A small rhythm,<br/><span className="serif-i">most days.</span></h2>
      </div>

      <div style={{ position: "relative", padding: "12px 24px" }}>
        <Card style={{ padding: "18px 20px 20px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -40, opacity: 0.85 }}>
            <Orb palette="coral" size={150} blur={28}/>
          </div>
          <div className="uppercase-eyebrow" style={{ marginBottom: 6 }}>Today</div>
          <div className="tabular serif" style={{ fontSize: 56, lineHeight: 1 }}>{today.toLocaleString()}</div>
          <div className="tabular" style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
            of {target.toLocaleString()} steps · {Math.round(today/target * 100)}% of daily target
          </div>
          <div style={{ marginTop: 14 }}>
            <HairlineBar value={today/target} color="var(--ink)" height={3}/>
          </div>
        </Card>
      </div>

      {/* 7-day bars */}
      <div style={{ position: "relative", padding: "12px 24px" }}>
        <Card style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <span className="uppercase-eyebrow">Last seven days</span>
            <span className="tabular" style={{ fontSize: 12, color: "var(--ink-muted)" }}>{Math.round(last7.reduce((a,b)=>a+b,0)/7).toLocaleString()} avg</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
            {last7.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: "100%", height: `${(v / max) * 100}%`,
                  background: i === 6 ? "var(--ink)" : "var(--ink-soft)",
                  borderRadius: 4, opacity: i === 6 ? 1 : 0.55,
                }}/>
                <span className="tabular" style={{ fontSize: 10, color: "var(--ink-faint)" }}>
                  {["M","T","W","T","F","S","S"][i]}
                </span>
              </div>
            ))}
          </div>
          <div style={{ position: "relative", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Daily target line · 7,500</span>
          </div>
        </Card>
      </div>

      {/* Zoe note */}
      <div style={{ position: "relative", padding: "12px 24px" }}>
        <div style={{ display: "flex", gap: 12, padding: "14px 16px", background: "var(--surface-elevated)", borderRadius: 14, border: "1px solid var(--hairline)" }}>
          <ZoeOrb size={26}/>
          <div className="serif-i" style={{ fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.55, flex: 1 }}>
            You're three thousand short of today. Don't chase it — take a twelve-minute walk after dinner and let tomorrow finish the count.
          </div>
        </div>
      </div>
    </div>
  );
}

function SleepDetailScreen({ onBack }) {
  const nights = [
    { d: "M", hrs: 7.2, quality: 0.78 },
    { d: "T", hrs: 6.8, quality: 0.7 },
    { d: "W", hrs: 7.4, quality: 0.85 },
    { d: "T", hrs: 5.9, quality: 0.55 },
    { d: "F", hrs: 7.8, quality: 0.9 },
    { d: "S", hrs: 8.2, quality: 0.88 },
    { d: "S", hrs: 7.1, quality: 0.75 },
  ];
  const avg = (nights.reduce((a,b) => a + b.hrs, 0) / nights.length).toFixed(1);

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110, position: "relative" }}>
      <Orb palette="lilac" size={320} blur={70} opacity={0.55} style={{ top: -160, right: -100 }}/>
      <Orb palette="twilight" size={260} blur={70} opacity={0.4} style={{ top: 80, left: -120 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 24px 6px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Sleep</div>
      </div>

      <div style={{ position: "relative", padding: "10px 24px 14px" }}>
        <h2 style={{ fontSize: 30 }}>The quiet half<br/><span className="serif-i">of every day.</span></h2>
      </div>

      <div style={{ position: "relative", padding: "12px 24px" }}>
        <Card style={{ padding: "18px 20px 18px" }}>
          <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
            <div style={{ flex: 1 }}>
              <div className="uppercase-eyebrow" style={{ marginBottom: 6 }}>Last night</div>
              <div className="tabular serif" style={{ fontSize: 38, lineHeight: 1 }}>7.1<span style={{ fontSize: 18, color: "var(--ink-muted)" }}>h</span></div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 8 }}>23:08 → 06:14</div>
            </div>
            <div style={{ flex: 1, borderLeft: "1px solid var(--hairline)", paddingLeft: 16 }}>
              <div className="uppercase-eyebrow" style={{ marginBottom: 6 }}>7-day average</div>
              <div className="tabular serif" style={{ fontSize: 38, lineHeight: 1, fontStyle: "italic" }}>{avg}<span style={{ fontSize: 18, color: "var(--ink-muted)" }}>h</span></div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 8 }}>Slightly under your target</div>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ position: "relative", padding: "12px 24px" }}>
        <Card style={{ padding: "18px 20px" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 14 }}>This week</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 110 }}>
            {nights.map((n, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: "100%", height: `${(n.hrs / 9) * 100}%`,
                  borderRadius: 4,
                  background: `linear-gradient(180deg, ${ORB_PALETTES.lilac[1]} 0%, ${ORB_PALETTES.twilight[1]} 100%)`,
                  opacity: 0.4 + n.quality * 0.6,
                }}/>
                <span className="tabular" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{n.d}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ position: "relative", padding: "12px 24px" }}>
        <Card padded={false} style={{ padding: 0, overflow: "hidden" }}>
          {[
            ["Wind-down window", "22:30 → 23:00"],
            ["Caffeine cutoff", "14:00"],
            ["Phone in bedroom", "No, weeknights"],
            ["Wake target", "07:00"],
          ].map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{k}</span>
              <span className="tabular" style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{v}</span>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ position: "relative", padding: "12px 24px 8px" }}>
        <div style={{ display: "flex", gap: 12, padding: "14px 16px", background: "var(--surface-elevated)", borderRadius: 14, border: "1px solid var(--hairline)" }}>
          <ZoeOrb size={26} palette="lilac"/>
          <div className="serif-i" style={{ fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.55, flex: 1 }}>
            Thursday was short. Your body usually recovers within two nights — keep tonight's wind-down honest and let Sunday do the rest.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Badges (mature, sparing)
// ─────────────────────────────────────────────────────────────
const BADGES = [
  { id: "routine",   name: "Routine Started", desc: "First three days of your starter rhythm.", orb: "blush",    earned: true },
  { id: "food",      name: "Food Awareness",  desc: "Five photographed meals.",                  orb: "sage",     earned: true },
  { id: "sleep",     name: "Sleep Rhythm",    desc: "Four consistent wind-downs in a week.",    orb: "lilac",    earned: true },
  { id: "biomarker", name: "Biomarker Ready", desc: "Profile complete and test booked.",         orb: "amber",    earned: false },
  { id: "recovery",  name: "Recovery Win",    desc: "Returned after a missed day, without shame.", orb: "twilight", earned: false },
];

function BadgesRow({ onOpen }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div className="uppercase-eyebrow">Quiet badges</div>
        <span style={{ fontSize: 12, color: "var(--ink-muted)" }} className="tabular">
          {BADGES.filter(b => b.earned).length} of {BADGES.length}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {BADGES.map(b => (
          <button key={b.id} onClick={() => onOpen && onOpen(b)} style={{ textAlign: "left", padding: 0, background: "transparent" }}>
            <div style={{
              background: "var(--surface-card)", border: "1px solid var(--hairline)",
              borderRadius: 14, padding: "12px 12px 14px",
              opacity: b.earned ? 1 : 0.45,
              position: "relative", overflow: "hidden",
            }}>
              <div style={{ position: "relative", width: 36, height: 36, marginBottom: 8 }}>
                <Orb palette={b.orb} size={36} blur={2} style={{ position: "absolute", inset: 0 }}/>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink)", lineHeight: 1.3 }}>{b.name}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Weekly review (Sunday)
// ─────────────────────────────────────────────────────────────
function WeeklyReview({ onClose }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 80, display: "flex", flexDirection: "column", background: "var(--bg-cream-soft)" }}>
      <Orb palette="amber" size={340} blur={80} opacity={0.5} style={{ top: -180, right: -120 }}/>
      <Orb palette="sage" size={280} blur={70} opacity={0.4} style={{ bottom: -160, left: -100 }}/>
      <Noise opacity={0.04}/>

      <div style={{ position: "relative", padding: "60px 28px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="uppercase-eyebrow">✦ Sunday review</div>
        <button onClick={onClose} style={{ padding: 6 }}><IconClose size={20} color="var(--ink-soft)"/></button>
      </div>

      <div style={{ position: "relative", padding: "16px 28px 4px" }}>
        <h2 style={{ fontSize: 32, lineHeight: 1.05 }}>A steady<br/><span className="serif-i">week.</span></h2>
        <p style={{ marginTop: 10, fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.55, maxWidth: 320 }}>
          Most of what you planned, you did. The rest is allowed.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px", position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {[
            ["Food",     "86%"],
            ["Walking",  "78%"],
            ["Sleep",    "82%"],
            ["Stress",   "50%"],
          ].map(([k, v]) => (
            <Card key={k} style={{ padding: "14px 16px" }}>
              <div className="uppercase-eyebrow" style={{ marginBottom: 4 }}>{k}</div>
              <div className="tabular serif" style={{ fontSize: 28, lineHeight: 1, fontStyle: "italic" }}>{v}</div>
            </Card>
          ))}
        </div>

        <Card style={{ padding: "16px 18px", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <ZoeOrb size={28}/>
            <div className="serif-i" style={{ fontSize: 16, color: "var(--ink-soft)", lineHeight: 1.55, flex: 1 }}>
              Your strongest day was Friday — protein at every meal, walk after lunch, lights low by 22:30. Notice the shape of that day. We'll borrow from it this week.
            </div>
          </div>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 8 }}>Next week's focus</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["Metabolic Rhythm", "Sleep Consistency", "Energy Reset", "Movement Foundation", "Stress Recovery"].map((f, i) => (
              <Chip key={f} size="sm" selected={i === 0} style={{ cursor: "pointer" }}>{f}</Chip>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ position: "relative", padding: "16px 24px 32px" }}>
        <Button variant="primary" size="lg" fullWidth onClick={onClose}>Carry the focus forward <IconArrow size={14}/></Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Recovery Win banner
// ─────────────────────────────────────────────────────────────
function RecoveryWinBanner({ onClose }) {
  return (
    <div className="fade-up" style={{
      margin: "12px 24px 0",
      padding: "14px 16px",
      borderRadius: 16,
      background: "var(--surface-card)",
      border: "1px solid var(--hairline)",
      position: "relative", overflow: "hidden",
      display: "flex", gap: 12, alignItems: "center",
    }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.85, pointerEvents: "none" }}>
        <Orb palette="sage" size={180} blur={28} opacity={0.5} style={{ top: -50, right: -60 }}/>
      </div>
      <div style={{ position: "relative", width: 28, height: 28 }}>
        <Orb palette="sage" size={28} blur={2} breathe/>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <div className="uppercase-eyebrow" style={{ color: "var(--signal-affirm)", marginBottom: 2, fontSize: 10 }}>✦ Recovery win</div>
        <div className="serif-i" style={{ fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>
          You came back today. That's the whole skill.
        </div>
      </div>
      <button onClick={onClose} style={{ padding: 6, position: "relative" }}><IconClose size={16} color="var(--ink-faint)"/></button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Conversion (book test OR continue starter)
// ─────────────────────────────────────────────────────────────
function ConversionScreen({ onBook, onSkip }) {
  return (
    <div style={{ position: "relative", height: "100%", background: "var(--bg-cream)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Orb palette="amber" size={420} blur={80} style={{ top: -180, right: -160 }}/>
      <Orb palette="coral" size={300} blur={70} opacity={0.6} style={{ bottom: -160, left: -120 }}/>
      <Noise opacity={0.05}/>

      <div style={{ position: "relative", padding: "70px 28px 8px" }}>
        <div className="uppercase-eyebrow" style={{ color: "var(--signal-doctor)" }}>✦ The next layer</div>
        <h2 style={{ marginTop: 14, fontSize: 36, lineHeight: 1.05 }}>
          The biomarker test<br/>
          <span className="serif-i">opens what comes next.</span>
        </h2>
        <p style={{ marginTop: 14, fontSize: 15, color: "var(--ink-soft)", lineHeight: 1.55, maxWidth: 320 }}>
          Your starter rhythm will keep working. When you're ready, a real laboratory result — read by a doctor — will personalize it.
        </p>
      </div>

      <div style={{ position: "relative", padding: "20px 28px 4px", flex: 1 }}>
        <Card padded={false} style={{ padding: 0, overflow: "hidden" }}>
          {[
            ["At-home blood collection", "A phlebotomist comes to your address."],
            ["Foundation laboratory panel", "Metabolic, lipid, hormonal, inflammation."],
            ["Doctor-reviewed report", "A clinician reads every result before you see it."],
            ["Zoe personalized to your data", "Daily plan rebuilt around the actual numbers."],
          ].map(([k, v], i) => (
            <div key={k} style={{ display: "flex", gap: 14, padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
              <IconCheck size={18} color="var(--signal-affirm)" style={{ marginTop: 2 }}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: "var(--ink)" }}>{k}</div>
                <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>{v}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card style={{ marginTop: 14, padding: "16px 18px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div className="uppercase-eyebrow" style={{ marginBottom: 4 }}>Foundation panel</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>Payment simulated in MVP</div>
            </div>
            <div className="serif tabular" style={{ fontSize: 28, fontStyle: "italic" }}>€189</div>
          </div>
        </Card>
      </div>

      <div style={{ position: "relative", padding: "16px 24px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
        <Button variant="primary" size="lg" fullWidth onClick={onBook}>Book my biomarker test <IconArrow size={14}/></Button>
        <Button variant="ghost" size="md" fullWidth onClick={onSkip} style={{ color: "var(--ink-soft)" }}>Continue with starter routine</Button>
      </div>
    </div>
  );
}

Object.assign(window, {
  TipsLibraryScreen, WalkingDetailScreen, SleepDetailScreen,
  BadgesRow, BADGES, WeeklyReview, RecoveryWinBanner, ConversionScreen,
});
