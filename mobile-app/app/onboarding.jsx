// Onboarding — Welcome, How It Works, Conversational chat, Data completeness, Starter routine.
// All exported via window so shell.jsx can render them.

const { useState, useEffect, useRef, useMemo } = React;

// ─────────────────────────────────────────────────────────────
// 1) Welcome
// ─────────────────────────────────────────────────────────────
function WelcomeScreen({ onBegin, onHowItWorks }) {
  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden", background: "var(--bg-cream)" }}>
      {/* coral-sunset top-right */}
      <Orb palette="coral"  size={520} blur={70} breathe style={{ top: -180, right: -200 }} />
      {/* sage horizon bottom-left */}
      <Orb palette="sage"   size={460} blur={70} breathe style={{ bottom: -200, left: -180 }} />
      <Orb palette="lilac"  size={260} blur={60} opacity={0.55} style={{ top: 220, left: -120 }} />
      <Noise opacity={0.06} />

      <div style={{
        position: "relative", zIndex: 2,
        height: "100%", display: "flex", flexDirection: "column",
        padding: "120px 32px 56px",
      }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 32, opacity: 0.7 }}>
          ✦ Noreon
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h1 className="fade-up" style={{ fontSize: 56, lineHeight: 1.02, color: "var(--ink)" }}>
            A new era of<br/>
            <span className="serif-i">preventive</span> health.
          </h1>
          <p className="fade-up" style={{
            marginTop: 24, fontSize: 17, lineHeight: 1.55,
            color: "var(--ink-soft)", maxWidth: 320,
            animationDelay: "120ms",
          }}>
            Doctor-monitored. Built around you.<br/>Guided quietly by Zoe.
          </p>
        </div>

        <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "stretch", animationDelay: "240ms" }}>
          <Button variant="primary" size="lg" fullWidth onClick={onBegin}>
            Begin <IconArrow size={16}/>
          </Button>
          <button
            onClick={onHowItWorks}
            style={{
              background: "transparent", border: "none", padding: "10px",
              color: "var(--ink-soft)", fontSize: 14, fontFamily: "var(--font-sans)",
              fontWeight: 500, letterSpacing: "0.005em",
              textDecoration: "underline", textDecorationColor: "var(--ink-faint)",
              textUnderlineOffset: 4,
            }}
          >
            How it works
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 2) How It Works
// ─────────────────────────────────────────────────────────────
const HOW_STEPS = [
  { orb: "blush",    title: "Build your profile",       body: "A short, conversational onboarding with Zoe. Like meeting a thoughtful coach over tea." },
  { orb: "sage",     title: "Receive your starter rhythm", body: "A daily routine before you ever pay — yours to live with for a few days." },
  { orb: "coral",    title: "Book your biomarker test",  body: "An at-home blood draw at a time you choose, with quiet preparation reminders." },
  { orb: "twilight", title: "Read your doctor-reviewed report", body: "Findings translated into daily action by a real clinician — not an algorithm alone." },
];
function HowItWorks({ onBack, onBegin }) {
  return (
    <div style={{ position: "relative", height: "100%", background: "var(--bg-cream)", overflow: "hidden" }}>
      <Orb palette="blush" size={420} blur={70} style={{ top: -180, right: -160 }}/>
      <Noise opacity={0.05}/>
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "70px 24px 8px", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onBack} style={{ padding: 8 }}><IconBack size={20} color="var(--ink-soft)"/></button>
          <div className="uppercase-eyebrow">How it works</div>
        </div>
        <div style={{ padding: "16px 28px 4px" }}>
          <h2 style={{ fontSize: 32 }}>Four quiet steps,<br/><span className="serif-i">one long life.</span></h2>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 100px" }}>
          {HOW_STEPS.map((s, i) => (
            <div key={i} className="fade-up" style={{ marginBottom: 16, animationDelay: `${i * 60}ms` }}>
              <Card padded={false} style={{ padding: "20px 20px 22px", display: "flex", gap: 18, alignItems: "flex-start" }}>
                <div style={{ width: 56, height: 56, position: "relative", flexShrink: 0 }}>
                  <Orb palette={s.orb} size={56} blur={0} style={{ position: "absolute", inset: 0, filter: "blur(2px)" }}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="uppercase-eyebrow" style={{ marginBottom: 4 }}>Step {i + 1}</div>
                  <h4 style={{ marginBottom: 6 }}>{s.title}</h4>
                  <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>{s.body}</p>
                </div>
              </Card>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "20px 24px 40px",
          background: "linear-gradient(180deg, transparent 0%, var(--bg-cream) 30%)" }}>
          <Button variant="primary" size="lg" fullWidth onClick={onBegin}>Begin onboarding <IconArrow size={16}/></Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3) Onboarding chat
// ─────────────────────────────────────────────────────────────

// Each step: zoe intro line, "why" sentence, input definition.
const ONBOARDING_STEPS = [
  {
    id: "goals",
    section: "Goals",
    zoe: "Before anything else — what brought you here? Pick three or four.",
    why: "Your goals shape everything Zoe says.",
    input: {
      type: "multi-select", max: 4,
      options: [
        "More energy", "Better sleep", "Metabolic health", "Longevity",
        "Weight balance", "Stress recovery", "Heart health",
        "Hormonal balance", "Reproductive goals", "Food habits",
      ],
    },
    summary: (v) => `Goals: ${v.join(" · ")}`,
  },
  {
    id: "basics",
    section: "Basics",
    zoe: "A few foundations — your age and a sense of your build.",
    why: "Reference ranges and pacing depend on these.",
    input: {
      type: "basics",
    },
    summary: (v) => `${v.age}, ${v.sex} · ${v.height}cm · ${v.weight}kg · ${v.city}`,
  },
  {
    id: "medical",
    section: "Medical background",
    zoe: "Anything I should know about your medical history? Tap whatever applies.",
    why: "Conditions or medications change what is sensible to suggest.",
    input: {
      type: "multi-select", max: 8,
      options: [
        "Hypertension", "Pre-diabetes", "Thyroid issue",
        "Anxiety / depression", "Migraines", "PCOS / endometriosis",
        "Iron deficiency", "Allergies", "None of these",
      ],
    },
    summary: (v) => v.length ? `Medical: ${v.join(", ")}` : "Medical: nothing flagged",
  },
  {
    id: "family",
    section: "Family history",
    zoe: "What runs in your family? This is one of the most useful things I'll ask.",
    why: "Family patterns guide which biomarkers we watch more carefully.",
    input: {
      type: "multi-select", max: 8,
      options: ["Diabetes", "Heart disease", "Cancer", "Thyroid",
                "Autoimmune", "Fertility / hormonal", "None / unsure"],
    },
    summary: (v) => v.length ? `Family: ${v.join(", ")}` : "Family: none flagged",
  },
  {
    id: "rhythm",
    section: "Lifestyle rhythm",
    zoe: "When does your day usually start, and when do you turn out the lights?",
    why: "Your rhythm tells me when to nudge you, and when to leave you alone.",
    input: { type: "wake-bed" },
    summary: (v) => `Wake ${v.wake} · Bed ${v.bed}`,
  },
  {
    id: "nutrition",
    section: "Nutrition",
    zoe: "How do you eat, roughly? No judgement — only context.",
    why: "Your food style decides what a 'good next meal' even means.",
    input: {
      type: "single-select",
      options: ["Omnivore", "Mediterranean", "Pescatarian", "Vegetarian", "Vegan", "Low-carb", "Other"],
    },
    summary: (v) => `Diet: ${v}`,
  },
  {
    id: "sleep",
    section: "Sleep",
    zoe: "On a typical night, how would you describe your sleep?",
    why: "Sleep quality changes how I weigh tomorrow's plan.",
    input: {
      type: "segmented",
      options: ["Restless", "Patchy", "Fine", "Restorative"],
    },
    summary: (v) => `Sleep: ${v}`,
  },
  {
    id: "movement",
    section: "Movement",
    zoe: "How much do you move, in a normal week?",
    why: "Plans should meet your starting line, not someone else's.",
    input: {
      type: "single-select",
      options: ["Mostly seated", "Walks + light", "2–3 workouts", "4+ workouts"],
    },
    summary: (v) => `Movement: ${v}`,
  },
  {
    id: "stress",
    section: "Stress",
    zoe: "How loud is life right now? Be honest — slide it where it feels.",
    why: "Stress quietly drives the markers we'll test next.",
    input: { type: "slider", min: 1, max: 5, default: 3,
             labels: ["Calm", "Mild", "Steady", "Loud", "Overwhelming"] },
    summary: (v) => `Stress: ${["Calm","Mild","Steady","Loud","Overwhelming"][v-1]}`,
  },
  {
    id: "wellbeing",
    section: "Whole-person (optional)",
    zoe: "These are optional. Many people share them because they shape real health — but skip anything that doesn't fit.",
    why: "Energy, libido, cycle, fertility — discreetly woven into one whole.",
    input: {
      type: "multi-select", max: 6, skippable: true,
      options: ["Track energy through the day", "Mood patterns",
                "Cycle / menopause notes", "Libido or intimacy",
                "Fertility goals", "Performance focus"],
    },
    summary: (v) => v.length ? `Whole-person: ${v.length} topic${v.length>1?"s":""}` : "Whole-person: skipped",
  },
];

// ── Onboarding input controls ────────────────────────────────
function MultiSelectInput({ step, value, onChange }) {
  const v = value || [];
  const toggle = (opt) => {
    if (v.includes(opt)) onChange(v.filter(x => x !== opt));
    else if (v.length < step.input.max) onChange([...v, opt]);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {step.input.options.map(o => (
        <Chip key={o} selected={v.includes(o)} onClick={() => toggle(o)}>{o}</Chip>
      ))}
    </div>
  );
}
function SingleSelectInput({ step, value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {step.input.options.map(o => (
        <Chip key={o} selected={value === o} onClick={() => onChange(o)}>{o}</Chip>
      ))}
    </div>
  );
}
function SegmentedInput({ step, value, onChange }) {
  return (
    <div style={{ display: "flex", background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: 999, padding: 4, gap: 2 }}>
      {step.input.options.map(o => (
        <button
          key={o} onClick={() => onChange(o)}
          style={{
            flex: 1, padding: "10px 8px",
            borderRadius: 999,
            background: value === o ? "var(--ink)" : "transparent",
            color: value === o ? "#FBF9F5" : "var(--ink-soft)",
            fontWeight: 500, fontSize: 13, fontFamily: "var(--font-sans)",
            transition: "all 200ms",
          }}
        >{o}</button>
      ))}
    </div>
  );
}
function SliderInput({ step, value, onChange }) {
  const v = value || step.input.default;
  const labels = step.input.labels;
  return (
    <div>
      <input
        type="range" min={step.input.min} max={step.input.max} value={v}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{
          width: "100%", accentColor: "#1A1A1A",
          height: 6,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        {labels.map((l, i) => (
          <span key={i} style={{ fontSize: 11, color: i + 1 === v ? "var(--ink)" : "var(--ink-faint)", fontWeight: i + 1 === v ? 500 : 400 }}>{l}</span>
        ))}
      </div>
    </div>
  );
}
function BasicsInput({ value, onChange }) {
  const v = value || { age: 34, sex: "Female", height: 168, weight: 64, city: "Lisbon" };
  const set = (k, val) => onChange({ ...v, [k]: val });
  const field = (label, child) => (
    <div style={{ marginBottom: 12 }}>
      <div className="uppercase-eyebrow" style={{ marginBottom: 6, fontSize: 10 }}>{label}</div>
      {child}
    </div>
  );
  const inp = (k, type = "text") => (
    <input value={v[k]} type={type} onChange={(e) => set(k, type === "number" ? parseInt(e.target.value || 0, 10) : e.target.value)}
      style={{
        width: "100%", padding: "10px 14px",
        border: "1px solid var(--hairline-strong)", borderRadius: 12,
        background: "var(--surface-card)", fontFamily: "var(--font-sans)",
        fontSize: 14, color: "var(--ink)", outline: "none",
      }}/>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {field("Age", inp("age", "number"))}
        {field("Sex at birth", (
          <div style={{ display: "flex", gap: 6 }}>
            {["Female", "Male", "Intersex"].map(s => (
              <Chip key={s} size="sm" selected={v.sex === s} onClick={() => set("sex", s)}>{s}</Chip>
            ))}
          </div>
        ))}
        {field("Height (cm)", inp("height", "number"))}
        {field("Weight (kg)", inp("weight", "number"))}
      </div>
      {field("City", inp("city"))}
    </div>
  );
}
function WakeBedInput({ value, onChange }) {
  const v = value || { wake: "07:00", bed: "23:30" };
  return (
    <div style={{ display: "flex", gap: 12 }}>
      {[["wake","Wake"],["bed","Bed"]].map(([k, label]) => (
        <label key={k} style={{ flex: 1, display: "block" }}>
          <div className="uppercase-eyebrow" style={{ marginBottom: 6, fontSize: 10 }}>{label}</div>
          <input type="time" value={v[k]} onChange={(e) => onChange({ ...v, [k]: e.target.value })}
                 style={{ width: "100%", padding: "12px 14px",
                          border: "1px solid var(--hairline-strong)", borderRadius: 12,
                          background: "var(--surface-card)", fontFamily: "var(--font-sans)",
                          fontSize: 15, color: "var(--ink)", outline: "none" }}/>
        </label>
      ))}
    </div>
  );
}

function InputRenderer({ step, value, onChange }) {
  const t = step.input.type;
  if (t === "multi-select") return <MultiSelectInput step={step} value={value} onChange={onChange}/>;
  if (t === "single-select") return <SingleSelectInput step={step} value={value} onChange={onChange}/>;
  if (t === "segmented")     return <SegmentedInput   step={step} value={value} onChange={onChange}/>;
  if (t === "slider")        return <SliderInput      step={step} value={value} onChange={onChange}/>;
  if (t === "basics")        return <BasicsInput      value={value} onChange={onChange}/>;
  if (t === "wake-bed")      return <WakeBedInput     value={value} onChange={onChange}/>;
  return null;
}

function isStepAnswered(step, v) {
  const t = step.input.type;
  if (t === "multi-select") return (v && v.length > 0);
  if (t === "single-select") return !!v;
  if (t === "segmented") return !!v;
  if (t === "slider") return v != null;
  if (t === "basics") return v && v.age && v.sex;
  if (t === "wake-bed") return v && v.wake && v.bed;
  return false;
}

function ProfileDepthBar({ index, total }) {
  const pct = (index) / (total);
  const labels = ["Just starting", "Taking shape", "Almost there", "Complete enough to begin"];
  let label;
  if (pct < 0.25) label = labels[0];
  else if (pct < 0.6) label = labels[1];
  else if (pct < 0.95) label = labels[2];
  else label = labels[3];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div className="uppercase-eyebrow">Profile depth</div>
        <div style={{ fontSize: 12, color: "var(--ink-muted)", fontStyle: "italic" }} className="serif-i">{label}</div>
      </div>
      <HairlineBar value={pct} color="var(--ink-soft)" height={1.5}/>
    </div>
  );
}

function ZoeMessage({ text, intro, why }) {
  return (
    <div className="fade-up" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0" }}>
      <ZoeOrb size={32}/>
      <div style={{ flex: 1, paddingTop: 2 }}>
        <div style={{
          background: "var(--surface-card)", border: "1px solid var(--hairline)",
          borderRadius: 16, padding: "14px 16px",
          maxWidth: "92%",
        }}>
          <div className="serif-i" style={{ fontSize: 17, lineHeight: 1.45, color: "var(--ink)" }}>{text || intro}</div>
          {why && <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.45 }}>{why}</div>}
        </div>
      </div>
    </div>
  );
}
function UserMessage({ text }) {
  return (
    <div className="fade-up" style={{ display: "flex", justifyContent: "flex-end", padding: "6px 0" }}>
      <div style={{
        background: "var(--ink)", color: "#FBF9F5",
        borderRadius: 16, padding: "10px 14px",
        maxWidth: "78%",
        fontSize: 14, lineHeight: 1.45,
      }}>{text}</div>
    </div>
  );
}

