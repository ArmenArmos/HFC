#!/usr/bin/env node
// One command per suite: node e2e/run.mjs web|telegram|ios [--no-reset] [test args]. "serve" keeps the seeded app up for debugging.
// Owns the whole local stack for the run. It refuses to run unless every address it will use is
// this machine's own, and it never reads the shell's Supabase or provider settings.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOT, CRON_SECRET } from "./telegram/config.mjs";
import { startFakeTelegram } from "./telegram/fake-api.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const state = join(root, "e2e/.state");
const args = process.argv.slice(2);
const suite = args.shift();
const noReset = args.includes("--no-reset");
const rest = args.filter((a) => a !== "--no-reset");
if (!["web", "telegram", "ios", "serve"].includes(suite)) throw new Error("usage: node e2e/run.mjs web|telegram|ios|serve [--no-reset] [test args]");
const telegram = suite === "telegram";

const config = join(root, "supabase/config.toml");
const original = readFileSync(config, "utf8");
const projectId = /^project_id = "(.+)"/m.exec(original)?.[1];
const apiPort = Number(/\[api\][^[]*?\nport = (\d+)/.exec(original)?.[1]);
const profile = process.env.NOREON_E2E_COLIMA_PROFILE ?? projectId;
// A CI job has its runner's Docker to itself, on Verify's project and ports (.github/workflows/e2e.yml).
const isolatedCi = process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REPOSITORY === "noreon-health/noreon-core" && (process.env.RUNNER_ENVIRONMENT === "github-hosted" || (process.env.RUNNER_ENVIRONMENT === "self-hosted" && process.env.NOREON_ISOLATED_CI_RUNNER === "noreon-ci"));
if (!projectId?.startsWith("noreon-") || !apiPort || (apiPort === 54321 && !isolatedCi)) {
  throw new Error("Run output/workflow-tools/lane-ports.mjs on this worktree first: the suite needs its own project id and ports.");
}
const socket = isolatedCi ? "/var/run/docker.sock" : join(homedir(), `.colima/${profile}/docker.sock`);
if (!existsSync(socket)) throw new Error(`No Docker socket at ${socket}. Start the lane VM with output/workflow-tools/vm-start.sh ${profile}.`);

// Next loads dotenv files itself, so a worktree's own settings would reach the app despite the clean environment below.
const dotenv = readdirSync(root).filter((f) => f.startsWith(".env") && f !== ".env.example");
if (dotenv.length) throw new Error(`Move ${dotenv.join(", ")} out of this worktree: the suite must not read local provider settings.`);
const guard = join(root, "e2e/net-guard.mjs");
const probe = spawnSync(process.execPath, ["--import", guard, "-e", 'require("node:https").get("https://blocked.invalid/").on("error",(e)=>process.exit(/guard refused/.test(e.message)?0:1)).on("response",()=>process.exit(1))'], { env: { PATH: process.env.PATH } });
if (probe.status !== 0) throw new Error("The network guard did not stop a test request");

// Only what the suite needs: the shell's own Supabase, Vercel or provider settings never reach the app.
const base = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG };
const docker = { ...base, DOCKER_HOST: `unix://${socket}`, SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN: "e2e-not-a-real-token" };
const bin = (name) => join(root, "node_modules/.bin", name);
const supabase = (...a) => execFileSync(bin("supabase"), a, { cwd: root, env: docker, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Local Auth overlay: SMS sign-up on, fixed codes, and a provider entry GoTrue needs to accept the
// request. test_otp numbers never reach it; the credentials are not real, so nothing else can either.
export const OVERLAY_MARK = "# e2e overlay";
function overlay(text) {
  return text
    .replace(/(\[auth\.sms\]\n(?:#.*\n)?enable_signup = )false/, "$1true")
    .replace(/^# \[auth\.sms\.test_otp\]\n# 4152127777 = "123456"/m, `${OVERLAY_MARK}\n[auth.sms.test_otp]\n37499000201 = "246810"\n37499000202 = "246810"\n37499000203 = "246810"\n37499000212 = "246810"`)
    .replace(/(\[auth\.sms\.twilio\]\n)enabled = false\naccount_sid = ""\nmessage_service_sid = ""/, '$1enabled = true\naccount_sid = "ACe2e0000000000000000000000000000"\nmessage_service_sid = "MGe2e0000000000000000000000000000"');
}
// Nothing here reads logs, Studio or edge functions; without them the stack is lighter and a busy machine does not time out its health checks.
const lean = (text) => text.replace(/(\[(?:analytics|studio|edge_runtime)\]\nenabled = )true/g, "$1false");
const overlaid = lean(original.includes("[auth.sms.test_otp]\n37499000201") ? original : overlay(original));
if (overlaid !== original) writeFileSync(config, overlaid);

mkdirSync(state, { recursive: true });
rmSync(join(state, "blocked.log"), { force: true });
const running = spawnSync(bin("supabase"), ["status", "-o", "json"], { cwd: root, env: docker, encoding: "utf8" });
const exclude = process.env.NOREON_E2E_SUPABASE_EXCLUDE;
if (running.status !== 0) supabase("start", ...(exclude ? ["-x", exclude] : []));
const keys = JSON.parse(supabase("status", "-o", "json"));
for (const url of [keys.API_URL, keys.DB_URL]) if (!new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/)) throw new Error(`Refusing non-local target ${new URL(url).hostname}`);
if (Number(new URL(keys.API_URL).port) !== apiPort) throw new Error("Stack is on unexpected ports");
if (!noReset) {
  console.log("Resetting the local database...");
  // On a busy machine the CLI's helper container sometimes exits while the database restarts. That is the tool, not the suite.
  try { supabase("db", "reset", "--local"); } catch { console.log("Reset failed, trying once more..."); supabase("db", "reset", "--local"); }
}

const appPort = apiPort + 10;
const site = `http://localhost:${appPort}`;
const appEnv = {
  ...base,
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import ${guard}`,
  NOREON_E2E_BLOCKED_LOG: join(state, "blocked.log"),
  NEXT_PUBLIC_SITE_URL: site,
  NEXT_PUBLIC_SUPABASE_URL: keys.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: keys.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_PATIENT_DEMO: "false",
  NOREON_REGISTRATION_ENABLED: "true",
  NOREON_PHONE_OTP_PROVIDER: "sms",
  NOREON_REGISTRATION_ALLOWED_PREFIXES: "+374",
  NOREON_REAL_MEMBER_REVIEW_ENABLED: "true",
  NOREON_REAL_TEST_REQUESTS_ENABLED: "true",
  NOREON_ZOE_PROVIDER: "fake",
  NOREON_ZOE_CHAT_DESIGN_PREVIEW: "true",
  NOREON_MEMBER_HOME_PROTOTYPE: process.env.NOREON_E2E_MEMBER_HOME === "true" ? "true" : "false",
  // The new member chat at /patient/chat (member-chat-v2.spec.ts). On, sign-up lands in it, so it runs on its own: NOREON_E2E_CHAT_V2=true node e2e/run.mjs web member-chat-v2 send-before-hydration (the second also covers /patient/chat then).
  NOREON_MEMBER_CHAT_V2: process.env.NOREON_E2E_CHAT_V2 === "true" ? "true" : "false",
  // Off in the database by default, so other journeys see the switched-off product. multi-medicine.spec.ts turns them on.
  NOREON_MULTI_MEDICINE_ENABLED: "true",
  NOREON_DOCTOR_COMPLETION_ENABLED: "true",
  ...(suite === "web" ? {
    NOREON_DOCTOR_WORKSPACE: "true",
    NOREON_DOCTOR_CHAT_HOME: "true",
    NOREON_DOCTOR_DECISIONS: "true",
    // The existing conversation page exposes Hand back only with the pipeline on.
    // The provider remains fake and database switches remain off outside their tests.
    NOREON_ZOE_SCAFFOLD_ENABLED: "true",
    NOREON_ZOE_PIPELINE_ENABLED: "true",
  } : {}),
  // The kit's look on the live chat: run the suite both ways (NOREON_E2E_ZOE_KIT=true node e2e/run.mjs web).
  ...(process.env.NOREON_E2E_ZOE_KIT === "true" ? { NOREON_ZOE_CHAT_KIT: "true" } : {}),
  // The new nurse chat, for iPhone passes and its journey test: NOREON_E2E_NURSE_CHAT=true node e2e/run.mjs serve.
  ...(process.env.NOREON_E2E_NURSE_CHAT === "true" ? { NOREON_NURSE_CHAT: "true", NOREON_NURSE_CHAT_V2: "true" } : {}),
  // The rebuilt doctor chat at the doctor's own address: NOREON_E2E_DOCTOR_CHAT=true node e2e/run.mjs web doctor-chat-journey.
  ...(process.env.NOREON_E2E_DOCTOR_CHAT === "true" ? { NOREON_DOCTOR_WORKSPACE: "true", NOREON_DOCTOR_CHAT_HOME: "true", NOREON_DOCTOR_DECISIONS: "true", NOREON_DOCTOR_CHAT_V2: "true" } : {}),
  // Urgent words and their care alert (zoe-urgent.spec.ts). Alerts stay off in the database unless a test switches them on.
  NOREON_ZOE_URGENT_PLACEHOLDER: "true",
  NOREON_CARE_ALERTS_ENABLED: "true",
};
const telegramPort = apiPort + 11;
if (telegram) Object.assign(appEnv, {
  // Staging's switches. The stand-ins in telegram/preload.mjs answer every Telegram and model call on this machine.
  NODE_OPTIONS: `--import ${join(root, "e2e/telegram/preload.mjs")}`,
  NOREON_E2E_TELEGRAM_PORT: String(telegramPort),
  NOREON_TELEGRAM_ENABLED: "true",
  NOREON_NURSE_TELEGRAM_ENABLED: "true",
  NOREON_TELEGRAM_ACCOUNT: BOT.account,
  NOREON_TELEGRAM_BOT_ID: String(BOT.id),
  NOREON_TELEGRAM_BOT_USERNAME: BOT.username,
  NOREON_TELEGRAM_BOT_TOKEN: BOT.token,
  NOREON_TELEGRAM_WEBHOOK_SECRET: BOT.secret,
  NOREON_ZOE_SCAFFOLD_ENABLED: "true",
  NOREON_ZOE_PIPELINE_ENABLED: "true",
  NOREON_ZOE_PROVIDER: "gateway",
  NOREON_ZOE_MODEL_CALLS_ENABLED: "true",
  NOREON_PRELAUNCH_STAGING: "true",
  NOREON_CARE_ALERTS_ENABLED: "true",
  NOREON_APP_ORIGIN: site,
  CRON_SECRET,
});
writeFileSync(join(state, "env.json"), JSON.stringify({ site, api: keys.API_URL, anon: keys.ANON_KEY, service: keys.SERVICE_ROLE_KEY, container: `supabase_db_${projectId}`, socket }), { mode: 0o600 });

if (await fetch(`${site}/api/health`).then(() => true, () => false)) throw new Error(`Something is already serving ${site}. The suite only runs against an app it started itself.`);

let app, tests, appFailure;
let stopping = false;
let healthTimer, healthFailures = 0;
const fake = telegram ? await startFakeTelegram({ botId: BOT.id, token: BOT.token, port: telegramPort }) : null;
function stop() {
  stopping = true;
  clearTimeout(healthTimer);
  if (app?.pid) {
    try { execFileSync("ps", ["-p", String(app.pid), "-o", "pid,command"], { stdio: "inherit" }); } catch {}
    try { process.kill(-app.pid); } catch {}
  }
}
function appStopped(detail) {
  if (stopping || appFailure) return;
  appFailure = `App stopped unexpectedly (${detail}); see ${join(state, "app.log")}`;
  console.error(appFailure);
  // A dead app is one infrastructure failure, not dozens of failed member journeys.
  // Never restart it mid-suite: that could hide the failure or change the test's state.
  if (tests?.pid && tests.exitCode === null && tests.signalCode === null) {
    try { execFileSync("ps", ["-p", String(tests.pid), "-o", "pid,command"], { stdio: "inherit" }); } catch {}
    tests.kill("SIGTERM");
  }
}
async function watchHealth() {
  // Next's CLI can stay alive after its server worker is killed. Any HTTP response
  // A first compile on a small CI server blocks /api/health for 40 s or more, so the window is two minutes.
  // proves reachability; a 500 is for the product tests to report, not this monitor.
  try {
    await fetch(`${site}/api/health`, { signal: AbortSignal.timeout(10_000) });
    healthFailures = 0;
  } catch { healthFailures++; }
  if (stopping || appFailure) return;
  if (healthFailures === 12) appStopped("health endpoint unreachable on 12 consecutive checks");
  else healthTimer = setTimeout(watchHealth, 1000);
}
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
let status = 1;
try {
  console.log(`Starting the app on ${site}`);
  // A dev cache left by the last run can put pages in a reload loop, or crash next dev mid-run ("restoring failed").
  rmSync(join(root, ".next/dev"), { recursive: true, force: true });
  const log = join(state, "app.log");
  const logFd = openSync(log, "w");
  app = spawn(bin("next"), ["dev", "-p", String(appPort), "-H", "localhost"], { cwd: root, env: appEnv, detached: true, stdio: ["ignore", logFd, logFd] });
  app.once("error", (error) => appStopped(`spawn error: ${error.code ?? "unknown"}`));
  app.once("exit", (code, signal) => appStopped(`exit code ${code}, signal ${signal ?? "none"}`));
  let up = false;
  for (let i = 0; i < 240 && !up && !appFailure; i++) {
    up = await fetch(`${site}/api/health`).then((r) => r.status < 500, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (appFailure || !up) throw new Error(appFailure ?? `App did not start, see ${log}`);
  healthTimer = setTimeout(watchHealth, 1000);
  const testEnv = { ...base, NOREON_E2E_NURSE_CHAT: process.env.NOREON_E2E_NURSE_CHAT, NOREON_E2E_ENV: join(state, "env.json"), NOREON_E2E_SUITE: suite, NOREON_E2E_DOCTOR_CHAT: process.env.NOREON_E2E_DOCTOR_CHAT, NOREON_E2E_TELEGRAM_PORT: String(telegramPort), NOREON_E2E_MEMBER_HOME: process.env.NOREON_E2E_MEMBER_HOME, NOREON_E2E_CHAT_V2: process.env.NOREON_E2E_CHAT_V2, ...(process.env.NOREON_E2E_BROWSER_WS ? { PW_TEST_CONNECT_WS_ENDPOINT: process.env.NOREON_E2E_BROWSER_WS } : {}) };
  // --no-reset keeps the seeded people (their passwords are in accounts.json) for quick reruns while writing a test.
  for (const script of noReset && existsSync(join(state, "accounts.json")) ? [] : ["e2e/seed.mjs", ...(telegram ? ["e2e/telegram/seed.mjs"] : [])]) {
    const seed = spawnSync(process.execPath, [join(root, script)], { cwd: root, env: testEnv, stdio: "inherit" });
    if (seed.status !== 0) throw new Error("Seed failed");
  }
  if (suite === "serve") {
    console.log(`Serving ${site}. Stop with Ctrl-C.`);
    await new Promise(() => {});
  } else if (suite === "web" || telegram) {
    // Not spawnSync: the fake Telegram API lives in this process and has to keep answering.
    if (appFailure) throw new Error(appFailure);
    tests = spawn(bin("playwright"), ["test", "-c", "e2e/playwright.config.ts", ...(telegram ? ["--project=telegram"] : []), ...rest], { cwd: root, env: testEnv, stdio: "inherit" });
    status = await new Promise((resolve, reject) => {
      tests.once("error", reject);
      tests.once("close", (code) => resolve(appFailure ? 1 : code ?? 1));
    });
  } else {
    const flows = rest.length ? rest : ["e2e/maestro"];
    status = spawnSync(process.execPath, [join(root, "e2e/ios.mjs"), ...flows], { cwd: root, env: { ...base, NOREON_E2E_ENV: join(state, "env.json") }, stdio: "inherit" }).status ?? 1;
  }
  if (existsSync(join(state, "blocked.log")) && statSync(join(state, "blocked.log")).size) {
    console.error(`The network guard refused outbound calls:\n${readFileSync(join(state, "blocked.log"), "utf8")}`);
    status = status || 1;
  }
} finally {
  stop();
  await fake?.close();
}
process.exit(status);
