# Patient app addresses

- `app.noreon.health`: Vercel `noreon-core` production environment. Patient app release is still pending; current main contains the informational website.
- `staging.noreon.health`: Vercel `noreon-core` Preview, tracking `feat/patient-webapp`. Retain preview deployment protection.
- `noreon.health` / `www.noreon.health`: existing informational website.

Both app subdomain roots redirect to `/patient` in the patient app branch. Other routes keep their existing authentication rules.

## DNS

Authoritative nameservers are GoDaddy `ns37.domaincontrol.com` / `ns38.domaincontrol.com`. Vercel supplied these records on 7 October 2026:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | app | f7386fae5cc944eb.vercel-dns-017.com |
| CNAME | staging | f7386fae5cc944eb.vercel-dns-017.com |

Records have not yet been added. Do not change the apex, www, mail records or nameservers.

## Before offering registration

Staging must use `noreon-staging` Supabase project `homqzwzrskgnizbycvhq`; production must use `noreon-production` project `makyulcjgqffiuzbhyte`. Verify deployment environment variables and apply schema through the existing GitHub Actions workflow. Neither hosted patient persistence nor real SMS delivery has yet been verified. Configure the SMS provider, CAPTCHA and consent text before pilot release.

## Demonstration retired

The fictional demonstration (`NEXT_PUBLIC_PATIENT_DEMO=true`, `demo.noreon.health`) was removed on 18 October 2026. The app reads neither `NEXT_PUBLIC_PATIENT_DEMO` nor `NOREON_DEMO_SECRET` for the member app any more, `/patient` on `noreon.health` and `www.noreon.health` redirects to app.noreon.health, and `demo.noreon.health` returns 404 for it.
