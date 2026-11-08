# Hosted database audit plan

1. Write failing pure tests for configuration/target validation, report shape, expected migration history, unsafe findings and sanitized failures.
2. Add a fixed SQL metadata-only READ ONLY transaction with strict deadlines and JSON output. Verify it on the isolated replay and introduce rolled-back ACL/RLS fixtures to prove findings are detected.
3. Implement a built-in-only Node/psql runner: credentials in child environment, no raw stderr/stdout leakage, bounded output/time, strict selected report parsing, summary and failing exit when critical checks or version parity fail.
4. Add main-only manual workflow in the production environment using existing DB secrets and fixed pooler host. Add operation notes. No hosted query until reviewed/merged.
5. Run relevant local/CI checks, get Claude boundary review, merge exact verified head, dispatch main and record observed hosted metadata or sanitized failure. Do not mutate hosted settings.
