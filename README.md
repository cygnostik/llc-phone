# OpenAI Realtime API with Twilio Quickstart
Here is the: <a href="https://clawhub.ai/cygnostik/llc-phone">ClawHub Link</a>
Here is the: <a href="https://github.com/cygnostik/llc-phone">GitHub Link</a>

Combine OpenAI's Realtime API and Twilio's phone calling capability to build an AI calling assistant.

<img width="1728" alt="Screenshot 2024-12-18 at 4 59 30 PM" src="https://github.com/user-attachments/assets/d3c8dcce-b339-410c-85ca-864a8e0fc326" />

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
<img width="1514" alt="Screenshot 2024-12-20 at 10 32 40 AM" src="https://github.com/user-attachments/assets/61d39b88-4861-4b6f-bfe2-796957ab5476" />

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

### Ngrok

Twilio needs to be able to reach your websocket server. If you're running it locally, your ports are inaccessible by default. [ngrok](https://ngrok.com/) can make them temporarily accessible.

We have set the `websocket-server` to run on port `8081` by default, so that is the port we will be forwarding.

```shell
ngrok http 8081
```

Make note of the `Forwarding` URL. (e.g. `https://54c5-35-170-32-42.ngrok-free.app`)

### Websocket URL

Your server should now be accessible at the `Forwarding` URL when run, so set the `PUBLIC_URL` in `websocket-server/.env`. See `websocket-server/.env.example` for reference.

# Reference Documentation

Architectural reference in [`docs/`](docs/) — practitioner notes on the
OpenAI Realtime API + Twilio stack.

| File | Content |
|---|---|
| [`docs/01-overview.md`](docs/01-overview.md) | Model landscape, selection notes |
| [`docs/02-session-config.md`](docs/02-session-config.md) | `session.update` reference + recommended defaults |
| [`docs/03-prewarm-outbound.md`](docs/03-prewarm-outbound.md) | Outbound pre-warm: buffer, fallback, edge cases |
| [`docs/04-inbound-modes.md`](docs/04-inbound-modes.md) | Inbound: AI IVR, Receptionist, CSR with DB |
| [`docs/05-async-tools.md`](docs/05-async-tools.md) | Async tool calling (inbound + outbound) |
| [`docs/06-latency-tuning.md`](docs/06-latency-tuning.md) | All latency levers after pre-warm / pre-accept |
| [`docs/07-twilio-integration.md`](docs/07-twilio-integration.md) | Twilio audio format, edge colocation, AMD, stream events |
| [`docs/08-known-issues.md`](docs/08-known-issues.md) | Operational notes, field reports, watch-later items |

# Additional Notes

This repo isn't polished, and the security practices leave some to be desired. Please only use this as reference, and make sure to audit your app with security and engineering before deploying!
