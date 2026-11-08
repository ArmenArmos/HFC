# Noreon

Next.js (App Router) + Supabase. Single repo, structured so that splitting into
a monorepo later is a `git mv` rather than a rewrite.

## Local setup

Requires Node 20+, pnpm, and Docker (the local Supabase stack runs in
containers). The Supabase CLI is a devDependency, so there is nothing to install
globally — everyone on the team gets the same version.

```bash
pnpm install
pnpm db:start                # boots Postgres, Auth, Storage, Studio
cp .env.example .env.local
```

`pnpm db:start` prints the local URL and keys on first boot. To see them again:

```bash
pnpm supabase status
```

Copy `API URL` into `NEXT_PUBLIC_SUPABASE_URL` and `anon key` into
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`, then:

```bash
pnpm dev
```

Studio is at http://127.0.0.1:54323 and the local inbox — where signup and magic
link emails land — is at http://127.0.0.1:54324.

The local keys are fixed values shared by every Supabase developer, not secrets.
Never reuse that `.env.local` for a hosted project.

`pnpm db:stop` shuts the stack down. Containers persist data between runs; use
`pnpm db:reset` to wipe and replay from scratch.

## Database

Every schema change is a migration file under `supabase/migrations/`. Create it
with the CLI rather than by hand — the filename's UTC timestamp is what orders
the sequence:

```bash
pnpm db:new add_measurements     # creates supabase/migrations/<timestamp>_add_measurements.sql
# write the SQL, then:
pnpm db:reset                    # replay every migration from zero
pnpm db:types                    # regenerate lib/db/types.ts
```

If you changed the schema through Studio instead, capture it rather than
retyping it — otherwise the database and the repo drift apart silently:

```bash
pnpm db:diff add_measurements
```

| Script | What it does |
|---|---|
| `pnpm db:start` / `db:stop` | run the local stack |
| `pnpm db:new <name>` | create a timestamped migration file |
| `pnpm db:diff <name>` | capture Studio changes into a migration |
| `pnpm db:reset` | drop the local DB and replay every migration |
| `pnpm db:push` | apply pending migrations to the linked project |
| `pnpm db:status` | compare local and remote migration history |
| `pnpm db:types` | regenerate `lib/db/types.ts` from the local DB |

The rules that keep this from going wrong — forward-only history, renumbering
after a rebase, RLS in the creating migration — are in
[AGENTS.md](./AGENTS.md#database-migrations). Worth reading once before your
first migration.

## Deploying the schema

Migrations are applied by CI, not from anyone's laptop.

**Production deploys itself.** Merging to `main` with a change under
`supabase/migrations/` runs
[`supabase-deploy-production.yml`](.github/workflows/supabase-deploy-production.yml).

**Staging is deployed on demand.** Run
[`supabase-deploy-staging.yml`](.github/workflows/supabase-deploy-staging.yml)
from the Actions tab and pick the branch in the dialog — that is how you try a
migration against a real hosted project before the PR merges.

Both hand off to [`supabase-deploy.yml`](.github/workflows/supabase-deploy.yml),
which links the project, prints the local-vs-remote history, then pushes
whatever the remote is missing. The steps live in one file so a change to how a
deploy works cannot land on one environment and miss the other.

Five repository secrets make it work — the token is account-wide, the other four
come in a pair per project:

| Secret | Where it comes from |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Account -> Access Tokens in the dashboard; covers both projects |
| `SUPABASE_PRODUCTION_PROJECT_ID` | production project ref, from Project Settings -> General |
| `SUPABASE_PRODUCTION_DB_PASSWORD` | production database password, set when the project was created |
| `SUPABASE_PROJECT_ID` | staging project ref |
| `SUPABASE_DB_PASSWORD` | staging database password |

An unset secret arrives as an empty string rather than an error, which is how a
run ends up pointed at the wrong project — so the workflow checks both values
are non-empty before it links anything.

The access token carries full account access, so it belongs in GitHub secrets
and nowhere else — not in `.env.local`, not in a shell profile.

Adding required reviewers to the `production` environment in repo settings turns
every schema change into an explicit approval before it touches the database.

Running `pnpm db:push` locally against a hosted project still works and is the
right escape hatch when CI is down, but it is not the normal path — a schema
applied by hand is one no run log accounts for.


## Layout

```
app/
  (marketing)/   the public site at noreon.health
  patient/       the member app (app.noreon.health)
  staff/real/    the staff portal (backoffice.noreon.health)
  clinic/real/   the clinic portal
components/
  ui/            shadcn/ui primitives (Base UI + Tailwind), owned in-repo
styles/
  noreon/        design system tokens, vendored verbatim; never hand-edited
public/
  brand/         logo, wave and photography assets from the design system
lib/
  clinical/      the screening algorithm: questions, derived values, the twelve
                 red flags and the test catalogue
  supabase/      browser, server and session clients
  db/types.ts    generated from the schema — never hand-edited
supabase/
  config.toml    local stack config
  migrations/    schema as code; RLS from the first migration
