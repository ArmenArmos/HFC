# DESIGN.md

Rules I follow every time I build UI in this repo. Written after auditing
`package.json`, `app/globals.css`, the vendored tokens under `styles/noreon/`,
and the existing components.

This file is downstream of `AGENTS.md`, not a replacement for it. Where the two
disagree, `AGENTS.md` wins, because it is the contract with the design and
clinical teams. Three rules below were decided against the grain of the design
system and are marked **[local decision]** with what they cost.

There is no `tailwind.config`. This is Tailwind v4: the theme is the `@theme`
block in `app/globals.css`, and that is the only place to add a token alias.

**Prototype v8.1 wins over this file.** Where this file and
`Noreon_Health_Zoe_Prototype_v8_1.html` disagree, the prototype wins (Khikar, 30
Oct 2026, `output/LEAD_DECISIONS_FOR_REVIEW.md`). Section 0 lists what that
changes. The rest of this file still holds wherever the prototype says nothing.

---

## 0. The prototype's look

Armen and Khikar want the product to look like prototype v8.1, not only do the
same things. So the member's Zoe chat now follows the prototype, and other member
screens move to it as they are touched. Until a screen moves, sections 1 to 5
describe it.

Three limits apply:

- **Prototype errors are never copied.** `output/ldl-pivot-2026-10-29/ERRATA.md`
  lists them (statin intensity labels, "at goal" from the threshold alone, the
  re-test window, the low-risk value, the baseline date). Take the look, not the
  medical content.
- **Text keeps 4.5:1**, checked with computed colours. The prototype's 60% white
  time on the blue bubble fails that, so the product keeps a solid white.
- **Touch targets stay 48 px.** Where the prototype paints a 44 px chip or send
  button, the target stays 48 px and a transparent border gives the painted size.
- **A card's "As shown at" line stays visible.** A card is a snapshot, and the
  line is a record-keeping statement. It sits under the card in small text, where
  the prototype has only a time.

| Topic | This file says | The prototype, which wins |
| --- | --- | --- |
| Colour | Navy dominant, teal accent, blue for text links only | One vivid blue for every action and for the member's own words: `--zoe-action`, `--zoe-action-ink`, `--zoe-tint`, ink `--zoe-ink`, canvas `--zoe-canvas` |
| Violet | No purple or indigo | Lavender for LDL, `--zoe-ldl` on white or `--zoe-ldl-wash`, per the 30 Oct decision |
| Type | Manrope for headings and every number | Inter for headings and numbers, 700 or 800, -0.02em (no tracking in Armenian) |
| Scale | The ladder, and extremes, never neighbours | Body 15 to 15.5, card title 16, greeting 18 to 22, small text 11.5 to 12.5 |
| Spacing | 8 px rhythm, 12 only inside controls | Gaps of 10, 12 and 14 are normal |
| Surfaces | Near-white stone page, 1 px borders | Borderless white on a cool grey canvas |
| Radii | Buttons 8, cards 12 | Pills for buttons and chips, cards 22 (`--zoe-card-radius`), bubbles 18, controls 14, composer 30 (`--zoe-pill-radius`) |
| Orb | Dark navy photo orb | Light pastel orb (`--zoe-orb`, `--zoe-orb-shadow`) |

The `--zoe-*` tokens live in `app/globals.css`, not under `styles/noreon/`,
because those files are vendored copies. Components still never write a hex.

---

## 1. Fonts

Three faces, already loaded and self-hosted through `next/font` in
`app/layout.tsx`. I never add a fourth and never import a font in a component.

| Role | Face | Token | Utility |
| --- | --- | --- | --- |
| Display | Manrope | `--font-display` | `font-heading` |
| Body | Inter | `--font-body` | `font-sans` |
| Mono | Geist Mono | `--font-mono` | `font-mono` |

Display carries headings, titles, and **every number**. The brand book assigns
Manrope "headings, numbers, titles", which is why `Stat` sets its value in
`font-heading tabular-nums` and not in the body face. A measurement set in Inter
is a bug, except on screens that have moved to the prototype's look (section 0),
where headings and numbers are Inter.

`Noto Sans Armenian` sits in both stacks after the Latin faces. It is not a
choice, it is glyph coverage: neither brand face ships Armenian, and the demo is
written in Armenian. A font stack resolves per character, so Latin still lands
on Manrope and Inter.

