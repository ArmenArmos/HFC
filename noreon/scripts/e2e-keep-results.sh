#!/bin/sh
# Copies one suite's reports out of e2e/.state before the next suite clears them. Leaves the seeded
# passwords and local keys (accounts.json, env.json) behind.
dest="$ARTIFACTS/$1"
mkdir -p "$dest"
for item in results results.json app.log blocked.log; do
  [ -e "e2e/.state/$item" ] && cp -R "e2e/.state/$item" "$dest/"
done
rm -f e2e/.state/results.json e2e/.state/app.log
exit 0
