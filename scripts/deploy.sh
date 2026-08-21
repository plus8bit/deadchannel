#!/usr/bin/env bash
# Deploys a shop and moves its alias to the deployment just made.
#
# The alias is the part that bites: a dashboard redeploy creates a new
# deployment but leaves a manually-set alias pointing at the old one, so the
# live URL silently keeps serving the previous build. Deploying and aliasing
# together removes the gap.
#
#   scripts/deploy.sh deadchannel
#   scripts/deploy.sh hosaka
set -euo pipefail

shop="${1:?usage: deploy.sh <deadchannel|hosaka>}"
case "$shop" in
  deadchannel) dir="."      ; alias_host="deadchannel.vercel.app"   ; build="build:fn" ;;
  hosaka)      dir="hosaka" ; alias_host="hosaka-agents.vercel.app" ; build="build:hosaka" ;;
  *) echo "unknown shop: $shop" >&2; exit 2 ;;
esac

echo "building $shop…"
npm run "$build" --silent

echo "deploying…"
url=$(cd "$dir" && vercel deploy --prod --yes 2>&1 | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)
[ -n "$url" ] || { echo "no deployment url returned" >&2; exit 1; }
echo "  $url"

echo "aliasing $alias_host…"
(cd "$dir" && vercel alias set "$url" "$alias_host" >/dev/null 2>&1)

echo "verifying…"
sleep 5
code=$(curl -sS -m 25 -o /dev/null -w '%{http_code}' "https://$alias_host/health")
echo "  https://$alias_host/health → $code"
[ "$code" = "200" ] || { echo "health check failed" >&2; exit 1; }
