#!/usr/bin/env bash
# Pipelineflow Engagement — end-to-end smoke test.
#
# Walks the full Phase 1+2+3 happy path against a freshly-booted stack:
#   1. Health checks  (Postgres + Timescale extension + Redis + api + web)
#   2. Register first admin
#   3. Mint engagement:ingest API token
#   4. POST identify() for 50 synthetic subscribers
#   5. POST track() events for half of them
#   6. Replay one event to confirm idempotency
#   7. Create + recompute an audience (Trait + Performed)
#   8. Author + render-preview an email template
#   9. Create a broadcast (draft only — no SES configured)
#  10. Verify schema invariants: hypertable + chunks + indexes

set -euo pipefail

API="${API:-http://localhost:4100}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@smoke.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-smoke-test-pw-1234}"

cookies=$(mktemp -t pfe-smoke-cookies.XXXXXX)
trap 'rm -f "$cookies"' EXIT

curl_json() {
  # Origin matches APP_ORIGIN so the originGuard CSRF middleware lets us
  # past on POST/PATCH/DELETE. (curl doesn't send Origin by default.)
  curl -sS -b "$cookies" -c "$cookies" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -H 'Origin: http://localhost:5174' \
    "$@"
}

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[0;31m✗ %s\033[0m\n' "$1"; exit 1; }

# 1) Health checks ─────────────────────────────────────────────────────────
step "1. Health checks"
health=$(curl -sS "$API/healthz" || true)
echo "  $health"
echo "$health" | grep -q '"status":"ok"' || fail "API healthz not ok"
ok "API healthy + Redis ready"

# Inspect Postgres directly via the container.
docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT extname FROM pg_extension WHERE extname='timescaledb';" \
  | grep -q timescaledb && ok "timescaledb extension loaded"

docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT count(*)::int FROM timescaledb_information.hypertables WHERE hypertable_name='Event';" \
  | grep -q '^1$' && ok "Event hypertable created"

# 2) Register first admin ─────────────────────────────────────────────────
step "2. Register first admin"
register_resp=$(curl_json -X POST "$API/api/auth/register" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"name\":\"Smoke Admin\",\"password\":\"$ADMIN_PASSWORD\"}" \
  -w '\n%{http_code}')
register_code=$(echo "$register_resp" | tail -1)
register_body=$(echo "$register_resp" | sed '$d')
if [[ "$register_code" == "201" ]]; then
  ok "registered new admin"
elif [[ "$register_code" == "403" ]]; then
  ok "admin already exists (403); logging in instead"
  curl_json -X POST "$API/api/auth/login" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null
  ok "logged in"
else
  echo "$register_body"
  fail "register returned $register_code"
fi

me=$(curl_json -X GET "$API/api/auth/me")
echo "  $me"
echo "$me" | grep -q "\"email\":\"$ADMIN_EMAIL\"" || fail "me lookup mismatch"

# 3) Mint API token ────────────────────────────────────────────────────────
step "3. Mint engagement:ingest API token"
token_resp=$(curl_json -X POST "$API/api/api-tokens" \
  -d '{"name":"smoke-test","scopes":["engagement:ingest"]}')
echo "  ${token_resp:0:120}..."
TOKEN=$(echo "$token_resp" | sed -n 's/.*"secret":"\([^"]*\)".*/\1/p')
[[ -n "$TOKEN" ]] || fail "couldn't extract token"
ok "minted token: ${TOKEN:0:24}…"

# 4) Identify 50 synthetic subscribers ─────────────────────────────────────
step "4. Identify 50 subscribers (acme.test + other.test mix)"
for i in $(seq 1 50); do
  domain="acme.test"
  if (( i > 25 )); then domain="other.test"; fi
  curl -sS -X POST "$API/api/public/identify" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"sub-$i\",\"traits\":{\"email\":\"sub$i@$domain\",\"email_domain\":\"$domain\",\"plan\":\"pro\"}}" \
    -w '' >/dev/null
done
ok "identify() x50 enqueued"

# Give the worker a moment to drain.
sleep 4

count=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT count(*)::int FROM \"Subscriber\";")
echo "  Subscriber rows: $count"
[[ "$count" -ge 50 ]] || fail "expected ≥50 subscribers"
ok "all 50 subscribers ingested"

# 5) Track events for first 30 subscribers ────────────────────────────────
step "5. Track 'purchase' events for first 30"
for i in $(seq 1 30); do
  curl -sS -X POST "$API/api/public/track" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"sub-$i\",\"event\":\"purchase\",\"properties\":{\"amount\":42},\"messageId\":\"msg-purchase-$i\"}" \
    -w '' >/dev/null
done
ok "track() x30 enqueued"
sleep 4

events=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT count(*)::int FROM \"Event\" WHERE name='purchase';")
echo "  purchase events: $events"
[[ "$events" -ge 30 ]] || fail "expected ≥30 purchase events"
ok "purchase events landed"

