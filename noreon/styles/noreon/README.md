# Vendored Noreon design system tokens

Copied byte for byte from the `Noreon Design System` package the design team
ships, `tokens/*.css`. **Do not edit these files.** To take an update, replace
them from the package and re-run the checks below.

## Updates taken

| Date | What changed | Why |
|---|---|---|
| 17 Oct 2026 | `colors.css`, `semantic.css`, `elevation.css`, `dark.css`: status steps darkened to the reviewed Patient Journey v6 values (danger #B42318 with #8A1B12 and #FDECEA; warning #8F6204 text, #B27A06 accent, #F8EBCB and #FBF0D6 tints; success #127574 with #0E5E5D and #E3F3F2; a "low reading" pair #2B3A8F on #E8ECFB). New aliases: `--status-danger-strong`, `--status-warning-accent`, `--status-warning-bg-strong`, `--marker-low-fg`, `--marker-low-bg`. | The earlier danger, warning and success steps failed WCAG AA as text (4.0, 3.3 and 4.3 to 1). Approved by Khikar on 17 Oct as a design system update. The native tokens in `apps/patient-mobile` are regenerated with `pnpm theme`. |

## What was taken, and what was not

| File | Status |
|---|---|
| `colors.css` | verbatim |
| `semantic.css` | verbatim |
| `typography.css` | verbatim |
| `spacing.css` | verbatim |
| `motion.css` | verbatim |
| `dark.css` | verbatim, **not imported** |
| `radius.css` | verbatim, **not imported**, transcribed instead, see below |
| `elevation.css` | verbatim, **not imported**, transcribed instead, see below |
| `fonts.css` | not taken, see below |
| `base.css` | not taken, folded into `app/globals.css` |
| `index.css` | not taken, replaced by the import list in `app/globals.css` |

**`dark.css` is vendored but never imported.** The app is light only, so nothing
sets `data-theme="dark"` and the rules would never match. Keeping the file means
turning dark mode on later is wiring plus a one-line import, not a re-derivation.

## The two files that are transcribed rather than imported

`radius.css` and `elevation.css` both declare names inside a Tailwind namespace,
and importing them produces a specific kind of silent wrong: the *variable* takes
the design system's value while the *utility* keeps Tailwind's. `shadow-md` was
measurably in that state before this was caught, painting a neutral-black shadow
while `var(--shadow-md)` resolved to the navy-tinted one two lines away.

So both files are vendored for provenance but not imported, and their values are
declared in the `@theme` block in `app/globals.css`, where the utilities and the
variables come from one source. `pnpm check:tokens` fails if the two disagree, so
the duplication cannot rot quietly.

`--radius-*` needs one further adjustment. The design system calls the 8px step
`--radius-sm`; Tailwind's `--radius-*` namespace is what generates `rounded-sm`,
`rounded-md` and friends. The same ladder is therefore shifted one name, so the
physical sizes stay right for the components that consume them:

| Design system | Role | Tailwind utility here |
|---|---|---|
| `--radius-xs` 4px | small elements, chips | `rounded-sm` |
| `--radius-sm` 8px | inputs, buttons | `rounded-md` |
| `--radius-md` 12px | cards, modals | `rounded-lg` |
| `--radius-lg` 16px | sheets, menus | `rounded-xl` |
| `--radius-xl` 24px | large containers | `rounded-2xl` |
| `--radius-pill` | status badges | `rounded-pill` |

**`fonts.css` is not taken because it pulls Manrope and Inter from the Google
Fonts CDN.** `app/layout.tsx` loads the same two faces through `next/font`, which
self-hosts them, so there is no third-party request on the critical path and no
layout shift while they load. Same typefaces, better delivery.

`elevation.css` needs no renaming, only declaring in the right place.
`--inset-hairline` is the one value in it outside the `--shadow-*` namespace, so
it sits in the `:root` bridge instead.

**`base.css` is not taken wholesale** because parts of it duplicate Tailwind's
preflight and one rule contradicts it. Its element defaults live in the
`@layer base` block in `app/globals.css` instead, written against the same tokens.

## Four deliberate overrides to know about

`motion.css` and `typography.css` declare names Tailwind also owns. Both are
imported, and unlayered declarations beat Tailwind's `@layer theme`, so the
design system wins. That is the intent, but it means four familiar utilities
carry values other projects would not expect:

| Utility | Tailwind's value | What it means here |
|---|---|---|
| `ease-out` | `cubic-bezier(0, 0, .2, 1)` | `cubic-bezier(0, .55, .45, 1)` |
| `ease-in-out` | `cubic-bezier(.4, 0, .2, 1)` | `cubic-bezier(.45, 0, .55, 1)` |
| `tracking-tight` | `-0.025em` | `-0.02em` |
| `tracking-widest` | `0.1em` | `0.18em`, the `HEALTH` descriptor |

The rest of the surface was checked against compiled output rather than assumed:
`--space-*` does not collide with Tailwind's singular `--spacing`, `--weight-*`
does not collide with `--font-weight-*`, `--container-max` does not capture
`max-w-max`, and the `--text-*` semantic aliases generate no font-size utilities
because they live in `:root` rather than in `@theme`.

## Checks after an update

```bash
pnpm build          # the tokens compile and nothing references a dropped name
pnpm check:tokens   # the chart series and the transcribed values still hold
```

`pnpm check:tokens` does two things. It re-runs the colourblind-separation and
contrast validation on `--chart-1` through `--chart-5` against both grounds, and
it compares the transcribed radius and shadow values against the vendored files.
The five chart series are **not** from the design system, which specifies only a
primary and a secondary series colour; see the comment above them in
`app/globals.css`.