### Never use

**Roboto. Open Sans. Arial. `system-ui` as a deliberate choice.**

`system-ui` stays as the last fallback in `--font-display` and `--font-body`
because a fallback only paints when the webfont fails. Writing `font-[system-ui]`
or `font-sans` *meaning* the system stack is the banned thing.

**Inter is the exception to my own instinct here.** It is generic, and I would
normally ban it. It stays because it is brand-specified in
`styles/noreon/typography.css` from brand book p.12, and that file is vendored
byte for byte. Swapping it is an upstream conversation, not a local edit.

Never write a `font-family` in a component. There are exactly two family tokens.

---

## 2. Color

**One dominant, one accent.** Both as CSS variables, always.

| Role | Value | Token chain | Reach for |
| --- | --- | --- | --- |
| **Dominant** | Deep Navy `#222B56` | `--primary` -> `--action-primary-bg` -> `--noreon-navy-700` | `bg-primary`, `bg-brand-navy`, `text-strong` headings |
| **Accent** | Teal `#1A9695` | `--secondary` -> `--action-secondary-bg` -> `--noreon-teal-600` | `bg-brand-teal`, `text-brand-teal`, focus rings, section marks, `--chart-1` |

Teal is the accent because it already behaves like one: it owns the focus halo
(`--shadow-focus`), the `.section-head` dot, the `Eyebrow` rule, the title
gradient stroke in `DemoScreen`, and chart slot 1.

### Never write a hex, an `rgb()`, or a `px` radius in a component

Use a token. `:root` in `globals.css` declares no color of its own beyond the
`--zoe-*` tokens of section 0, only
aliases, so `--primary` resolves through `--action-primary-bg` to
`--noreon-navy-700`. A literal is a value that has stopped tracking the brand.

Prefer the semantic name over the ramp: `bg-card` over `bg-surface-card`,
`text-muted-foreground` over `text-slate`.

**Never name a `--noreon-*` ramp step directly in a component.** The ramps are
the design system's private vocabulary; the semantic aliases are its public one.
Reaching past the alias is how `text-[var(--noreon-danger-200)]` got written on
the landing page against a ramp that only has `600`, `400` and `50`. An
undefined custom property does not fail loudly: `color` falls through to the
inherited value, so the promo error message rendered in the same near-white as
the text around it and looked deliberate.

A `var()` typo is invisible in review and invisible in the browser. This is the
check that finds it, and it belongs in section 6:

```bash
comm -13 \
  <(grep -rhoE -- '--[a-zA-Z0-9-]+\s*:' app/globals.css styles/ | sed 's/[[:space:]]*:$//' | sort -u) \
  <(grep -rhoE 'var\(\s*--[a-zA-Z0-9-]+' app components --include='*.tsx' | sed -E 's/var\(\s*//' | sort -u)
```

### The error colour

| Ground | Use | Contrast |
| --- | --- | --- |
| The light page | `text-destructive` | 3.6:1 on stone |
| The navy `Panel` | `text-red-300` | 7.1:1 on navy |

`text-destructive` resolves through `--status-danger-fg` to the danger ramp, so
it is the semantic alias and it is the right default. It is also **3.4:1 on
navy**, which is below AA for body text, which is why the navy ground takes
Tailwind's `red-300` instead rather than the alias. Solid red is a `Button`
variant, `emergency`, and not something a call site paints.

### Gold is banned in new work **[local decision]**

`--noreon-gold-*`, `bg-brand-gold`, `text-brand-gold-deep`,
`--surface-subtle-gold`, `Panel tone="warm"`, `Medallion tone="gold"`,
`Eyebrow tone="gold"`, `--panel-glow-gold`, `--panel-warm`, and the gold wave
pairing are **not available to new UI**. Two hues, full stop.

The cost, stated plainly: the brand book assigns Warm Gold the premium and
achievement role, so this drops a semantic distinction the design system
intends, and it strands working code. Twenty-four files use gold today,
including `Panel`, `Medallion`, `Eyebrow`, `ApprovalBadge`, `DotField`,
`Illustration`, and the demo-data chip in `components/demo/screen.tsx`.