function OnboardingScreen({ onComplete, onBack }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [scratch, setScratch] = useState(null); // current step in-progress value
  const [transcript, setTranscript] = useState([{ kind: "zoe", text: ONBOARDING_STEPS[0].zoe, why: ONBOARDING_STEPS[0].why }]);
  const scrollerRef = useRef(null);

  const step = ONBOARDING_STEPS[stepIdx];

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight + 200;
  }, [transcript.length, stepIdx]);

  const commit = (skip = false) => {
    const isFinal = stepIdx === ONBOARDING_STEPS.length - 1;
    const v = scratch;
    const userText = skip ? "Skipping for now" : step.summary(v);
    const nextAnswers = { ...answers, [step.id]: skip ? null : v };
    setAnswers(nextAnswers);
    const append = [
      ...transcript,
      { kind: "user", text: userText },
    ];
    if (!isFinal) {
      const nextStep = ONBOARDING_STEPS[stepIdx + 1];
      append.push({ kind: "zoe", text: nextStep.zoe, why: nextStep.why });
      setTranscript(append);
      setScratch(null);
      setStepIdx(stepIdx + 1);
    } else {
      append.push({ kind: "zoe", text: "That's enough to begin. Let me read it back to you." });
      setTranscript(append);
      setTimeout(() => onComplete(nextAnswers), 600);
    }
  };

  return (
    <div style={{ position: "relative", height: "100%", background: "var(--bg-cream)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Orb palette="twilight" size={420} blur={80} opacity={0.5} style={{ top: -200, left: -120 }}/>
      <Noise opacity={0.04}/>

      {/* Header */}
      <div style={{ position: "relative", zIndex: 2, padding: "60px 24px 16px", background: "linear-gradient(180deg, var(--bg-cream) 70%, transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <button onClick={onBack} style={{ padding: 6 }}><IconBack size={20} color="var(--ink-soft)"/></button>
          <div style={{ flex: 1 }}>
            <ProfileDepthBar index={stepIdx} total={ONBOARDING_STEPS.length}/>
          </div>
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px", position: "relative", zIndex: 2 }}>
        {transcript.map((m, i) => (
          m.kind === "zoe"
            ? <ZoeMessage key={i} text={m.text} why={m.why}/>
            : <UserMessage key={i} text={m.text}/>
        ))}
      </div>

      {/* Input dock */}
      <div style={{ position: "relative", zIndex: 3, padding: "16px 20px 28px", background: "var(--bg-cream-soft)", borderTop: "1px solid var(--hairline)" }}>
        <div className="uppercase-eyebrow" style={{ marginBottom: 10 }}>{step.section}</div>
        <InputRenderer step={step} value={scratch ?? answers[step.id]} onChange={setScratch}/>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {step.input.skippable && (
            <Button variant="secondary" onClick={() => commit(true)} style={{ flex: 1 }}>Skip</Button>
          )}
          <Button
            variant="primary"
            disabled={!isStepAnswered(step, scratch ?? answers[step.id])}
            onClick={() => commit(false)}
            style={{ flex: 2 }}
          >
            {stepIdx === ONBOARDING_STEPS.length - 1 ? "Finish" : "Next"} <IconArrow size={14}/>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 4) Data completeness
// ─────────────────────────────────────────────────────────────
function CompletenessScreen({ answers, onContinue }) {
  const pct = useMemo(() => {
    const filled = Object.values(answers).filter(v => v != null && !(Array.isArray(v) && v.length === 0)).length;
    return Math.min(100, Math.round((filled / ONBOARDING_STEPS.length) * 100));
  }, [answers]);

  const complete = [];
  const missing = [];
  ONBOARDING_STEPS.forEach(s => {
    if (answers[s.id] != null && !(Array.isArray(answers[s.id]) && answers[s.id].length === 0)) complete.push(s.section);
    else missing.push(s.section);
  });

  return (
    <div style={{ position: "relative", height: "100%", background: "var(--bg-cream)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Noise opacity={0.05}/>
      <div style={{ position: "relative", padding: "70px 32px 0", textAlign: "center" }}>
        <div className="uppercase-eyebrow">Your profile</div>
        <h2 style={{ marginTop: 12, fontSize: 32 }}>You are <span className="serif-i">{pct}%</span><br/>complete.</h2>
      </div>

      {/* Big breathing orb */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <div style={{
          position: "relative",
          width: 280, height: 280,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Orb palette="coral" size={280 * (pct / 100) + 60} blur={40} breathe
               style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}/>
          <Orb palette="twilight" size={280 * (pct / 100) + 20} blur={60} opacity={0.6}
               style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}/>
          <div style={{
            position: "relative", zIndex: 2,
            fontFamily: "var(--font-serif)", fontSize: 64, color: "var(--ink)",
            fontStyle: "italic", letterSpacing: "-0.04em",
          }} className="tabular">{pct}<span style={{ fontSize: 28 }}>%</span></div>
        </div>
      </div>

      <div style={{ padding: "0 28px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--signal-affirm)", fontSize: 14 }}>●</span>
              <span style={{ color: "var(--ink-soft)" }}>Complete · <span style={{ color: "var(--ink-muted)" }}>{complete.slice(0, 4).join(", ")}{complete.length > 4 ? `, +${complete.length-4} more` : ""}</span></span>
            </div>
            {missing.length > 0 && (
              <div style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "var(--ink-faint)", fontSize: 14 }}>○</span>
                <span style={{ color: "var(--ink-soft)" }}>Still to add · <span style={{ color: "var(--ink-muted)" }}>{missing.join(", ")}</span></span>
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--signal-doctor)", fontSize: 14 }}>✦</span>
              <span style={{ color: "var(--ink-soft)" }}>Biomarker testing will add <span style={{ color: "var(--ink-muted)" }}>metabolic, lipid, inflammation, hormonal signals.</span></span>
            </div>
          </div>
        </Card>
        <Button variant="primary" size="lg" fullWidth onClick={onContinue}>See my starter routine <IconArrow size={14}/></Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 5) Starter routine reveal
// ─────────────────────────────────────────────────────────────
function StarterRoutineScreen({ onContinue, onBack }) {
  const routine = window.NoreonData.starterRoutine;
  return (
    <div style={{ position: "relative", height: "100%", background: "var(--bg-cream)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Noise opacity={0.05}/>
      <div style={{ padding: "60px 28px 8px", position: "relative", zIndex: 2 }}>
        <button onClick={onBack} style={{ padding: 6, marginBottom: 10 }}><IconBack size={20} color="var(--ink-soft)"/></button>
        <div className="uppercase-eyebrow">Your starter routine</div>
        <h2 style={{ marginTop: 8, fontSize: 30, lineHeight: 1.08 }}>A gentle <span className="serif-i">starting</span> rhythm — yours from today.</h2>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {routine.map((card, i) => (
            <div key={card.id} className="fade-up" style={{ animationDelay: `${i * 70}ms` }}>
              <Card padded={false} style={{ padding: "18px 18px 20px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -40, right: -40, opacity: 0.85, pointerEvents: "none" }}>
                  <Orb palette={card.orb} size={120} blur={18}/>
                </div>
                <div className="uppercase-eyebrow" style={{ marginBottom: 4 }}>0{i+1}</div>
                <h4 style={{ marginBottom: 10, position: "relative" }}>{card.title}</h4>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
                  {card.lines.map((l, j) => (
                    <li key={j} style={{ display: "flex", gap: 10, fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.45 }}>
                      <span style={{ color: "var(--ink-faint)", fontSize: 10, lineHeight: 1.8 }}>—</span>
                      <span style={{ flex: 1 }}>{l}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ))}
          <p className="serif-i" style={{ textAlign: "center", padding: "20px 16px", fontSize: 16, color: "var(--ink-muted)", lineHeight: 1.5 }}>
            This is your starting point.<br/>Zoe will adjust it as we learn more.
          </p>
        </div>
      </div>

      <div style={{ padding: "16px 24px 32px", background: "linear-gradient(180deg, transparent 0%, var(--bg-cream) 30%)" }}>
        <Button variant="primary" size="lg" fullWidth onClick={onContinue}>Open Zoe <IconChat size={16}/></Button>
      </div>
    </div>
  );
}

Object.assign(window, {
  WelcomeScreen, HowItWorks, OnboardingScreen, CompletenessScreen, StarterRoutineScreen,
  ONBOARDING_STEPS,
});
