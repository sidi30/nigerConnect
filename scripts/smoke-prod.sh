#!/usr/bin/env bash
# =============================================================================
# NigerConnect — production smoke test
# =============================================================================
# Run AFTER each deploy and before submitting to the stores. Verifies:
#   - All public URLs declared in Play Console / App Store Connect resolve 200
#   - The API health endpoints respond OK on db + redis
#   - The .well-known files have the right Content-Type
#
# Exits non-zero if any check fails so you can wire it into a CI step:
#   ./scripts/smoke-prod.sh https://nigerconnect.sahabiguide.com https://api-nigerconnect.sahabiguide.com
# =============================================================================

set -euo pipefail

WEB_BASE="${1:-https://nigerconnect.sahabiguide.com}"
API_BASE="${2:-https://api-nigerconnect.sahabiguide.com}"

C_OK=$'\e[32m'; C_ERR=$'\e[31m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
fail=0

check_status() {
  local url="$1" expected="${2:-200}"
  local code
  code=$(curl -fso /dev/null -w "%{http_code}" "$url" || echo "000")
  if [[ "$code" == "$expected" ]]; then
    echo -e "${C_OK}✓${C_RST} $url ${C_DIM}→ $code${C_RST}"
  else
    echo -e "${C_ERR}✗${C_RST} $url → expected $expected, got $code"
    fail=$((fail + 1))
  fi
}

check_header() {
  local url="$1" header="$2" expected="$3"
  local actual
  actual=$(curl -fsI "$url" | grep -i "^${header}:" | head -1 | sed 's/\r$//' | cut -d: -f2- | xargs)
  if [[ "$actual" == "$expected"* ]]; then
    echo -e "${C_OK}✓${C_RST} $url ${C_DIM}[${header}: $actual]${C_RST}"
  else
    echo -e "${C_ERR}✗${C_RST} $url [${header}] expected '$expected', got '$actual'"
    fail=$((fail + 1))
  fi
}

check_json_field() {
  local url="$1" field="$2" expected="$3"
  local val
  val=$(curl -fsS "$url" | grep -oE "\"$field\"\s*:\s*\"[^\"]*\"" | head -1 | sed -E "s/.*\"$field\"\s*:\s*\"([^\"]*)\".*/\1/")
  if [[ "$val" == "$expected" ]]; then
    echo -e "${C_OK}✓${C_RST} $url ${C_DIM}[$field=$val]${C_RST}"
  else
    echo -e "${C_ERR}✗${C_RST} $url [$field] expected '$expected', got '$val'"
    fail=$((fail + 1))
  fi
}

echo "-- Public web pages (legal + utilitaires) --"
for path in / privacy terms community account-deletion verify-email reset-password support sitemap.xml robots.txt; do
  check_status "$WEB_BASE/$path"
done

echo
echo "-- Universal Links / App Links --"
check_header "$WEB_BASE/.well-known/apple-app-site-association" "Content-Type" "application/json"
check_header "$WEB_BASE/.well-known/assetlinks.json" "Content-Type" "application/json"

echo
echo "-- Security headers --"
check_header "$WEB_BASE/" "X-Frame-Options" "DENY"
check_header "$WEB_BASE/" "X-Content-Type-Options" "nosniff"
check_header "$WEB_BASE/" "Strict-Transport-Security" "max-age=31536000"

echo
echo "-- API health --"
check_status "$API_BASE/health/live"
check_status "$API_BASE/health/ready"
check_json_field "$API_BASE/health/ready" "status" "ok"

echo
if [[ "$fail" -eq 0 ]]; then
  echo -e "${C_OK}OK - all checks passed${C_RST}"
  exit 0
else
  echo -e "${C_ERR}FAIL - $fail check(s) failed${C_RST}"
  exit 1
fi