Those are **grandfathered, not broken**. I do not rip gold out of a file I am
visiting for another reason. The gold props stay on `Panel`, `Medallion`, and
`Eyebrow` so existing screens keep compiling. I simply never reach for them
again, and an achievement moment now reads through navy weight or teal accent
instead. This is worth raising upstream rather than leaving as a silent
divergence.

### The other hues are reserved, not spare

- **Blue** `--noreon-blue-600`: text links only, through `--text-link`. Never a
  fill, never a button, never a panel.
- **Red, amber, green**: reserved by the clinical layer for biomarker verdicts
  (`--marker-optimal-*`, `--marker-attention-*`, `--marker-out-*`) and status
  (`--status-*`). These carry clinical meaning. Never decorative.
- **Warm neutrals** (`--noreon-warm-*`, `--noreon-sand-*`): mostly dormant. The
  page ground moved from Soft Ivory to stone `#F6F5F2`, and `globals.css`
  re-pointed every border, track, and grid line back to the cool ramp to follow
  it. Do not reintroduce a sand hairline on the stone ground; it reads tan.

### No purple. No indigo. No gradient on white.

The prototype's lavender for LDL and AI, and its pastel orb, are the exceptions (section 0).

There is no purple or indigo anywhere in the palette, and I never introduce one.
Specifically banned: a purple or indigo gradient on a white or near-white
ground. It is the house style of every generic AI-generated page and it is not
this brand.

Gradients are allowed in exactly three sanctioned places, all of which are
already tokens and none of which sit on white:

- `--panel-inverse`, the navy panel ground with its light source in one corner.
- `--panel-glow`, the slow teal glow behind it.
- The teal-to-mint ramp: `--wave-teal-*`, `.brand-edge`, and the title stroke.

A new gradient needs a new token and a reason. Flat navy or a flat surface is
the default, and the page ground itself is deliberately flat.

---

## 3. Spacing and type scale

### 8px rhythm

Screens in the prototype's look use its own gaps and sizes (section 0).

The brand book is explicit: multiples of 8px. Tailwind v4's `--spacing` base is
4px, so **even-numbered utilities only** for layout.

```
gap-2  p-2   8px      gap-4  p-4  16px      gap-6  p-6  24px
gap-8  p-8  32px      gap-10     40px       gap-12     48px
gap-16     64px       gap-20     80px       gap-24     96px
```

Two sub-steps exist and are narrow exemptions, not general-purpose:

- **4px** (`gap-1`, `p-1`): icon-to-label gaps only. `--space-1` says so.
- **12px and 20px** (`gap-3`, `p-5`): inside a control or a chip only, never as
  section spacing. They are real tokens (`--space-3`, `--space-5`) but they break
  the rhythm if they set the distance between two blocks.

Section spacing is `space-y-8` (32px), which is what `DemoScreen` already sets.
Card padding is `--card-spacing`, 16px by default.

### Type scale: extremes, never neighbours **[local decision]**

The in-product ladder is brand-specified and I do not touch it:

```
overline  11px      body2    14px      h2       22px      display2  44px
caption   12px      body1    16px      h1       28px      display1  56px
                    h3       18px      display3 34px
```

The ratio is ~1.27, which is a gentle scale. Your rule is 3x jumps and weight
extremes. I get that **by composition, not by rewriting the ladder**: within one
visual block, the two type elements must land **3x apart or more**, and adjacent
steps must never touch.

```
GOOD   text-overline (11) + text-display1 (56)    5.1x
GOOD   text-caption  (12) + text-display2 (44)    3.7x
GOOD   text-overline (11) + text-display3 (34)    3.1x

BAD    text-h2 (22) next to text-h1 (28)          adjacent, 1.3x
BAD    text-body1 (16) next to text-h3 (18)       adjacent, 1.1x
BAD    text-caption (12) + text-h1 (28)           2.3x, not far enough
```

Rewriting the ladder to a literal 3x (12 / 36 / 108) was the alternative. It
would orphan `text-h2`, `text-h3`, and `text-body2`, and break all 22 demo
components, `Stat`, and `CardTitle`. Composition gets the same visual result at
no token cost.

**Weights: 200 or 800. Nothing between, in a display pairing.** Both faces are
variable (Manrope 200-800, Inter 100-900), so 200 is real, but `--weight-light`
is 300 and there is no 200 token. Use Tailwind's utilities: `font-extralight`
(200) and `font-extrabold` (800).

