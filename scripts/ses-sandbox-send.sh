#!/usr/bin/env bash
# AWS SES sandbox round-trip:
#   1. Save SES creds into the encrypted Secret table via the API.
#   2. Restart the worker so the (cached) SES client picks them up clean.
#   3. Identify one Subscriber matching the verified SES recipient.
#   4. Create a single-recipient audience.
#   5. Author a small MJML template with the verified sender.
#   6. Launch a broadcast at 1 send/sec.
#   7. Poll Delivery rows until status='sent' with a providerMessageId.
#
# Required env (we won't log them):
#   AWS_REGION             e.g. us-east-1
#   AWS_ACCESS_KEY_ID
#   AWS_SECRET_ACCESS_KEY
#   SES_SENDER_EMAIL       a SES-verified email address
#   SES_RECIPIENT_EMAIL    a SES-verified email address (sandbox)
#
# Optional:
#   API           default http://localhost:4100
#   ADMIN_EMAIL   default admin@smoke.test
#   ADMIN_PASSWORD default smoke-test-pw-1234

set -euo pipefail

API="${API:-http://localhost:4100}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@smoke.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-smoke-test-pw-1234}"

# Required env validation
for v in AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY SES_SENDER_EMAIL SES_RECIPIENT_EMAIL; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing required env: $v" >&2
    exit 1
  fi
done

cookies=$(mktemp -t pfe-ses-cookies.XXXXXX)
trap 'rm -f "$cookies"' EXIT

curl_json() {
  curl -sS -b "$cookies" -c "$cookies" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -H 'Origin: http://localhost:5174' \
    "$@"
}

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[0;31m✗ %s\033[0m\n' "$1"; exit 1; }

# 1) Login as admin (smoke admin must exist; run scripts/smoke.sh first if not).
step "1. Login"
login=$(curl_json -X POST "$API/api/auth/login" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  -w '\n%{http_code}')
login_code=$(echo "$login" | tail -1)
if [[ "$login_code" != "200" ]]; then
  fail "login HTTP $login_code — run scripts/smoke.sh first to provision the admin"
fi
ok "logged in as $ADMIN_EMAIL"

# 2) Save SES secret. The API encrypts with SECRET_ENCRYPTION_KEY before
# storage; the worker decrypts on first use. Region + IAM creds are
# validated against amazonSesConfigSchema at the route layer.
step "2. Save SES secret"
saved=$(curl_json -X POST "$API/api/secrets" -d "{
  \"name\": \"amazon-ses\",
  \"value\": {
    \"region\": \"$AWS_REGION\",
    \"accessKeyId\": \"$AWS_ACCESS_KEY_ID\",
    \"secretAccessKey\": \"$AWS_SECRET_ACCESS_KEY\",
    \"defaultFromDomain\": \"$(echo "$SES_SENDER_EMAIL" | cut -d'@' -f2)\"
  }
}")
echo "$saved" | grep -q '"name":"amazon-ses"' || { echo "$saved"; fail "secret save did not echo the row"; }
ok "amazon-ses secret encrypted + stored"

# 3) Restart the worker so the cached SES client (if any prior null cache)
# is dropped. The lazy load on next send will pick up the new creds.
step "3. Restart worker so it picks up the new creds"
docker compose restart worker > /dev/null
ok "worker restarted"

# 4) Identify a subscriber with the verified recipient email.
step "4. Identify subscriber matching SES_RECIPIENT_EMAIL"
# Use a test API token (mint one if needed). Easiest: re-use the smoke
# token if it exists; otherwise mint a new one.
token_resp=$(curl_json -X POST "$API/api/api-tokens" \
  -d '{"name":"ses-sandbox-send","scopes":["engagement:ingest"]}')
TOKEN=$(echo "$token_resp" | sed -n 's/.*"secret":"\([^"]*\)".*/\1/p')
[[ -n "$TOKEN" ]] || fail "couldn't mint API token"
ok "minted ingest token"

curl -sS -X POST "$API/api/public/identify" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"ses-test-recipient\",\"traits\":{\"email\":\"$SES_RECIPIENT_EMAIL\",\"firstName\":\"Sandbox\",\"plan\":\"test\"}}" \
  -w '' >/dev/null
ok "identify() enqueued"

# Wait a tick for the worker to drain.
sleep 3

# 5) Ensure a marketing subscription group exists.
step "5. Ensure marketing subscription group"
groups=$(curl_json -X GET "$API/api/subscription-groups")
GROUP_ID=$(echo "$groups" | sed -n 's/.*"id":\([0-9]*\),"name":"marketing".*/\1/p')
if [[ -z "$GROUP_ID" ]]; then
  created=$(curl_json -X POST "$API/api/subscription-groups" \
    -d '{"name":"marketing","channel":"email","type":"opt_out","description":"Default"}')
  GROUP_ID=$(echo "$created" | sed -n 's/.*"subscriptionGroup":{"id":\([0-9]*\).*/\1/p')
  [[ -n "$GROUP_ID" ]] || fail "could not create marketing group"
  ok "marketing group created (id=$GROUP_ID)"
else
  ok "marketing group exists (id=$GROUP_ID)"
fi

# 6) Create a template using the verified sender. Idempotent-ish: if the
# template name exists, fall back to PATCH the existing one.
step "6. Create template with verified sender"
tpl_payload=$(cat <<JSON
{
  "name": "ses-sandbox-test",
  "channel": "email",
  "subscriptionGroupId": $GROUP_ID,
  "definition": {
    "subject": "Pipelineflow Engagement — sandbox send {{ subscriber.firstName | default: 'friend' }}",
    "fromName": "Pipelineflow Engagement",
    "fromEmail": "$SES_SENDER_EMAIL",
    "mjml": "<mjml><mj-body><mj-section><mj-column><mj-text font-size='18px' font-weight='600'>Hello {{ subscriber.email }} 👋</mj-text><mj-text>This message was sent through AWS SES sandbox by Pipelineflow Engagement.</mj-text><mj-text>Plan: {{ subscriber.plan | default: 'unknown' }}</mj-text><mj-text font-size='10px' color='#64748b'>You can <a href='{{ unsubscribe_url }}'>manage your subscription preferences</a>.</mj-text></mj-column></mj-section></mj-body></mjml>"
  }
}
JSON
)
tpl_resp=$(curl_json -X POST "$API/api/templates" -d "$tpl_payload" -w '\n%{http_code}')
tpl_code=$(echo "$tpl_resp" | tail -1)
tpl_body=$(echo "$tpl_resp" | sed '$d')
if [[ "$tpl_code" == "201" ]]; then
  TPL_ID=$(echo "$tpl_body" | sed -n 's/.*"template":{"id":\([0-9]*\).*/\1/p')
  ok "template created (id=$TPL_ID)"
elif [[ "$tpl_code" == "409" ]]; then
  ok "template exists; reusing"
  list=$(curl_json -X GET "$API/api/templates")
  TPL_ID=$(echo "$list" | sed -n 's/.*"id":\([0-9]*\),"name":"ses-sandbox-test".*/\1/p')
  [[ -n "$TPL_ID" ]] || fail "couldn't find existing template id"
else
  echo "$tpl_body"
  fail "template create returned $tpl_code"
fi

# Publish in case it's a draft.
curl_json -X PATCH "$API/api/templates/$TPL_ID" -d '{"status":"published"}' >/dev/null
ok "template published (id=$TPL_ID)"

# 7) Audience — single subscriber matched by email trait.
step "7. Single-subscriber audience"
aud_resp=$(curl_json -X POST "$API/api/audiences" -d "{
  \"name\": \"ses-sandbox-target-$$\",
  \"computeIntervalSeconds\": 60,
  \"definition\": {
    \"root\": {
      \"type\": \"Trait\",
      \"key\": \"email\",
      \"operator\": \"equals\",
      \"value\": \"$SES_RECIPIENT_EMAIL\"
    }
  }
}")
AUD_ID=$(echo "$aud_resp" | sed -n 's/.*"audience":{"id":\([0-9]*\).*/\1/p')
[[ -n "$AUD_ID" ]] || { echo "$aud_resp"; fail "couldn't create audience"; }
ok "audience created (id=$AUD_ID)"