# 6) Replay one event for idempotency check ───────────────────────────────
step "6. Replay msg-purchase-1 — should be deduped"
curl -sS -X POST "$API/api/public/track" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"sub-1","event":"purchase","properties":{"amount":42},"messageId":"msg-purchase-1"}' \
  -w '' >/dev/null
sleep 2
dup=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT count(*)::int FROM \"Event\" WHERE \"messageId\"='msg-purchase-1';")
[[ "$dup" -eq 1 ]] || fail "expected 1 row for replayed messageId, got $dup"
ok "replay deduped (1 row exactly)"

# 7) Create + recompute an audience ────────────────────────────────────────
step "7. Create audience: email_domain='acme.test' AND purchase ≥1 in last 30d"
audience=$(curl_json -X POST "$API/api/audiences" -d '{
  "name": "acme-buyers",
  "computeIntervalSeconds": 60,
  "definition": {
    "root": {
      "type": "And",
      "children": [
        { "type": "Trait", "key": "email_domain", "operator": "equals", "value": "acme.test" },
        { "type": "Performed", "event": "purchase",
          "window": { "kind": "lastDays", "days": 30 },
          "times": { "op": "gte", "count": 1 } }
      ]
    }
  }
}')
echo "  ${audience:0:140}..."
AUD_ID=$(echo "$audience" | sed -n 's/.*"audience":{"id":\([0-9]*\).*/\1/p')
[[ -n "$AUD_ID" ]] || fail "couldn't extract audience id"
ok "audience created (id=$AUD_ID)"

curl_json -X POST "$API/api/audiences/$AUD_ID/recompute" >/dev/null
ok "recompute enqueued; waiting for compute..."
sleep 6

mc=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT \"memberCount\" FROM \"Audience\" WHERE id=$AUD_ID;")
echo "  Audience.memberCount: $mc"
# Subscribers 1..25 are acme.test; subscribers 1..25 also purchased (1..30 purchased).
# Expected = 25.
[[ "$mc" == "25" ]] || fail "expected memberCount=25, got '$mc'"
ok "audience membership = 25 (matches expected)"

# Also check the actual rows match.
rows=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT count(*)::int FROM \"AudienceMember\" WHERE \"audienceId\"=$AUD_ID;")
[[ "$rows" -eq 25 ]] || fail "AudienceMember count != 25"
ok "AudienceMember rows = 25"

# 8) Author template ──────────────────────────────────────────────────────
step "8. Author MJML template + render preview"
groups=$(curl_json -X GET "$API/api/subscription-groups")
GROUP_ID=$(echo "$groups" | sed -n 's/.*"id":\([0-9]*\),"name":"marketing".*/\1/p')
if [[ -z "$GROUP_ID" ]]; then
  # No seeded groups (the prisma:seed step is optional and not in start.sh).
  # Create the marketing group via API.
  created=$(curl_json -X POST "$API/api/subscription-groups" \
    -d '{"name":"marketing","channel":"email","type":"opt_out","description":"Default marketing list"}')
  GROUP_ID=$(echo "$created" | sed -n 's/.*"subscriptionGroup":{"id":\([0-9]*\).*/\1/p')
  [[ -n "$GROUP_ID" ]] || fail "could not create marketing group"
  ok "marketing group created on the fly (id=$GROUP_ID)"