The hard limit on that rule, which I will not cross: **200 is for display sizes
only, 34px and up.** Body copy, labels, captions, and anything at 18px or below
keep their scale weights (400 to 600). Extralight 14px grey text on a stone
ground is unreadable, and this is a clinical product where someone is reading a
measurement that matters. Contrast and legibility outrank the aesthetic every
time. `text-h1` is 800 already, via the `@layer base` heading rules.

---

## 4. Components

**The library component is the default, and a variant is how it bends.**

Three rules, in order. They are first because every spacing and colour bug found
in this repo so far came from breaking one of them:

1. **If a primitive exists for the job, use it.** Not a `div` that looks like it.
   A notice is an `Alert`. A surface is a `Card`. A pressable is a `Button`.
2. **If the primitive is nearly right, add a variant to the primitive** and use
   it by name. `cva` is there for exactly this.
3. **Only then reach for `className`,** and only for layout: size, spacing,
   position. Never to repaint a variant at the call site.

4. **A role is not a behaviour.** Writing `role="radio"` on a `<button>`
   announces a radio to a screen reader and implements none of it. The
   questionnaire did exactly this, so every option was its own tab stop and the
   arrow keys did nothing, while the markup read as correct. If you find
   yourself typing `role=`, the primitive you want already exists.

The reason rule 3 is absolute is that `className` cannot be trusted to win.
`cn()` is tailwind-merge, and it dedupes within a modifier bucket, not across
one: `text-on-inverse` and `hover:text-foreground` are different buckets, so
both survive, and `:hover` outranks the plain class. A call site that overrode a
variant's resting colour and forgot its hover colour produced a button whose
label went black-on-navy under the cursor, and nothing in the diff looked wrong.
A variant sets every state together and cannot half-apply.

So: I do not hand-roll a button, a card, an alert, a dialog, a chart wrapper, or
a stat.

`cn()` from `@/lib/utils` merges classes. It is a patched `twMerge` that has
been taught the Noreon type scale, so `cn("text-overline", "text-muted-foreground")`
keeps both. Always use it, never template-string classes together.

### shadcn/ui primitives, `@/components/ui/*`

Style is `base-nova` on `@base-ui/react`, not Radix. Buttons take `render` and
`nativeButton={false}` for link composition, as `PrimaryAction` does.

| Import path | Exports |
| --- | --- |
| `@/components/ui/accordion` | `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` |
| `@/components/ui/alert` | `Alert`, `AlertTitle`, `AlertDescription`, `AlertAction`, `alertVariants` |
| `@/components/ui/avatar` | `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarGroup`, `AvatarGroupCount`, `AvatarBadge` |
| `@/components/ui/badge` | `Badge`, `badgeVariants` |
| `@/components/ui/button` | `Button`, `buttonVariants` |
| `@/components/ui/card` | `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardAction`, `CardDescription`, `CardContent` |
| `@/components/ui/chart` | `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle` |
| `@/components/ui/checkbox` | `Checkbox` |
| `@/components/ui/collapsible` | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` |
| `@/components/ui/dialog` | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`, `DialogOverlay`, `DialogPortal` |
| `@/components/ui/dropdown-menu` | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuGroup`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuPortal` |
| `@/components/ui/field` | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldLegend`, `FieldSeparator`, `FieldSet`, `FieldContent`, `FieldTitle` |
| `@/components/ui/input` | `Input` |
| `@/components/ui/input-otp` | `InputOTP`, `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator` |
| `@/components/ui/label` | `Label` |
| `@/components/ui/popover` | `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverHeader`, `PopoverTitle`, `PopoverDescription` |
| `@/components/ui/progress` | `Progress`, `ProgressTrack`, `ProgressIndicator`, `ProgressLabel`, `ProgressValue` |
| `@/components/ui/radio-group` | `RadioGroup`, `RadioGroupItem` |
| `@/components/ui/select` | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton` |
| `@/components/ui/separator` | `Separator` |
| `@/components/ui/skeleton` | `Skeleton` |
| `@/components/ui/slider` | `Slider`, `SliderControl`, `SliderTrack`, `SliderIndicator`, `SliderThumb`, `SliderValue` |
| `@/components/ui/sonner` | `Toaster` |
| `@/components/ui/switch` | `Switch` |
| `@/components/ui/table` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` |
| `@/components/ui/tabs` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `tabsListVariants` |
| `@/components/ui/textarea` | `Textarea` |
| `@/components/ui/tooltip` | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` |

