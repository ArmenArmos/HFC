# Staff navigation responsiveness

Authorized inline execution after diagnosis: reduce duplicate auth, fetch only required data, parallelize necessary directory lookups, keep navigation mounted and show immediate loading feedback.

- Use React cache for getStaff within one server render/request, retaining host, session, active role and clinic checks. No shared cross-request identity cache; proxy and page/action guards remain.
- Cases/overview load operational data without doctor-email lookups. Doctors/clinics load directory data only; doctors alone resolve emails, concurrently.
- Put protected staff pages under a shared route-group layout. Every protected page retains its own role guard. Keep the login and standalone API endpoints outside the layout. Preserve all public URLs.
- Add workspace loading feedback inside the persistent shell, and pending navigation feedback on clicked links. No cached health records or security reductions.
- Test loader selection and email concurrency/omission, existing role/queue/workflow behavior, typecheck/lint/build, and browser navigation on local shared fictional workspaces if available. Report actual coverage and avoid claiming a measured production speedup without measurements.