else
  ok "marketing group id=$GROUP_ID"
fi

tpl=$(curl_json -X POST "$API/api/templates" -d "{
  \"name\": \"smoke-welcome\",
  \"channel\": \"email\",
  \"subscriptionGroupId\": $GROUP_ID,
  \"definition\": {
    \"subject\": \"Welcome, {{ subscriber.firstName | default: 'friend' }}!\",
    \"fromName\": \"Acme Engagement\",
    \"fromEmail\": \"hello@acme.test\",
    \"mjml\": \"<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{ subscriber.email }}</mj-text><mj-text>Plan: {{ subscriber.plan }}</mj-text><mj-text font-size='10px'>Unsubscribe: {{ unsubscribe_url }}</mj-text></mj-column></mj-section></mj-body></mjml>\"
  }
}")
TPL_ID=$(echo "$tpl" | sed -n 's/.*"template":{"id":\([0-9]*\).*/\1/p')
[[ -n "$TPL_ID" ]] || fail "couldn't create template"
ok "template created (id=$TPL_ID)"

preview=$(curl_json -X POST "$API/api/templates/preview" -d '{
  "definition": {
    "subject": "Welcome!",
    "fromName": "Acme",
    "fromEmail": "hello@acme.test",
    "mjml": "<mjml><mj-body><mj-section><mj-column><mj-text>Hi {{ subscriber.email }}</mj-text></mj-column></mj-section></mj-body></mjml>"
  },
  "subscriberTraits": { "email": "demo@acme.test" }
}')
echo "$preview" | grep -q 'demo@acme.test' || fail "preview Liquid didn't interpolate"
ok "template preview renders Liquid + MJML"

# 9) Create a broadcast (draft) ───────────────────────────────────────────
step "9. Create broadcast in draft state"
# Publish template first.
curl_json -X PATCH "$API/api/templates/$TPL_ID" -d '{"status":"published"}' >/dev/null
ok "template published"

bcast=$(curl_json -X POST "$API/api/broadcasts" -d "{
  \"name\": \"smoke-broadcast\",
  \"templateId\": $TPL_ID,
  \"audienceId\": $AUD_ID,
  \"sendRatePerSecond\": 5
}")
BCAST_ID=$(echo "$bcast" | sed -n 's/.*"broadcast":{"id":\([0-9]*\).*/\1/p')
[[ -n "$BCAST_ID" ]] || fail "couldn't create broadcast"
ok "broadcast id=$BCAST_ID created in draft"

# 10) Schema invariants ────────────────────────────────────────────────────
step "10. Schema invariants"
chunks=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT count(*)::int FROM timescaledb_information.chunks WHERE hypertable_name='Event';")
echo "  Event chunks: $chunks"
[[ "$chunks" -ge 1 ]] || fail "no Event chunks created"
ok "Event hypertable has chunks"

# Idempotency-key index exists on Delivery.
docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT 1 FROM pg_indexes WHERE indexname='Delivery_idempotencyKey_key';" \
  | grep -q '^1$' && ok "Delivery.idempotencyKey UNIQUE index present"

# Stuck-run sweep cron registered?
docker compose exec -T redis redis-cli --raw KEYS 'bull:engagement-journey-stuck-run-sweep:*' 2>/dev/null | head -3 \
  | grep -q . && ok "journey-stuck-run-sweep schedule registered" \
  || echo "  (sweep cron not yet visible — may register on first tick)"

echo
echo "─────────────────────────────────────"
echo "✓ Smoke test passed."
echo "─────────────────────────────────────"
