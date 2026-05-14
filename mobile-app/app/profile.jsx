// Profile screen — editable summary, goals, privacy, notifications

const { useState: useStateP } = React;

function ProfileScreen({ goTo }) {
  const u = window.NoreonData.user;
  const [notifs, setNotifs] = useStateP({
    morning: true, evening: true, weekly: true, test: true,
  });

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-cream)", paddingBottom: 110, position: "relative" }}>
      <Noise opacity={0.04}/>
      <Orb palette="lilac" size={260} blur={70} opacity={0.5} style={{ top: -130, left: -80 }}/>

      <div style={{ position: "relative", padding: "60px 24px 8px" }}>
        <div className="uppercase-eyebrow">Profile</div>
        <h2 style={{ marginTop: 8, fontSize: 32, lineHeight: 1.05 }}>{u.name}, <span className="serif-i">{u.age}</span></h2>
        <p style={{ marginTop: 6, fontSize: 14, color: "var(--ink-muted)" }}>{u.city} · {u.sex.toLowerCase()} · {u.height}cm · {u.weight}kg</p>
      </div>

      {/* Goals */}
      <div style={{ position: "relative", padding: "20px 24px 8px" }}>
        <SectionHeader eyebrow="Your goals"/>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {u.goals.map(g => <Chip key={g} size="sm" selected style={{ cursor: "default" }}>{g}</Chip>)}
        </div>
      </div>

      {/* Quiet badges */}
      <div style={{ position: "relative", padding: "20px 24px 0" }}>
        <BadgesRow/>
      </div>

      {/* Helpful tips library entry */}
      <div style={{ position: "relative", padding: "16px 24px 0" }}>
        <button onClick={() => goTo && goTo("library")} style={{ width: "100%", padding: 0, background: "transparent", textAlign: "left" }}>
          <Card style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, position: "relative", overflow: "hidden" }}>
            <Orb palette="sage" size={120} blur={24} opacity={0.6} style={{ top: -30, right: -30 }}/>
            <OrbSwatch palette="sage" size={28}/>
            <div style={{ flex: 1, position: "relative" }}>
              <div style={{ fontSize: 14.5, color: "var(--ink)" }}>Helpful tips library</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>Short pieces Zoe leans on.</div>
            </div>
            <IconChevron size={16} color="var(--ink-faint)"/>
          </Card>
        </button>
      </div>

      {/* Health summary */}
      <div style={{ position: "relative", padding: "16px 24px 0" }}>
        <SectionHeader eyebrow="Health summary"/>
        <Card padded={false} style={{ padding: 0, overflow: "hidden" }}>
          {[
            ["Medications", u.medications.join(" · ") || "None"],
            ["Allergies",   u.allergies.join(" · ") || "None"],
            ["Supplements", u.supplements.join(" · ") || "None"],
            ["Family",      u.family.join(" · ") || "Unsure"],
          ].map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--hairline)", gap: 12 }}>
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{k}</span>
              <span style={{ fontSize: 13.5, color: "var(--ink-soft)", textAlign: "right", flex: 1 }}>{v}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Notifications */}
      <div style={{ position: "relative", padding: "20px 24px 0" }}>
        <SectionHeader eyebrow="Notifications"/>
        <Card padded={false} style={{ padding: 0, overflow: "hidden" }}>
          {[
            ["morning",  "Morning briefing"],
            ["evening",  "Evening reflection"],
            ["weekly",   "Weekly review"],
            ["test",     "Test reminders"],
          ].map(([k, label], i) => (
            <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
              <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>{label}</span>
              <ToggleSwitch on={notifs[k]} onChange={() => setNotifs({ ...notifs, [k]: !notifs[k] })}/>
            </div>
          ))}
        </Card>
      </div>

      {/* Privacy */}
      <div style={{ position: "relative", padding: "20px 24px 0" }}>
        <SectionHeader eyebrow="Privacy"/>
        <Card padded={false} style={{ padding: 0, overflow: "hidden" }}>
          {[
            ["Export your data", "All entries, biomarker results, and chats."],
            ["Delete account", "Permanent and irreversible."],
            ["Shared with", "Your reviewing clinician only."],
          ].map(([k, sub], i) => (
            <button key={k} style={{
              width: "100%", padding: "14px 18px",
              borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              textAlign: "left", background: "transparent",
            }}>
              <div>
                <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>{k}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>{sub}</div>
              </div>
              <IconChevron size={16} color="var(--ink-faint)"/>
            </button>
          ))}
        </Card>
      </div>

      {/* Account */}
      <div style={{ position: "relative", padding: "20px 24px 16px" }}>
        <SectionHeader eyebrow="Account"/>
        <Card padded={false} style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--hairline)" }}>
            <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>Email</div>
            <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>{u.email}</div>
          </div>
          <div style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>Subscription</div>
            <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>Founding member — simulated</div>
          </div>
        </Card>
      </div>

      <div style={{ position: "relative", padding: "0 24px 24px" }}>
        <Card style={{ padding: "16px 18px", background: "transparent", border: "1px dashed var(--hairline-strong)" }}>
          <p className="serif-i" style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.55 }}>
            A clinician quietly watches over this account. Zoe is here for the everyday.
          </p>
        </Card>
      </div>
    </div>
  );
}

function ToggleSwitch({ on, onChange }) {
  return (
    <button onClick={onChange} style={{
      width: 42, height: 24, borderRadius: 999, padding: 2,
      background: on ? "var(--ink)" : "var(--hairline-strong)",
      transition: "all 200ms",
      display: "flex", alignItems: "center",
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: "50%", background: "#FBF9F5",
        transform: on ? "translateX(18px)" : "translateX(0)",
        transition: "transform 200ms",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
      }}/>
    </button>
  );
}

Object.assign(window, { ProfileScreen });