#### Button variants

`default`, `outline`, `secondary`, `ghost`, `destructive`, `link`, plus two this
repo added, because this product has two grounds and the stock variants only
know about one:

| Variant | Where |
| --- | --- |
| `default` | The ordinary action on the light page. Navy. |
| `secondary` | The teal action. This **is** the teal button; do not rebuild it with `bg-brand-teal`. |
| `outline`, `ghost` | Light page only. Both resolve hover to `text-foreground`, which is near-black. |
| `outline-inverse`, `ghost-inverse` | The navy `Panel`. Use these there, always. |
| `ghost-muted` | A ghost whose label is secondary until you reach for it. |
| `destructive` | The quiet red: a tinted "remove this from the panel". |
| `emergency` | The loud red. Solid fill, one use: call an ambulance. |

`PrimaryAction` takes a `variant` prop and forwards it, so a screen action on the
navy ground asks for `secondary` or `outline-inverse` by name.

**Never put `outline` or `ghost` on the navy panel and patch it with
`text-on-inverse`.** That is the exact bug described above: the patch fixes the
resting state, the variant's `hover:text-foreground` survives the merge, and the
label turns black under the cursor.

#### Every other primitive that knows about the two grounds

The navy `Panel` is not a theme, so nothing cascades onto it. Each primitive
that can sit there carries the ground as a variant, and the call site names it:

| Primitive | Inverse form |
| --- | --- |
| `Input`, `Textarea` | `variant="inverse"` |
| `Table` | `variant="inverse"` on the `Table`, not on each row |
| `DropdownMenuContent`, `DropdownMenuItem` | `variant="inverse"` |
| `Badge` | `inverse`, `inverse-strong`, `inverse-success` |
| `Button` | `outline-inverse`, `ghost-inverse` |

Patching any of these with `text-on-inverse` at the call site is the bug in
section 4, not a shortcut around it.

#### Badge tones

`default`, `secondary`, `muted`, `outline`, `outline-muted`, `teal`, `success`,
`warning`, `attention`, `danger`, `gold`, and the three inverse forms above.
`BadgeVariant` is exported so a tone map elsewhere can be typed against it, the
way `PROGRESS_TONE` and `PRIORITY_TONE` are.

The shape is the house pill, not the stock base-nova one, because twenty
hand-rolled pills had independently agreed on `text-overline px-2.5 py-1
rounded-pill` and the primitive was the only thing disagreeing. When the whole
product converges on something, the primitive is what moves.

#### Cards that are controls

`RadioGroupCard` and `CheckboxCard` are the large tappable option cards. They
exist because the stock `RadioGroupItem` is the dot, meant to sit beside a
label, and this product needs the whole box to be the target with a wrapping
sentence inside it. Wrapping the stock item in a `<label>` does not work:
`Radio.Root` renders a `<button>`, a button is not a labelable element, so the
label forwards nothing.

#### Alert variants

`default`, `success`, `warning`, `info`, `destructive`. The status variants use
the reserved status tokens, so a notice moves with the status palette rather
than with a brand ramp.

**A notice is an `Alert`. A one-word status is a pill.** That is the whole rule,
and getting it backwards is what produced a 999px radius bowed around three
lines of prose. `rounded-pill` is correct for `Active`, `Optional`, `Required by
your plan`. It is wrong for anything that can wrap. If the text is a sentence,
it is an `Alert`.

`AlertTitle` takes `as` (`h2`/`h3`/`h4`) for the case where the notice is also a
section landmark, so converting a heading into an alert does not drop it out of
the document outline.

### Brand components, `@/components/brand/*`

These are the repo's own vocabulary and they are the reason two screens look
like one product. Reach for these before composing anything from scratch.

