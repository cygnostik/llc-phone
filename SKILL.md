---
name: llc-phone
description: >-
  Low-latency inbound and outbound AI phone calls via the OpenAI Realtime API
  and Twilio, covering pre-warm and pre-accept patterns, IVR and receptionist
  flows, customer-service routing, VAD tuning, function calling, prompt
  caching, and implementation caveats.
user-invocable: true
homepage: https://promethean-dynamic.com
metadata: {"openclaw":{"emoji":"📞","homepage":"https://promethean-dynamic.com","requires":{"env":["OPENAI_API_KEY","TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_PHONE_NUMBER"]},"primaryEnv":"OPENAI_API_KEY"}}
---

# Lowest Latency Calls

This skill teaches the agent how to configure, deploy, debug, and optimize an
OpenAI Realtime API voice agent with Twilio for inbound and outbound AI phone
calls, with a strong emphasis on reducing time-to-first-audio.

Research note: this package combines vendor documentation with thoroughly
sourced practitioner research current as of 2026-04-02. Treat operational
latency and behavior claims as field guidance to validate in your own stack,
not as vendor guarantees.

## When to invoke this skill

Invoke when the user asks about any of the following:

- Configuring or deploying a Realtime API voice agent (any name/brand)
- Outbound call pre-warm architecture (eliminating dead air at pickup)
- Inbound call pre-accept warm (eliminating dead air when answering)
- AI IVR: routing, menu trees, warm-transfer, conference-bridge handoff
- Claw Receptionist mode: greet, qualify, route or take messages
- CSR with DB mode: customer lookup, appointment booking, CRM notes
- Async tool calling — AI continues speaking while tools run in background
- VAD tuning — semantic vs server VAD, eagerness, mid-session switching
- Prompt caching (`prompt_cache_key`) for Realtime sessions
- `gpt-realtime-1.5` vs `gpt-realtime-mini` vs legacy realtime model trade-offs
- Twilio Media Streams: PCMU format, edge colocation, AMD
- Known bugs, regressions, or latency issues
- Deploying or configuring this skill

## Reference documents

All reference docs live in `{baseDir}/docs/`:

| File | Content |
|---|---|
| `{baseDir}/docs/01-overview.md` | Model landscape, gpt-realtime-1.5 changelog, regressions |
| `{baseDir}/docs/02-session-config.md` | Full session.update reference + recommended defaults |
| `{baseDir}/docs/03-prewarm-outbound.md` | Pre-warm for outbound: buffer, fallback, edge cases |
| `{baseDir}/docs/04-inbound-modes.md` | Inbound: AI IVR, Claw Receptionist, CSR with DB |
| `{baseDir}/docs/05-async-tools.md` | Async tool calling for both directions |
| `{baseDir}/docs/06-latency-tuning.md` | All latency levers after pre-warm/pre-accept |
| `{baseDir}/docs/07-twilio-integration.md` | PCMU format, edge colocation, AMD, stream events |
| `{baseDir}/docs/08-known-issues.md` | Bugs, regressions, workarounds, watch-later items |
| `{baseDir}/docs/09-openclaw-config.md` | openclaw.json config + install/publish instructions |

## How to answer questions

1. Load the relevant doc from `{baseDir}/docs/` before answering.
2. Always specify: direction (inbound/outbound), mode (IVR/Receptionist/CSR/raw),
   and which model version the behaviour applies to.
3. For latency questions, distinguish: initialization latency (pre-warm/pre-accept),
   turn latency (VAD + inference), and Twilio transport latency.
4. For configuration questions, provide exact JSON/JS code blocks.
5. Flag caveats from `08-known-issues.md` whenever recommending a feature.
6. For async tool use, always reference `05-async-tools.md`.
7. For inbound mode selection, reference `04-inbound-modes.md`.

## Key facts (always available without file load)

- OpenAI currently lists `gpt-realtime-1.5` as its flagship voice model and
  `gpt-realtime-mini` as a lower-cost realtime option.
- Example WebSocket endpoint:
  `wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5`
- Twilio Media Streams use mu-law / PCMU at 8 kHz mono, and the OpenAI-side
  examples in this package use `audio/pcmu`.
- Pre-warm (outbound) and pre-accept warm (inbound) are the core latency
  techniques in this package.
- `semantic_vad` with `eagerness: "high"` is presented here as a tested
  starting point, not a universal best setting.
- A 10-second pre-warm / pre-accept timeout is a conservative fallback pattern.
- Inbound modes covered: AI IVR, receptionist, and CSR / database-assisted
  flows.