curl_json -X POST "$API/api/audiences/$AUD_ID/recompute" >/dev/null
ok "recompute enqueued"

# Wait until the audience materialises.
for i in $(seq 1 15); do
  mc=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
    "SELECT \"memberCount\" FROM \"Audience\" WHERE id=$AUD_ID;")
  [[ "$mc" == "1" ]] && break
  sleep 1
done
mc=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT \"memberCount\" FROM \"Audience\" WHERE id=$AUD_ID;")
[[ "$mc" == "1" ]] || fail "audience never reached 1 member (got '$mc')"
ok "audience membership = 1"

# 8) Broadcast at 1/sec.
step "8. Create + launch broadcast"
bcast_resp=$(curl_json -X POST "$API/api/broadcasts" -d "{
  \"name\": \"ses-sandbox-test-$$\",
  \"templateId\": $TPL_ID,
  \"audienceId\": $AUD_ID,
  \"sendRatePerSecond\": 1
}")
BCAST_ID=$(echo "$bcast_resp" | sed -n 's/.*"broadcast":{"id":\([0-9]*\).*/\1/p')
[[ -n "$BCAST_ID" ]] || { echo "$bcast_resp"; fail "couldn't create broadcast"; }
ok "broadcast created (id=$BCAST_ID)"

curl_json -X POST "$API/api/broadcasts/$BCAST_ID/actions" -d '{"action":"launch"}' >/dev/null
ok "broadcast launched"

# 9) Poll for the Delivery row to flip to 'sent'.
step "9. Wait for Delivery to flip to 'sent'"
for i in $(seq 1 30); do
  status=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
    "SELECT status FROM \"Delivery\" WHERE \"broadcastId\"=$BCAST_ID ORDER BY id DESC LIMIT 1;")
  printf '  poll %2d/30: status=%s\n' "$i" "${status:-(no row yet)}"
  if [[ "$status" == "sent" ]]; then break; fi
  if [[ "$status" == "failed" || "$status" == "bounced" || "$status" == "complained" ]]; then
    err=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
      "SELECT \"errorMessage\" FROM \"Delivery\" WHERE \"broadcastId\"=$BCAST_ID ORDER BY id DESC LIMIT 1;")
    fail "Delivery terminal status=$status. error=$err"
  fi
  sleep 2
done

if [[ "$status" != "sent" ]]; then
  echo "  Worker logs (last 20 lines):"
  docker compose logs worker --tail=20 | sed 's/^/    /'
  fail "Delivery never reached 'sent' (last status=$status)"
fi

provider_id=$(docker compose exec -T postgres psql -U pfengagement -d pfengagement -tAc \
  "SELECT \"providerMessageId\" FROM \"Delivery\" WHERE \"broadcastId\"=$BCAST_ID ORDER BY id DESC LIMIT 1;")
ok "Delivery sent — providerMessageId=$provider_id"

echo
echo "─────────────────────────────────────"
echo "✓ SES sandbox send succeeded."
echo "  Check the recipient inbox at: $SES_RECIPIENT_EMAIL"
echo "  SES MessageId: $provider_id"
echo "─────────────────────────────────────"