| Import path | Exports | Use it for |
| --- | --- | --- |
| `@/components/brand/panel` | `Panel`, `Eyebrow` | The navy ground, for the moments that need weight: a verdict, a summary, the close of a loop. `Eyebrow` is the labelled rule above a heading. |
| `@/components/brand/stat` | `Stat` | Any measurement. Display face, tabular, overline label above, unit dropped to caption beside. Never set a number by hand. |
| `@/components/brand/medallion` | `Medallion` | The ground an icon sits in. Tones `teal`, `navy`, `inverse`, `danger`. A bare lucide glyph on the page has no weight. |
| `@/components/brand/dot-field` | `DotField` | The brand wave, redrawn from tokens so it scales and takes the palette. |
| `@/components/brand/illustration` | `Illustration` | Named illustrations, including the `locked` empty state. |

### Demo and product components, `@/components/demo/*`

| Import path | Exports |
| --- | --- |
| `@/components/demo/screen` | `DemoScreen`, `PrimaryAction`, `useScreenPayload` |
| `@/components/demo/demo-shell` | `DemoShell` |
| `@/components/demo/doctor-shell` | `DoctorShell`, `DoctorPanel`, `AiDraft`, `ReturnToMember` |
| `@/components/demo/trend-chart` | `TrendChart`, `ChartSummary`, `formatMinutes` |
| `@/components/demo/metric-trajectory` | `MetricTrajectory` |
| `@/components/demo/range-selector` | `RangeSelector`, `DashboardRangeSelector`, `RANGE_LABEL` |
| `@/components/demo/derived-metrics` | `DerivedMetrics` |
| `@/components/demo/clinical-monitor` | `ClinicalMonitor` |
| `@/components/demo/patient-context` | `PatientContext` |
| `@/components/demo/field-control` | `FieldControl`, `BloodPressureField`, `ScaleField` |
| `@/components/demo/option-list` | `SingleChoice`, `MultiChoice` |
| `@/components/demo/observation-scale` | `ObservationScale` |
| `@/components/demo/triage-scale` | `TriageScale` |
| `@/components/demo/voice-answer` | `VoiceAnswer` |
| `@/components/demo/prose` | `T`, `Points`, `Section` |
| `@/components/demo/urgency-badge` | `UrgencyBadge` |
| `@/components/demo/approval-badge` | `ApprovalBadge` |
| `@/components/demo/connect-health` | `ConnectHealthCard` |
| `@/components/demo/translator` | `Translator` |
| `@/components/demo/locale-toggle` | `LocaleToggle` |
| `@/components/demo/presenter-bar` | `PresenterBar` |
| `@/components/demo/landing` | `Landing` |
| `@/components/marketing/marketing-chrome` | `MarketingChrome` |
| `@/components/marketing/login-panel` | `LoginPanel` |

### Motion is already built

`globals.css` ships the arrival sequence. I use these rather than writing
keyframes: `rise-group` on a stack, `rise` with `--rise` for one element,
`fade-in-slow`, `extend` for a filling scale, `draw` for a stroked path, `sweep`
for the wave, `breathe` for the panel glow, `press` on a pressable, `lift` on a
hoverable card. All of it is opacity and transform only, and the whole layer is
switched off under `prefers-reduced-motion`.

---

## 5. Forbidden

### Three rounded cards in a row

The universal filler layout. A `grid-cols-3` of equal cards says every item has
equal weight, which is almost never true, and it is what a page looks like when
no one decided what mattered.

Instead: make one item dominant and let the others be secondary. An asymmetric
split (`grid-cols-[2fr_1fr]`), a list with a lead item, a `Panel` carrying the
headline number with quiet `Stat`s beneath it. If three things genuinely are
peers, a bordered list or a `Table` is more honest than three cards.

Nine existing sites use `sm:grid-cols-3` or `lg:grid-cols-3`, including
`dashboard`, `care/activity`, `care/nutrition`, `care/progress`, `booking`,
`devices`, `landing`, and `derived-metrics`. Those are grandfathered. I fix one
when I am already changing it for another reason, and I never add a tenth.

### Centered-everything heroes

Center-aligned eyebrow, center-aligned headline, center-aligned paragraph,
center-aligned button, all stacked down the middle of the viewport. Centered
text has no edge to return to, so long copy gets harder to read with every line.

Instead: left-align to a real column and let the asymmetry carry the composition.
`DemoScreen` already does this correctly, with the teal rule down the left edge
of every title anchoring the column. `text-center` is for a short empty state or
a single-line confirmation, like `LockedScreen`, and nothing wider.

