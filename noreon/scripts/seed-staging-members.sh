#!/bin/bash
# Fictional members for the staging site. Refuses every database but noreon-staging (ref fixed here).
# Reads the staging database password from the Keychain (supabase-staging-db-password); prints nothing secret.
set -euo pipefail
REF=homqzwzrskgnizbycvhq
cd "$(dirname "$0")/.."
export PGPASSWORD=$(security find-generic-password -a noreon -s supabase-staging-db-password -w)
exec "${PSQL:-psql}" "host=aws-0-eu-central-1.pooler.supabase.com port=5432 user=postgres.$REF dbname=postgres sslmode=require" -X -f scripts/seed-staging-members.sql
