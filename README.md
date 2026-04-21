# Realtime Phone Agent Template

A generic starter for low-latency inbound and outbound AI phone calls using the OpenAI Realtime API and Twilio.

<img width="1728" alt="Screenshot 2024-12-18 at 4 59 30 PM" src="./docs/assets/overview.png" />

## Quick Setup

Open two terminal windows:

| Terminal | Purpose                       | Quick Reference |
| -------- | ----------------------------- | --------------- |
| 1        | Run the `webapp`              | `npm run dev`   |
| 2        | Run the `websocket-server`    | `npm run dev`   |

If you need public webhook access during local testing, use your preferred tunnel and point Twilio at your public `/twiml` endpoint.

## Overview

This repo implements a phone calling assistant with the Realtime API and Twilio, and had two main parts: the `webapp`, and the `websocket-server`.

1. `webapp`: NextJS app to serve as a frontend for call configuration and transcripts
2. `websocket-server`: Express backend that handles connection from Twilio, connects it to the Realtime API, and forwards messages to the frontend
<img width="1514" alt="Screenshot 2024-12-20 at 10 32 40 AM" src="./docs/assets/flow.png" />

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

Use any secure public tunnel during local development so Twilio can reach your backend.

### Life of a phone call

Setup

1. Expose your local server with a secure public URL
1. Point Twilio at your public `/twiml` endpoint
1. Frontend connects to the backend (`wss://[your_backend]/logs`), ready for a call

Call

1. Call is placed to Twilio-managed number
1. Twilio queries the webhook (`http://[your_backend]/twiml`) for TwiML instructions
1. Twilio opens a bi-directional stream to the backend (`wss://[your_backend]/call`)
1. The backend connects to the Realtime API, and starts forwarding messages:
   - between Twilio and the Realtime API
   - between the frontend and the Realtime API

### Function Calling

The included server demonstrates function calling hooks for scheduling, messaging, and transfer flows. Review and adapt them for your own deployment.

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

### Environment variables

Copy the example env files and fill in the values for your own environment before running.

Required in `websocket-server/.env`:
- `OPENAI_API_KEY`
- `PUBLIC_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

Common customization keys in `websocket-server/.env`:
- `COMPANY_NAME`
- `COMPANY_DOMAIN`
- `COMPANY_CITY`
- `COMPANY_REGION`
- `BUSINESS_DESCRIPTOR`
- `FOUNDER_NAME`
- `ASSISTANT_NAME`
- `INBOUND_GREETING`
- `BUSINESS_TIMEZONE`
- `BUSINESS_HOURS_START`
- `BUSINESS_HOURS_END`

Optional integrations:
- transfer target settings
- calendar settings
- SMS provider settings
- transcript webhook settings
- saved prompt settings

Required in `webapp/.env` when using the web UI features:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

Important:
- Do not commit populated `.env` files.
- Review all optional integrations before deployment.

### Public webhook access

Twilio needs to reach your backend over the public internet. During local development, expose the websocket server with a secure tunnel of your choice and set `PUBLIC_URL` accordingly.

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

## Transfer and webhook features

The template includes optional transfer and webhook flows. Review those endpoints, credentials, and prompts carefully before exposing them in production.

# Additional Notes

This repository is intended as a starting point. Audit prompts, tools, auth boundaries, logging, and deployment settings before production use.