### 0.1-opacity drop shadows on everything

A faint black shadow under every element flattens the page instead of layering
it: if everything floats, nothing does. Neutral black shadows are also wrong
here on their own, since Noreon shadows are navy-tinted.

The house rule from `styles/noreon/elevation.css`: **a card is defined by its
hairline first and its shadow second.** A border or `ring-1` does the separating.
Most surfaces need no shadow at all.

When one is genuinely earned, it comes from the ladder, never hand-authored:
`shadow-[var(--shadow-xs)]` through `shadow-[var(--shadow-lg)]`, or Tailwind's
`shadow-sm`/`shadow-md`/`shadow-lg`, which are mapped onto the same navy-tinted
values in the `@theme` block. `--shadow-lg` is reserved for something genuinely
lifted: an open dialog, a popover, a `lift` hover. Never a static card.

Never write `shadow-[0_2px_8px_rgba(0,0,0,0.1)]`.

### Padding on a `CardContent`

`Card` owns its own vertical padding (`py-(--card-spacing)`, 16px) and
`CardContent` owns the horizontal (`px-(--card-spacing)`). The card is already
correctly padded on all four sides the moment you open the tag. Adding `pt-6` is
not a correction, it is 24px on top of the 16px that is already there.

The reason this is worth a rule: **in the old shadcn card, `CardContent` shipped
as `p-6 pt-0`,** because `CardHeader` supplied the top padding. Using a
`CardContent` without a `CardHeader` genuinely did need `pt-6` back. That idiom
is in every old tutorial and every model's training data, and it was on 54
`CardContent` in this repo, putting 40px of dead space above the content of
almost every card in the product. It has been removed. Do not paste it back.

If a card genuinely needs different padding, set `--card-spacing` on the `Card`,
which is what it is for. Do not patch the child.

### A hand-rolled notice, chip, or button

A `div` with a status background, a border, a radius and an icon is an `Alert`
that has not been imported. `components/ui/alert.tsx` sat unused at **0 imports**
while ten hand-rolled versions of it accumulated across the app, each with its
own padding and radius, which is the entire reason two notices on one screen did
not match.

Before writing a container with `bg-[var(--status-…)]`, check whether the thing
you are building already exists in `@/components/ui`. It usually does.

### A `div` with `style={{ width }}` where `Progress` belongs

A bar that is 60% wide looks finished and announces nothing: no role, no value,
no maximum. Four of these existed before `components/ui/progress.tsx` was first
imported. `Progress` takes `value`, `size` (`sm`/`default`/`lg`) and `tone`
(`default`/`teal`/`attention`), and composes its own track, so the colours are
variants rather than a `trackClassName` escape hatch.

The exception is a bar that is not a progress bar. The biomarker range on the
landing page has a limit tick and a marker dot; it is a chart, and `Progress`
would be a lie about what it measures.

### A raw `white` or `black` on the navy ground

`text-white/70` and `bg-white/10` are literals. The tokens are `text-on-inverse`,
`text-on-inverse-muted` and `bg-surface-inverse`, and in the shipped light-only
theme they resolve to exactly the same pixels, so the swap costs nothing today
and is the difference between a surface that tracks the design system and one
that has quietly stopped.

The genuine exception is a scrim over photography. `bg-black/45` on the video
call is black because it is darkening a video, not because it is theming a
surface, and a token there would be the wrong idea.

### And the standing bans from AGENTS.md

- Never hand-edit anything under `styles/noreon/` or `docs/clinical/`. They are
  copies, and taking an update is a file replacement.
- Never test a clinical threshold in a component. A screen asks the engine and
  renders the answer.
- Copy is second person, sentence case, no exclamation marks, no emoji, **no em
  dashes**. Never "patient" or "user"; say "you" or "member". Buttons name what
  happens, so "See my risk picture", never "Submit".

---

## 6. Before I call UI done

```bash
pnpm check:tokens     # after touching any colour
pnpm check:clinical   # after touching the questionnaire or the rules
pnpm lint
npx tsc --noEmit
```

And the two greps that catch what none of those can, because a dead class and a
dead custom property are both silent: the undefined-`var()` check above, and a
sweep for class names that are not in the `@theme` block at all. `text-h4` was
on twenty-nine headings and had never existed.
