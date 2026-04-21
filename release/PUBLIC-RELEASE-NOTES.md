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
- internal names and branding
- localhost webhook endpoints
- real phone numbers
- real domains
- tokens, SIDs, API keys, auth headers
