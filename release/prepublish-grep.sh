#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-.}"

echo '--- likely private identifiers ---'
grep -RInE '127\.0\.0\.1:18789|hooks.token|CHRIS_TRANSFER_NUMBER|TRANSFER_TARGET_NUMBER|TRANSCRIPT_WEBHOOK_BEARER_TOKEN' "$BASE" || true

echo
echo '--- possible credentials / account ids ---'
grep -RInE 'sk-[A-Za-z0-9_-]+|AC[a-zA-Z0-9]{10,}|Authorization:|Bearer |TWILIO_AUTH_TOKEN|OPENAI_API_KEY|CLICKSEND_API_KEY|RADICALE_PASSWORD' "$BASE" || true

echo
echo '--- possible phone numbers / URLs ---'
grep -RInE '\+[0-9]{10,15}|https?://[^ ]+' "$BASE" || true
