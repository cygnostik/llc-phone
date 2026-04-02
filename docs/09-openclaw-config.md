# 09 — OpenClaw Configuration Reference

## Installing this skill

From ClawHub (once published):
```bash
openclaw skills install llc-phone
```

Or with the ClawHub CLI:
```bash
clawhub install llc-phone
```

Manual install (copy folder):
```bash
cp -r llc-phone ~/.openclaw/skills/               # global
# OR
cp -r llc-phone ./skills/                         # workspace-scoped
```

Verify after any install method by starting a new OpenClaw session:
```bash
openclaw skills list --eligible
openclaw skills info llc-phone
```

## openclaw.json configuration

```json
{
  "skills": {
    "entries": {
      "llc-phone": {
        "enabled": true,
        "env": {
          "OPENAI_API_KEY":       "sk-...",
          "TWILIO_ACCOUNT_SID":   "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          "TWILIO_AUTH_TOKEN":    "your_auth_token_here",
          "TWILIO_PHONE_NUMBER":  "+12025551234",

          "IVR_DID":              "+12025550001",
          "RECEPTIONIST_DID":     "+12025550002",
          "CSR_DID":              "+12025550003",

          "SALES_NUMBER":         "+12025551001",
          "SUPPORT_NUMBER":       "+12025551002",
          "BILLING_NUMBER":       "+12025551003",
          "SCHEDULING_NUMBER":    "+12025551004",

          "VOSS_VOICE":           "cedar",
          "VOSS_MODEL":           "gpt-realtime-1.5",
          "VOSS_PREWARM_TIMEOUT": "10000",
          "VOSS_VAD_EAGERNESS":   "high",
          "VOSS_CACHE_KEY":       "llc-outbound-v1",
          "VOSS_EDGE_LOCATION":   "umatilla"
        },
        "config": {
          "voice":              "cedar",
          "model":              "gpt-realtime-1.5",
          "prewarm_timeout_ms": 10000,
          "eagerness":          "high",
          "prompt_cache_key":   "llc-outbound-v1",
          "edge_location":      "umatilla"
        }
      }
    }
  }
}
```

Note: Config key must be quoted as "llc-phone" in JSON5. This is
normal for hyphenated keys in OpenClaw's config.

## Environment variable reference

### Required

| Variable | Description |
|---|---|
| OPENAI_API_KEY | OpenAI API key with Realtime API access |
| TWILIO_ACCOUNT_SID | Twilio Account SID (starts with AC) |
| TWILIO_AUTH_TOKEN | Twilio Auth Token |
| TWILIO_PHONE_NUMBER | Default outbound caller ID (E.164) |

### Inbound DIDs (optional -- for mode routing)

| Variable | Description |
|---|---|
| IVR_DID | Inbound number that routes to AI IVR mode |
| RECEPTIONIST_DID | Inbound number that routes to Claw Receptionist |
| CSR_DID | Inbound number that routes to CSR with DB |
| SALES_NUMBER | Transfer destination for sales (E.164) |
| SUPPORT_NUMBER | Transfer destination for support |
| BILLING_NUMBER | Transfer destination for billing |
| SCHEDULING_NUMBER | Transfer destination for scheduling |

### Optional (with defaults)

| Variable | Default | Description |
|---|---|---|
| VOSS_VOICE | "cedar" | Default voice for outbound / unmatched inbound |
| VOSS_MODEL | "gpt-realtime-1.5" | Realtime model string |
| VOSS_PREWARM_TIMEOUT | "10000" | Pre-warm / pre-accept fallback timeout (ms) |
| VOSS_VAD_EAGERNESS | "high" | Semantic VAD eagerness for first turn |
| VOSS_CACHE_KEY | "llc-outbound-v1" | Prompt cache key for outbound |
| VOSS_EDGE_LOCATION | "" | Twilio edge location (umatilla, ashburn, etc.) |

## Consuming config in your server

```javascript
const config = {
  openaiApiKey:   process.env.OPENAI_API_KEY,
  accountSid:     process.env.TWILIO_ACCOUNT_SID,
  authToken:      process.env.TWILIO_AUTH_TOKEN,
  phoneNumber:    process.env.TWILIO_PHONE_NUMBER,
  voice:          process.env.VOSS_VOICE           || "cedar",
  model:          process.env.VOSS_MODEL           || "gpt-realtime-1.5",
  prewarmTimeout: parseInt(process.env.VOSS_PREWARM_TIMEOUT || "10000"),
  vadEagerness:   process.env.VOSS_VAD_EAGERNESS   || "high",
  cacheKey:       process.env.VOSS_CACHE_KEY       || "llc-outbound-v1",
  edgeLocation:   process.env.VOSS_EDGE_LOCATION   || null,
  ivrDid:         process.env.IVR_DID,
  receptionistDid: process.env.RECEPTIONIST_DID,
  csrDid:         process.env.CSR_DID,
};
```

## Disabling the skill

```json
{
  "skills": { "entries": { "llc-phone": { "enabled": false } } }
}
```

## Hot reload during development

```json
{
  "skills": { "load": { "watch": true, "watchDebounceMs": 250 } }
}
```

## Publishing to ClawHub

```bash
npm install -g clawhub
clawhub login
cd llc-phone
clawhub skill publish . --version <version> --changelog "<summary>" --tags "openai,realtime,voice,twilio,phone,ivr,customer-support"
```

Before publishing, confirm that `requires.env` still matches what the skill
actually uses, and re-check the current ClawHub docs for any CLI changes.

## Security notes

- Never commit openclaw.json to version control (it contains secrets)
- Add ~/.openclaw/openclaw.json to your global .gitignore
- skills.entries.*.env values are injected into the agent run only
- Review SKILL.md before deploying to production agents
