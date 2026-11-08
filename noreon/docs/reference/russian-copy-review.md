# Russian UI copy: status and review

Khikar, 22 Oct 2026: Russian is a third UI language for the member app and the staff and clinic
backoffices. Clinical text stays Armenian (or English).

## Status: unapproved v1

Every Russian string in the app is a machine-drafted first version (`RU_COPY_STATUS = 'unapproved-v1'`
in `lib/locale.ts`). It has had an engineering pass for medical-UI terms and consistency, not a
native or clinical review. Before real Russian-speaking members use it:

1. A native Russian speaker reviews the member screens (Home, Questions, Results, Care, Medicines,
   Zoe, Profile) and the urgent and red-flag wording.
2. The clinical owner (Armen or Yesayi) confirms the questionnaire and safety wording in Russian,
   the same way the Armenian wording was confirmed.
3. Then set `RU_COPY_STATUS` to the approved version and record it in `output/GO_LIVE_GATES.md`.

## What gets Russian

- Every UI string that has an Armenian version: member app (app.noreon.health and the PWA), doctor
  and nurse backoffice, clinic portal, staff sign-in and recovery.
- Admin screens that are English only today stay English.

## What stays Armenian (or English) for Russian readers

`clinicalLocale()` in `lib/locale.ts` maps `ru` to `hy` for these:

- Health summaries, AI care-plan text, GP reports, doctor-approved clinical text, lesson bodies
  that only exist in Armenian and English.
- Telegram and system message templates. `profiles.locale` stays `hy`/`en`; a Russian choice is
  stored in `profiles.ui_locale`, so every message and template lookup in SQL keeps working and
  sends Armenian. Zoe already replies in the member's language and is unchanged.

## Glossary used in v1

| English | Russian |
| --- | --- |
| member | участник |
| care team | медицинская команда |
| doctor / nurse | врач / медсестра |
| blood pressure | артериальное давление (short: давление) |
| home readings | домашние измерения |
| lab tests | анализы |
| questionnaire | анкета |
| care plan | план лечения |
| visit / consultation / booking | визит / консультация / запись |
| medicine / dose / skip | лекарство / доза / пропустить |
| red flag (staff) | тревожный признак |
| ambulance 103 | скорая помощь (103) |

Style: lowercase «вы», sentence case, «» quotes, no exclamation marks, emoji or dashes as punctuation.

## Guard

`pnpm check:ru` (`scripts/check-ru-copy.ts`) fails when a UI file has more Armenian than Russian
string literals or an Armenian-only ternary. The type checker catches a missing Russian argument or
key wherever copy goes through `tx`, `copy`, `st`, `pick` or a `Record<Locale, ...>`.
