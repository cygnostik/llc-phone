# OpenAI Realtime API with Twilio Quickstart
Here is the: <a href="https://clawhub.ai/cygnostik/llc-phone">ClawHub Link</a>
Here is the: <a href="https://github.com/cygnostik/llc-phone">GitHub Link</a>

Combine OpenAI's Realtime API and Twilio's phone calling capability to build an AI calling assistant.

<img width="1728" alt="Screenshot 2024-12-18 at 4 59 30 PM" src="https://github.com/user-attachments/assets/d3c8dcce-b339-410c-85ca-864a8e0fc326" />

## Quick Setup

Open three terminal windows:

| Terminal | Purpose                       | Quick Reference (see below for more) |
| -------- | ----------------------------- | ------------------------------------ |
| 1        | To run the `webapp`           | `npm run dev`                        |
| 2        | To run the `websocket-server` | `npm run dev`                        |
| 3        | To run `ngrok`                | `ngrok http 8081`                    |

Make sure all vars in `webapp/.env` and `websocket-server/.env` are set correctly. See [full setup](#full-setup) section for more.

## Overview

This repo implements a phone calling assistant with the Realtime API and Twilio, and had two main parts: the `webapp`, and the `websocket-server`.

1. `webapp`: NextJS app to serve as a frontend for call configuration and transcripts
2. `websocket-server`: Express backend that handles connection from Twilio, connects it to the Realtime API, and forwards messages to the frontend
<img width="1514" alt="Screenshot 2024-12-20 at 10 32 40 AM" src="https://github.com/user-attachments/assets/61d39b88-4861-4b6f-bfe2-796957ab5476" />

Twilio uses TwiML (a form of XML) to specify how to handle a phone call. When a call comes in we tell Twilio to start a bi-directional stream to our backend, where we forward messages between the call and the Realtime API. (`{{WS_URL}}` is replaced with our websocket endpoint.)

```xml
<!-- TwiML to start a bi-directional stream-->

<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connected</Say>
  <Connect>
    <Stream url="{{WS_URL}}" />
  </Connect>
  <Say>Disconnected</Say>
</Response>
```

We use `ngrok` to make our server reachable by Twilio.

### Life of a phone call

Setup

1. We run ngrok to make our server reachable by Twilio
1. We set the Twilio webhook to our ngrok address
1. Frontend connects to the backend (`wss://[your_backend]/logs`), ready for a call

Call

1. Call is placed to Twilio-managed number
1. Twilio queries the webhook (`http://[your_backend]/twiml`) for TwiML instructions
1. Twilio opens a bi-directional stream to the backend (`wss://[your_backend]/call`)
1. The backend connects to the Realtime API, and starts forwarding messages:
   - between Twilio and the Realtime API
   - between the frontend and the Realtime API

### Function Calling

This demo mocks out function calls so you can provide sample responses. In reality you could handle the function call, execute some code, and then supply the response back to the model.

## Full Setup

1. Make sure your [auth & env](#detailed-auth--env) is configured correctly.

2. Run webapp.

```shell
cd webapp
npm install
npm run dev
```

3. Run websocket server.

```shell
cd websocket-server
npm install
npm run dev
```

## Detailed Auth & Env

### OpenAI & Twilio

Set your credentials in `webapp/.env` and `websocket-server` - see `webapp/.env.example` and `websocket-server.env.example` for reference.

### Placeholder variables you must review

This public copy intentionally uses placeholders. Before running it, copy the example env files and fill in the values for your own environment.

Required in `websocket-server/.env`:
- `OPENAI_API_KEY`
- `PUBLIC_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

Usually required for customization in `websocket-server/.env`:
- `COMPANY_NAME`
- `COMPANY_DOMAIN`
- `COMPANY_CITY`
- `COMPANY_REGION`
- `BUSINESS_DESCRIPTOR`
- `FOUNDER_NAME`
- `ASSISTANT_NAME`
- `INBOUND_GREETING`

Optional integrations in `websocket-server/.env`:
- `TRANSFER_TARGET_LABEL`
- `TRANSFER_TARGET_NUMBER`
- `RADICALE_URL`
- `RADICALE_USERNAME`
- `RADICALE_PASSWORD`
- `RADICALE_CALENDAR_PATH`
- `CLICKSEND_USERNAME`
- `CLICKSEND_API_KEY`
- `CLICKSEND_FROM`
- `BUSINESS_SMS_FROM`
- `TRANSCRIPT_WEBHOOK_URL`
- `TRANSCRIPT_WEBHOOK_BEARER_TOKEN`

Required in `webapp/.env` when using the web UI features:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

Important:
- Do not leave example branding in place for production.
- Do not commit populated `.env` files.
- If you are not using calendar, SMS, transfer, or transcript webhook features, leave those related variables blank and disable those flows in your deployment review.

### Ngrok

Twilio needs to be able to reach your websocket server. If you're running it locally, your ports are inaccessible by default. [ngrok](https://ngrok.com/) can make them temporarily accessible.

We have set the `websocket-server` to run on port `8081` by default, so that is the port we will be forwarding.

```shell
ngrok http 8081
```

Make note of the `Forwarding` URL. (e.g. `https://54c5-35-170-32-42.ngrok-free.app`)

### Websocket URL

Your server should now be accessible at the `Forwarding` URL when run, so set the `PUBLIC_URL` in `websocket-server/.env`. See `websocket-server/.env.example` for reference.

# Example custom behavior (implementation notes)

## Outbound scenario safety

`POST /outbound-call` now requires a valid scenario unless appointment context clearly implies confirmation.

Accepted scenarios:
- `confirmation`
- `cold_call`
- `sales_call`
- `crisis`
- `custom`

Rules:
- If `scenario=confirmation`, both `appointment_date` and `appointment_time` are required.
- If no scenario is provided and there is no appointment context, the request is rejected (`400`) instead of silently defaulting to confirmation.

## Stream parameters

- `POST /twiml` forwards inbound caller ID from Twilio `From` to websocket stream param `from`.
- `POST /twiml-outbound` forwards `direction`, `caller_name`, `to`, `purpose`, and `scenario` to websocket stream parameters.

## Warm transfer

`transfer_call` now performs a live Twilio call update when an active call exists:
1. Sends SMS context to the configured transfer target (if ClickSend creds configured).
2. Updates the active Twilio call to `/twiml-transfer`.
3. `/twiml-transfer` dials the configured transfer target and uses `/twiml-transfer-whisper` to provide a short pre-bridge whisper context.

Transfer is still restricted to 8:00 AM - 7:00 PM Pacific.

## Transcript webhook auth

Transcript and outbound-status webhooks can POST to a generic webhook when configured with:
- `TRANSCRIPT_WEBHOOK_URL`
- `TRANSCRIPT_WEBHOOK_BEARER_TOKEN` (optional)

No local config-file fallback is used in the public version.

# Additional Notes

This repo isn't polished, and the security practices leave some to be desired. Please only use this as reference, and make sure to audit your app with security and engineering before deploying!
