#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-$(pwd)}"
DEST="${2:-${SRC%/}-public}"

if [[ ! -d "$SRC" ]]; then
  echo "Source repo not found: $SRC" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"

rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude 'dist/' \
  --exclude 'coverage/' \
  --exclude 'out/' \
  --exclude 'build/' \
  --exclude 'snapshots/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.bak' \
  --exclude '*.bak.*' \
  --exclude '*.tsbuildinfo' \
  --exclude 'README.md.bak' \
  --exclude 'docs/10-known-working-receptionist-booking.md' \
  "$SRC/" "$DEST/"

mkdir -p "$DEST/release"

cat > "$DEST/release/PUBLIC-RELEASE-NOTES.md" <<'EOF'
# Public release notes

This directory was generated from the private working repo using `scripts/prepare-public-release.sh`.

## Automatically excluded

- `.git`
- `node_modules`
- `.next`
- `dist`
- `snapshots`
- `.env` and `.env.*`
- `*.bak` and `*.bak.*`
- local tsbuildinfo artifacts
- private known-working ops note: `docs/10-known-working-receptionist-booking.md`

## Manual review still required

Before publishing, review and sanitize:

1. `README.md`
   - remove private/internal hostnames
   - remove personal phone numbers
   - remove internal process notes not meant for release

2. `websocket-server/.env.example`
   - keep only variables that a public user should set
   - remove or rewrite internal-only vars and comments

3. `webapp/.env.example`
   - same rule, keep only public setup vars

4. `websocket-server/src/systemWebhook.ts`
   - keep transcript webhook behavior generic and environment-driven
   - do not use local config-file fallbacks for secrets
   - remove the file entirely if webhook delivery is not part of the public release

5. `websocket-server/src/functionHandlers.ts`
   - review for private integrations, account assumptions, calendar endpoints, SMS vendor assumptions, or hardcoded business workflows

6. `websocket-server/src/server.ts`
   - review transfer targets, defaults, internal URLs, and business-specific endpoints

7. `websocket-server/src/sessionManager.ts`
   - scrub company-specific prompts, names, transfer logic, and behavior that should be template-based instead of hardcoded

8. all docs
   - remove internal phone numbers, domains, operational notes, and private workflow instructions

## Recommended publication strategy

Create a new git repo from this stripped copy, then do a final grep pass for:
- private names
- internal product names
- internal domains or localhost webhook endpoints
- real phone numbers
- real domains
- tokens, SIDs, API keys, auth headers
EOF

cat > "$DEST/release/prepublish-grep.sh" <<'EOF'
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
EOF
chmod +x "$DEST/release/prepublish-grep.sh"

# Leave a stub marker if the internal webhook file exists.
if [[ -f "$DEST/websocket-server/src/systemWebhook.ts" ]]; then
  cat > "$DEST/websocket-server/src/systemWebhook.PUBLIC-REVIEW.md" <<'EOF'
# Public review required

This project currently contains `systemWebhook.ts`, which should remain generic and environment-driven in the public version.

Before publishing, either:
- replace it with a generic webhook adapter driven entirely by environment variables, or
- remove it and the related imports/calls from the public release

Do not publish any local config-file fallback for webhook secrets.
EOF
fi

echo "Created stripped copy at: $DEST"
echo "Next: review $DEST/release/PUBLIC-RELEASE-NOTES.md and run $DEST/release/prepublish-grep.sh $DEST"
