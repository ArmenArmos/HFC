// Zoe — floating assistant + dedicated panel + contextual ask-zoe wrapper.
// Provides ZoeContext.openZoe(context) so any descendant can summon Zoe with context.

const { useState: useStateZ, useEffect: useEffectZ, useRef: useRefZ, useContext: useContextZ } = React;

const ZoeCtx = React.createContext({ openZoe: () => {}, available: true });

// ── Glossary-driven initial reply ────────────────────────────
function initialZoeReply(context) {
  if (!context) return {
    primary: "I'm here. Ask me about a biomarker, a recommendation, or anything you read in your report. I'll explain in plain language.",
    chips: window.NoreonData.zoeSuggestedQuestions,
  };
  const r = window.NoreonData.report;
  if (context.type === "biomarker") {
    const b = r.biomarkers.find(x => x.name === context.name);
    const gloss = window.NoreonData.biomarkerGlossary[context.name] || "I don't have a quick definition for that one, but I can read it next to your other markers if you'd like.";
    const valueLine = b ? `Yours is ${b.value} ${b.unit}, with a reference range of ${b.low}–${b.high}.` : "";
    return {
      primary: `${gloss} ${valueLine}`,
      chips: ["Why does it matter?", "How can I improve it?", "When do we retest?"],
    };
  }
  if (context.type === "highlow") {
    return {
      primary: `Reading this with you. ${context.name} sits ${context.direction === "above" ? "above" : "below"} the reference range — not alarming on its own, but worth understanding. Most lifestyle-responsive markers move with sleep, food rhythm, and consistent movement. We will not over-correct.`,
      chips: ["What changes help?", "How quickly does it move?", "Show my plan"],
    };
  }
  if (context.type === "recommendation") {
    return {
      primary: `"${context.text}" — here's how to make this real: pick the smallest possible version, do it three days this week, and let me see how your body responds before we add anything. We aim for 60–80% adherence. Most weeks land there.`,
      chips: ["Make it smaller", "Remind me about this", "Why this matters"],
    };
  }
  if (context.type === "package") {
    return {
      primary: `Tell me about your goals and I'll point to the panel that fits. The Advanced Biomarker Panel is our most-chosen — twenty-six markers covering metabolic, lipid, inflammation, hormonal, and nutritional signals. Longevity adds ApoB and homocysteine. The metabolic-focused panel is leaner.`,
      chips: ["Which suits me?", "What's the difference?", "How does the draw work?"],
    };
  }
  if (context.type === "term") {
    return {
      primary: `"${context.word}" — in plain language, that means: ${context.gloss || "I'll explain this in plain terms when this term is mapped in the glossary."}`,
      chips: ["Read more", "How does it affect me?", "Show me where this came from"],
    };
  }
  return { primary: "I'm here.", chips: window.NoreonData.zoeSuggestedQuestions };
}

