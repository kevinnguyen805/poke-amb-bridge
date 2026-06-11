#!/usr/bin/env bash
# Synthetic cold-installer acceptance test, run against PROD.
#
# Simulates the full journey of a brand-new recipe installer the way Poke's
# client and the v2.2 Shortcut actually behave: keyless MCP handshake with an
# auto-injected x-poke-user-id, setup_save_to_poke mint, /setup page render,
# Shortcut download, the Shortcut's exact ingest POST (string `tags`, key-only
# auth), scoped read-back, and the failure paths the Shortcut's error alert
# depends on. What it CANNOT cover: Poke's own client UX on a second account
# (recipe-install duplicates, conversational routing) and on-device iOS import.
#
# Usage: scripts/accept-cold-install.sh [expected-shortcut-sha256]
set -u
BASE="https://poke-amb-bridge.vercel.app"
UID_TEST="$(uuidgen | tr 'A-Z' 'a-z')"
EXPECTED_SHA="${1:-}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "cold installer uid: $UID_TEST"

mcp() { # method, params-json, extra curl args...
  local method="$1" params="$2"; shift 2
  curl -s "$BASE/mcp" -X POST -H 'content-type: application/json' "$@" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}"
}

echo "[1] keyless initialize (what Poke does on connect)"
INIT=$(mcp initialize '{}')
echo "$INIT" | grep -q '"instructions"' && ok "initialize returns instructions" || bad "no instructions: $INIT"
echo "$INIT" | grep -q 'TROUBLESHOOTING' && ok "troubleshooting facts present" || bad "troubleshooting missing"

echo "[2] setup_save_to_poke with only the injected user id (keyless recipe installer)"
SETUP=$(mcp tools/call "{\"name\":\"setup_save_to_poke\",\"arguments\":{}}" -H "x-poke-user-id: $UID_TEST")
TOKEN=$(echo "$SETUP" | grep -o 'spk_[A-Za-z0-9_-]*\.[a-f0-9]*' | head -1)
[ -n "$TOKEN" ] && ok "minted token" || bad "no token minted: $SETUP"
echo "$SETUP" | grep -q "/setup?k=" && ok "setup link present" || bad "no setup link"
echo "$SETUP" | grep -q "Current Shortcut version" && ok "version stated in setup text" || bad "version missing from setup text"

echo "[3] keyless data tool with injected uid must NOT wedge (-32001)"
LIST=$(mcp tools/call '{"name":"list_links","arguments":{}}' -H "x-poke-user-id: $UID_TEST")
echo "$LIST" | grep -q '\-32001' && bad "wedged with -32001: $LIST" || ok "no auth wedge"

echo "[4] /setup page renders for the minted token"
PAGE=$(curl -s "$BASE/setup?k=$TOKEN")
echo "$PAGE" | grep -q "Get the Shortcut" && ok "setup page renders" || bad "setup page broken"
echo "$PAGE" | grep -q "Current version" && ok "version marker on page" || bad "no version marker"

echo "[5] shortcut download"
SHA=$(curl -s "$BASE/save-to-poke.shortcut" | shasum -a 256 | cut -d' ' -f1)
if [ -n "$EXPECTED_SHA" ]; then
  [ "$SHA" = "$EXPECTED_SHA" ] && ok "shortcut sha matches expected" || bad "sha mismatch: $SHA"
else
  echo "  INFO: shortcut sha256 $SHA (no expected value supplied)"
fi

echo "[6] the Shortcut's exact POST (key-only auth, string tags)"
SAVE=$(curl -s -X POST "$BASE/links/ingest" -H "x-poke-key: $TOKEN" -H 'content-type: application/json' \
  -d "{\"url\":\"https://example.com/cold-install-$UID_TEST\",\"tags\":\"shortcut\"}" -w '\n%{http_code}')
CODE=$(echo "$SAVE" | tail -1)
[ "$CODE" = "201" ] && echo "$SAVE" | grep -q '"saved"' && ok "ingest 201 with saved body" || bad "ingest failed: $SAVE"

echo "[7] scoped read-back: the new user sees their link"
LIST2=$(mcp tools/call '{"name":"list_links","arguments":{}}' -H "x-poke-user-id: $UID_TEST")
echo "$LIST2" | grep -q "cold-install-$UID_TEST" && ok "link visible to its owner" || bad "link missing: $LIST2"

echo "[8] isolation: a different uid cannot see it"
OTHER=$(mcp tools/call '{"name":"list_links","arguments":{}}' -H "x-poke-user-id: $(uuidgen | tr 'A-Z' 'a-z')")
echo "$OTHER" | grep -q "cold-install-$UID_TEST" && bad "LEAK across users" || ok "no cross-user leak"

echo "[9] failure paths the Shortcut's error alert depends on"
T401=$(curl -s -X POST "$BASE/links/ingest" -H "x-poke-key: ${TOKEN}tampered" -H 'content-type: application/json' -d '{"url":"https://example.com/x"}' -w '%{http_code}' -o /dev/null)
[ "$T401" = "401" ] && ok "tampered key -> 401" || bad "tampered key -> $T401"
T400=$(curl -s -X POST "$BASE/links/ingest" -H "x-poke-key: $TOKEN" -H 'content-type: application/json' -d '{}')
echo "$T400" | grep -q '"error":"url required"' && ok "empty body -> error text for the alert" || bad "unexpected 400 body: $T400"
TANON=$(curl -s "$BASE/mcp" -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_links","arguments":{}}}')
echo "$TANON" | grep -q '\-32001' && ok "fully-anonymous probe still rejected" || bad "anonymous probe allowed: $TANON"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
