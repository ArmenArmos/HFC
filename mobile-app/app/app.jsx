// Root app — routes, onboarding flow, admin route.

const { useState: useStateApp, useEffect: useEffectApp } = React;

function NoreonApp() {
  // hash routes:
  //   #/ (welcome flow → today)
  //   #/admin
  const [route, setRoute] = useStateApp(window.location.hash.startsWith("#/admin") ? "admin" : "app");

  useEffectApp(() => {
    const handler = () => setRoute(window.location.hash.startsWith("#/admin") ? "admin" : "app");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // shared admin state — drives test status + report visibility for the user app.
  const [adminState, setAdminState] = useStateApp({ statusId: null, reportApproved: false, values: null });

  return (
    <div className="stage">
      {route === "admin"
        ? <AdminScreen adminState={adminState} setAdminState={setAdminState} goApp={() => { window.location.hash = "#/"; }}/>
        : <UserApp adminState={adminState} setAdminState={setAdminState} goAdmin={() => { window.location.hash = "#/admin"; }}/>
      }
    </div>
  );
}

function UserApp({ adminState, setAdminState, goAdmin }) {
  // onboarding phases
  const [phase, setPhase] = useStateApp("welcome");
  const [answers, setAnswers] = useStateApp(null);
  const [tab, setTab] = useStateApp("today");
  const [overlay, setOverlay] = useStateApp(null);
  const [recoveryWin, setRecoveryWin] = useStateApp(true);

  // Dedicated Zoe panel — separate from overlay because she can open OVER any screen.
  const [zoeOpen, setZoeOpen] = useStateApp(false);
  const [zoeContext, setZoeContext] = useStateApp(null);
  const openZoe = (ctx) => { setZoeContext(ctx); setZoeOpen(true); };
  const closeZoe = () => { setZoeOpen(false); setZoeContext(null); };

  const goTo = (where) => {
    if (["food", "report", "exercise", "walking", "sleep", "library", "review"].includes(where)) setOverlay(where);
    else if (where === "test") { setTab("test"); setOverlay(null); }
    else if (where === "missions") { setTab("missions"); setOverlay(null); }
    else { setTab(where); setOverlay(null); }
  };

  const showTabBar = phase === "app" && !overlay;
  const showZoeFab = phase === "app" && !overlay && !zoeOpen;

  let content;
  if (phase === "welcome") {
    content = <WelcomeScreen onBegin={() => setPhase("how")} onHowItWorks={() => setPhase("how")}/>;
  } else if (phase === "how") {
    content = <HowItWorks onBack={() => setPhase("welcome")} onBegin={() => setPhase("onboarding")}/>;
  } else if (phase === "onboarding") {
    content = <OnboardingScreen onBack={() => setPhase("how")} onComplete={(a) => { setAnswers(a); setPhase("completeness"); }}/>;
  } else if (phase === "completeness") {
    content = <CompletenessScreen answers={answers || {}} onContinue={() => setPhase("routine")}/>;
  } else if (phase === "routine") {
    content = <StarterRoutineScreen onBack={() => setPhase("completeness")} onContinue={() => setPhase("conversion")}/>;
  } else if (phase === "conversion") {
    content = <ConversionScreen
      onBook={() => { setAdminState({ ...adminState, statusId: "selected" }); setPhase("app"); setTab("test"); }}
      onSkip={() => setPhase("app")}
    />;
  } else {
    if (overlay === "food") content = <FoodPhotoScreen onBack={() => setOverlay(null)}/>;
    else if (overlay === "report") content = <ReportScreen onBack={() => setOverlay(null)}/>;
    else if (overlay === "exercise") content = <ExerciseScreen onBack={() => setOverlay(null)}/>;
    else if (overlay === "walking") content = <WalkingDetailScreen onBack={() => setOverlay(null)}/>;
    else if (overlay === "sleep") content = <SleepDetailScreen onBack={() => setOverlay(null)}/>;
    else if (overlay === "library") content = <TipsLibraryScreen onBack={() => setOverlay(null)}/>;
    else if (overlay === "review") content = <WeeklyReview onClose={() => setOverlay(null)}/>;
    else if (tab === "today") {
      const effectiveStatus = adminState.reportApproved && (adminState.statusId === "ready" || adminState.statusId === "ai")
        ? adminState.statusId : adminState.statusId;
      content = <TodayScreen
        user={window.NoreonData.user}
        testStatusId={effectiveStatus}
        reportApproved={adminState.reportApproved}
        goTo={goTo}
        recoveryWin={recoveryWin}
        dismissRecoveryWin={() => setRecoveryWin(false)}
      />;
    } else if (tab === "missions") {
      content = <MissionsScreen openReview={() => setOverlay("review")}/>;
    } else if (tab === "test") {
      const statuses = window.NoreonData.testStatuses;
      const advanceTest = () => {
        const curIdx = Math.max(0, statuses.findIndex(s => s.id === adminState.statusId));
        const next = statuses[Math.min(statuses.length - 1, curIdx + 1)];
        // Auto-approve the report once we cross "Doctor review" — the simulated clinician signs off.
        const reviewIdx = statuses.findIndex(s => s.id === "review");
        const shouldApprove = (curIdx + 1) >= reviewIdx + 1; // moving INTO "ready" or beyond
        setAdminState({
          ...adminState,
          statusId: next.id,
          reportApproved: shouldApprove ? true : adminState.reportApproved,
        });
      };
      const resetTest = () => setAdminState({ ...adminState, statusId: null, reportApproved: false });
      content = <TestScreen
        testStatusId={adminState.statusId}
        adminState={adminState}
        onBack={() => setTab("today")}
        onBook={() => setAdminState({ ...adminState, statusId: "scheduled" })}
        onAdvance={advanceTest}
        onApprove={() => setAdminState({ ...adminState, reportApproved: true })}
        onResetTest={resetTest}
        goTo={(w) => {
          if (w === "report" && adminState.reportApproved) setOverlay("report");
        }}
      />;
    } else if (tab === "profile") {
      content = <ProfileScreen goTo={goTo}/>;
    }
  }

  return (
    <ZoeCtx.Provider value={{ openZoe, available: phase === "app" }}>
      <PhoneShell
        hideTabBar={!showTabBar} tab={tab}
        onTab={(t) => { setTab(t); setOverlay(null); }}
        zoeFab={showZoeFab}
        onOpenZoe={openZoe}
      >
        {content}
        {zoeOpen && <ZoePanel context={zoeContext} onClose={closeZoe}/>}
      </PhoneShell>
      <DesktopHint goAdmin={goAdmin}/>
    </ZoeCtx.Provider>
  );
}

function DesktopHint({ goAdmin }) {
  // Tiny corner card visible on desktop only — explains the demo + admin link.
  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, zIndex: 100,
      background: "rgba(20,18,15,0.78)", color: "#FBF9F5",
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      border: "1px solid rgba(184,146,79,0.35)",
      padding: "12px 16px", borderRadius: 16,
      fontFamily: "var(--font-sans)", fontSize: 12,
      maxWidth: 280,
      boxShadow: "0 12px 36px rgba(0,0,0,0.32)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: "var(--signal-doctor)" }}>✦</span>
        <span style={{ letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500, fontSize: 10 }}>Noreon MVP · founding team</span>
      </div>
      <p style={{ color: "rgba(251,249,245,0.78)", lineHeight: 1.5, marginBottom: 10 }}>
        Sign in as a new user above. To advance the test or release a report, open the clinical console.
      </p>
      <button onClick={goAdmin} style={{
        fontSize: 12, color: "#FBF9F5", fontWeight: 500,
        padding: "6px 10px", borderRadius: 8,
        background: "rgba(251,249,245,0.08)", border: "1px solid rgba(251,249,245,0.18)",
      }}>Open clinical console →</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<NoreonApp/>);