function defaultReply(question) {
  const presets = {
    "Why does it matter?":
      "It matters because biomarkers describe what's actually happening, not what we hope is happening. The kind of changes we make from here — protein at breakfast, an after-meal walk, an earlier wind-down — work because they speak the same language your body uses to set these numbers.",
    "How can I improve it?":
      "Three quiet daily changes will move most of your watch-level patterns: protein-led breakfast, a twelve-minute walk after the biggest meal, and a 14:00 caffeine cutoff. Try them for two weeks before we add anything else.",
    "When do we retest?":
      "Six months from now is the typical retest window for this panel. By then your numbers will reflect the changes you've kept — which is the most honest test of whether anything we did was useful.",
    "What changes help?":
      "Small, daily, repeatable changes — not big, dramatic ones. The body responds to rhythm. We'll borrow from your strongest day this week and use it as the template for the next three.",
    "How quickly does it move?":
      "Most markers move on different clocks. Triglycerides respond within days. HbA1c takes three months because it's a three-month average. Ferritin moves over months. Patience is part of the protocol.",
    "Show my plan":
      "Your thirty-day plan is already written into your report — protein-led breakfast, a walk after lunch, caffeine cutoff at 14:00, iron-rich meals twice a week. Open the report and tap Recommendations to see how it builds across sixty and ninety days.",
    "Make it smaller":
      "Good instinct. The smaller version of that recommendation: do it once, this week, on the day that already feels possible. Smaller, kept goals matter more than perfect plans abandoned.",
    "Remind me about this":
      "I've added a quiet morning prompt for this. It will land alongside your daily briefing — never as a notification you have to dismiss.",
    "Why this matters":
      "This sits on the short list of changes that respond meaningfully in the first thirty days. We start here because early movement creates the momentum to keep going.",
    "Which suits me?":
      "Given your goals — energy, sleep, metabolism, longevity — the Advanced Biomarker Panel covers what we'd want to see first. If you want to go deeper on cardiovascular signals, the Longevity panel adds ApoB and Lp(a). The metabolic-focused panel is leaner and faster if budget matters.",
    "What's the difference?":
      "Essential is twelve markers — a baseline. Advanced is twenty-six and our most-chosen. Longevity adds healthspan signals like ApoB and homocysteine. Premium is the deepest read at fifty-two markers.",
    "How does the draw work?":
      "A trained phlebotomist visits your address at the time you choose. The whole visit is about twelve minutes — paperwork, a single venous draw, and a friendly handoff. Your sample is in the lab within a few hours.",
    "Explain my biomarkers":
      "Tap any biomarker name in your report and I'll open with a short explanation, your value, and what it means in context. Start with the ones flagged as 'watch'.",
    "Ask about my results":
      "Happy to. What's on your mind? Anything you read that worried you, or anything you read that surprised you in a good way?",
    "Create my 30-day health plan":
      "Your thirty-day plan lives inside your report under Recommendations. It's already personalised to your numbers. I can also turn it into a printable card if that's useful.",
    "What should I improve first?":
      "Fasting glucose. Not because it's dangerous — it isn't — but because it responds quickly to the daily rhythm we already have in motion. Protein at breakfast and a walk after lunch is the smallest experiment that should move it.",
  };
  if (presets[question]) return presets[question];
  return "Sitting with that for a moment. The honest answer is that this needs your numbers — open your report and tap the term you're curious about, and I'll read it with you.";
}