proxy.ts         host routing and session refresh, scoped to authenticated routes
```

**The rule that keeps a monorepo split cheap:** domain logic goes in a
framework-free directory under `lib/` that never imports from `next/*`. Plain
TypeScript moves to `packages/core` unchanged the day a second deployable
appears — a mobile app, an admin portal, or a worker service.

## Clinical rules

**One clinical rules service.** `lib/clinical/rules/` owns every threshold. Screens
never compare a number themselves: they ask `evaluate()` and render the
`Decision` it returns, and each finding carries the rule id that produced it.

Copy is Armenian first, as `{ hy, en? }` pairs that fall back to Armenian, so the
English surface can be filled in without ever rendering a missing key.

**Not clinically approved.** The thresholds in `lib/clinical/rules/rules.ts` carry
an algorithm version (`NRN-CLIN-ALG-001-v1.0`) so decisions are traceable, and
they must not be treated as production guidance until clinical sign-off.

The guided `/demo` presentation and demo.noreon.health were retired on
18 October 2026.

## Conventions worth knowing before you edit

**The proxy matcher is scoped on purpose.** The stock Supabase middleware
matcher runs on nearly every path, which makes marketing pages dynamic and
forfeits static caching. Add a prefix to `proxy.ts` only when it genuinely needs
a session, and mirror it in `PROTECTED_PREFIXES` in `lib/supabase/session.ts`.
Keep pages that should rank out of that matcher.

**RLS is the access filter.** Queries do not repeat the `user_id` predicate the
policy already enforces — two copies of one rule drift apart. Enable RLS in the
same migration that creates a table.

**The app is light-only.** There is no theme provider and nothing sets
`data-theme`. The `dark:` utilities inside the vendored shadcn components are
neutralised by the `@custom-variant dark` rule in `globals.css`, which points at
a `.dark` ancestor that never exists. The design system does ship a dark theme;
it is vendored at `styles/noreon/dark.css` and deliberately not imported, so
turning it on later is wiring plus one import rather than a re-derivation.

**Never write a hex in a component.** Every brand value comes from the design
system, vendored byte for byte under `styles/noreon/` and imported by
`globals.css`. The `:root` block in `globals.css` contains no colours of its own:
it only points shadcn's names at design system names, so `--primary` resolves to
`--action-primary-bg` resolves to `--noreon-navy-700`. Taking an update from the
design team is a file copy, which only works if nobody has edited the copies.
`styles/noreon/README.md` records what was taken, what was left behind, and why.

**Two token files are transcribed rather than imported**, because `--radius-*`
and `--shadow-*` are Tailwind namespaces. Importing them produces a silent split
where `var(--shadow-md)` says one thing and the `shadow-md` utility does another,
which is exactly what happened before it was caught. Their values live in the
`@theme` block instead, and `pnpm check:tokens` fails if they drift from the
vendored files. One knock-on: the design system's `--radius-sm` (8px, inputs and
buttons) is `rounded-md` here, and the rest of the ladder shifts with it.

**Four familiar utilities quietly mean something new.** The imported token files
redefine names Tailwind also owns, and being imported later they win, which is
the intent: these utilities should carry the brand's values.

| Utility | Tailwind's value | What it means here |
|---|---|---|
| `ease-out` | `cubic-bezier(0, 0, .2, 1)` | `cubic-bezier(0, .55, .45, 1)` |
| `ease-in-out` | `cubic-bezier(.4, 0, .2, 1)` | `cubic-bezier(.45, 0, .55, 1)` |
| `tracking-tight` | `-0.025em` | `-0.02em` |
| `tracking-widest` | `0.1em` | `0.18em`, the `HEALTH` descriptor |

Nothing else collides. `max-w-max`, the `duration-*` scale and the `text-*` size
scale were each checked against the compiled output, not assumed.

**Chart series are derived, and checked.** The design system specifies a primary
and a secondary series colour and stops, because its own charts are sparklines
and progress arcs. `--chart-1..5` fills the gap: slots 1 to 3 are real ramp steps
(teal-500, blue-400, gold-700), slots 4 and 5 have no brand equivalent, and the
status hues could not be borrowed because red, amber and green are reserved for
biomarker verdicts. `pnpm check:tokens` runs the colourblind-separation and
contrast checks on both grounds. One slot sits below 3:1, so a chart using it
needs visible labels or a table view alongside. Assign a slot to an entity and
keep it there: colour follows the entity, never its rank, so filtering a chart
should never repaint the series that remain.

**Copy is governed, and the rules are unusual.** Second person, sentence case, no
exclamation marks, no emoji, no em dashes. Never "patient" or "user"; say "you"
or "member". Buttons name the action ("See my risk picture"), never "Submit" or
"Learn more". "Doctor-reviewed" is banned as a per-report claim: physicians
design the protocols and routinely monitor, and copy may not promise more than
that. The full lexicon and the say/never-say table are in the design system's
`readme.md`.

## Before this touches real patient data

- **A BAA is required** with Supabase and the hosting provider before PHI
  reaches them — and with any model vendor, if AI is added later. These are
  contractual, not enforceable in code.
- **Consider separate Supabase projects** for marketing/waitlist data and
  clinical data, so analytics and marketing tooling stay outside the PHI
  boundary. Far cheaper to do now than to unpick later.