// ── Floating button ──────────────────────────────────────────
function ZoeFAB({ onOpen, hidden }) {
  if (hidden) return null;
  return (
    <button
      onClick={() => onOpen(null)}
      aria-label="Open Zoe"
      style={{
        position: "absolute",
        right: 16, bottom: 92,
        zIndex: 56,
        width: 48, height: 48, borderRadius: "50%",
        padding: 0,
        background: "var(--surface-card)",
        border: "1px solid var(--hairline)",
        boxShadow: "0 6px 18px rgba(26,26,26,0.10), 0 1px 2px rgba(26,26,26,0.04)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        transition: "transform 200ms ease-out, box-shadow 200ms",
      }}
      onMouseDown={e => { e.currentTarget.style.transform = "scale(0.96)"; }}
      onMouseUp={e => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      <ZoeOrb size={26} breathe palette="coral"/>
    </button>
  );
}

// ── Slide-up panel ───────────────────────────────────────────
function ZoePanel({ context, onClose }) {
  const initial = initialZoeReply(context);
  const [convo, setConvo] = useStateZ([
    { who: "zoe", text: initial.primary, isOpener: true },
  ]);
  const [chips, setChips] = useStateZ(initial.chips);
  const [draft, setDraft] = useStateZ("");
  const scroller = useRefZ(null);

  useEffectZ(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight + 200;
  }, [convo.length]);

  const ask = (q) => {
    const t = q.trim();
    if (!t) return;
    const reply = defaultReply(t);
    setConvo(c => [...c, { who: "user", text: t }, { who: "zoe", text: reply }]);
    setChips(["Read my full report", "Show my 30-day plan", "Why this matters"]);
    setDraft("");
  };

  const contextChip =
    context?.type === "biomarker"      ? `${context.name}` :
    context?.type === "highlow"        ? `${context.name} · ${context.direction === "above" ? "above range" : "below range"}` :
    context?.type === "recommendation" ? "Recommendation" :
    context?.type === "package"        ? "Lab panels" :
    null;

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 90,
      display: "flex", alignItems: "flex-end",
    }}>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0,
        background: "rgba(20,18,15,0.38)",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
      }}/>
      <div style={{
        position: "relative", width: "100%",
        background: "var(--surface-card)",
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        height: "78%",
        display: "flex", flexDirection: "column",
        boxShadow: "0 -20px 50px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}>
        {/* Header — tight, monochrome */}
        <div style={{ padding: "14px 20px 12px", borderBottom: "1px solid var(--hairline)" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <div style={{ width: 32, height: 3.5, borderRadius: 99, background: "var(--hairline-strong)" }}/>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ZoeOrb size={26}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>Zoe</div>
              <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 1 }}>
                Health assistant
              </div>
            </div>
            {contextChip && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 10px",
                borderRadius: 999,
                background: "var(--surface-elevated)",
                border: "1px solid var(--hairline)",
                fontSize: 10.5, color: "var(--ink-muted)",
                letterSpacing: "0.02em",
                maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                <span style={{ color: "var(--signal-doctor)", fontSize: 9 }}>✦</span> {contextChip}
              </div>
            )}
            <button onClick={onClose} style={{ padding: 4 }}><IconClose size={18} color="var(--ink-muted)"/></button>
          </div>
        </div>

        {/* Conversation */}
        <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", background: "var(--bg-cream-soft)" }}>
          {convo.map((m, i) => m.who === "zoe" ? (
            <div key={i} className="fade-up" style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
              <ZoeOrb size={22}/>
              <div style={{
                flex: 1, padding: "11px 14px",
                background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: 14,
                fontSize: 13.5, lineHeight: 1.5,
                color: "var(--ink-soft)",
              }}>{m.text}</div>
            </div>
          ) : (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <div style={{
                maxWidth: "78%",
                background: "var(--ink)", color: "#FBF9F5",
                padding: "9px 13px", borderRadius: 14,
                fontSize: 13, lineHeight: 1.45,
              }}>{m.text}</div>
            </div>
          ))}
        </div>

        {/* Suggested chips */}
        {chips.length > 0 && (
          <div style={{
            padding: "10px 18px 6px",
            background: "var(--bg-cream-soft)",
            borderTop: "1px solid var(--hairline)",
            display: "flex", gap: 6, flexWrap: "wrap",
          }}>
            {chips.map(q => <Chip key={q} size="sm" onClick={() => ask(q)}>{q}</Chip>)}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: "10px 18px 22px", background: "var(--bg-cream-soft)" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px",
            background: "var(--surface-card)", border: "1px solid var(--hairline)",
            borderRadius: 12,
          }}>
            <input
              value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(draft)}
              placeholder="Ask in plain language."
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--ink)",
              }}
            />
            <button onClick={() => ask(draft)} style={{
              padding: 4,
              opacity: draft.trim() ? 1 : 0.35,
              transition: "opacity 200ms",
            }}>
              <IconArrow size={16}/>
            </button>
          </div>
          <p style={{
            marginTop: 7, fontSize: 10, color: "var(--ink-faint)",
            textAlign: "center", lineHeight: 1.5, letterSpacing: "0.02em",
          }}>
            Not a clinician. For medical questions, your reviewing doctor is your first stop.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Inline ask-zoe wrappers ──────────────────────────────────
// Wraps content with a subtle dotted underline + a small ✦ on hover. Tapping
// opens the Zoe panel with the given context.
function AskZoe({ context, children, style = {}, asBlock = false }) {
  const { openZoe } = useContextZ(ZoeCtx);
  const Tag = asBlock ? "button" : "button";
  return (
    <Tag
      onClick={(e) => { e.stopPropagation(); openZoe(context); }}
      style={{
        background: "transparent", border: "none", padding: 0,
        font: "inherit", color: "inherit", textAlign: "left",
        cursor: "pointer",
        borderBottom: "1px dashed var(--ink-faint)",
        paddingBottom: 1,
        display: "inline",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// ── Small badge — "✦ Ask Zoe" — used inline in plan items, headers, etc.
function AskZoePill({ context, label = "Ask Zoe", style = {} }) {
  const { openZoe } = useContextZ(ZoeCtx);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); openZoe(context); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px 3px 7px",
        borderRadius: 999,
        background: "var(--surface-elevated)", border: "1px solid var(--hairline)",
        fontSize: 10.5, fontWeight: 500,
        color: "var(--ink-soft)",
        letterSpacing: "0.03em",
        cursor: "pointer",
        ...style,
      }}
    >
      <span style={{ color: "var(--signal-doctor)" }}>✦</span> {label}
    </button>
  );
}

Object.assign(window, {
  ZoeCtx, ZoeFAB, ZoePanel, AskZoe, AskZoePill,
});
