import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";
import {
  handleCallConnection,
  handleFrontendConnection,
  setOutboundContext,
  preWarmSession,
  OutboundScenario,
} from "./sessionManager";
import functions from "./functionHandlers";
import { postPhoneTranscript } from "./systemWebhook";

dotenv.config();

const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const CLICKSEND_USER = process.env.CLICKSEND_USERNAME || "";
const CLICKSEND_KEY = process.env.CLICKSEND_API_KEY || "";
const CLICKSEND_FROM = process.env.CLICKSEND_FROM || "";
const TRANSFER_TARGET_NUMBER = process.env.TRANSFER_TARGET_NUMBER || "";
const TRANSFER_TARGET_LABEL = process.env.TRANSFER_TARGET_LABEL || "the designated teammate";

const VALID_SCENARIOS: OutboundScenario[] = ["confirmation", "cold_call", "sales_call", "crisis", "custom"];

function normalizeScenario(value?: string): OutboundScenario | undefined {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  return VALID_SCENARIOS.includes(normalized as OutboundScenario)
    ? (normalized as OutboundScenario)
    : undefined;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Track outbound call context by CallSid so status callbacks can access it
const outboundCallContexts = new Map<string, { caller_name: string; company_name: string; appointment_date: string; appointment_time: string; purpose: string; scenario: string }>();

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({ publicUrl: PUBLIC_URL });
});

app.all("/twiml", (req, res) => {
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  // Twilio sends From/To as form-encoded POST body; fall back to query for GET/testing
  const callerFrom = req.body?.From || req.query?.From || req.body?.from || req.query?.from || "unknown";
  console.log("[TWIML] Request method:", req.method, "From:", callerFrom, "body:", JSON.stringify(req.body), "query:", JSON.stringify(req.query));
  
  const twimlContent = twimlTemplate
    .replace("{{WS_URL}}", wsUrl.toString())
    .replace("{{CALLER_FROM}}", escapeXml(callerFrom));
  res.type("text/xml").send(twimlContent);
});

// New endpoint to list available tools (schemas)
app.get("/tools", (req, res) => {
  res.json(functions.map((f) => f.schema));
});

// ─── Outbound call: Twilio REST API ──────────────────────────────────────────

app.post("/outbound-call", async (req, res): Promise<void> => {
  const {
    to, caller_name, company_name,
    appointment_date, appointment_time, purpose,
    scenario, prospect_context, custom_instructions,
  } = req.body;

  if (!to || !caller_name) {
    res.status(400).json({ error: "Missing required fields: to, caller_name" });
    return;
  }
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    res.status(500).json({ error: "Twilio credentials not configured" });
    return;
  }

  const inferredScenarioFromPurpose = normalizeScenario(purpose);
  const callScenario = normalizeScenario(scenario)
    || (appointment_date || appointment_time ? "confirmation" : undefined)
    || inferredScenarioFromPurpose;

  if (!callScenario) {
    res.status(400).json({
      error: "Missing or invalid scenario. Provide scenario as one of: confirmation, cold_call, sales_call, crisis, custom.",
    });
    return;
  }

  if (callScenario === "confirmation" && (!appointment_date || !appointment_time)) {
    res.status(400).json({
      error: "confirmation scenario requires appointment_date and appointment_time",
    });
    return;
  }

  // Store outbound context so sessionManager picks it up when the call connects
  setOutboundContext({
    direction: "outbound",
    to,
    caller_name,
    company_name: company_name || "",
    appointment_date: appointment_date || "",
    appointment_time: appointment_time || "",
    purpose: purpose || callScenario,
    scenario: callScenario,
    prospect_context: prospect_context || "",
    custom_instructions: custom_instructions || "",
  });

  // Pre-warm: connect to OpenAI and buffer greeting BEFORE placing the call
  console.log("[OUTBOUND] Pre-warming OpenAI session...");
  const preWarmOk = await preWarmSession(OPENAI_API_KEY);
  if (preWarmOk) {
    console.log("[OUTBOUND] Pre-warm complete — model is hot, greeting buffered");
  } else {
    console.warn("[OUTBOUND] Pre-warm failed — will fall back to cold connect");
  }

  // Build TwiML callback URL with outbound params
  const twimlUrl = new URL(`${PUBLIC_URL}/twiml-outbound`);
  twimlUrl.searchParams.set("to", to);
  twimlUrl.searchParams.set("caller_name", caller_name);
  twimlUrl.searchParams.set("purpose", purpose || callScenario);
  twimlUrl.searchParams.set("scenario", callScenario);

  // Status callback so we can detect no-answer/busy/failed.
  // Use /twiml-status because nginx leaves /twiml* endpoints unauthenticated for Twilio.
  const statusUrl = new URL(`${PUBLIC_URL}/twiml-status`);

  try {
    const twilioBody = new URLSearchParams({
      To: to,
      From: TWILIO_NUMBER,
      Url: twimlUrl.toString(),
      StatusCallback: statusUrl.toString(),
      StatusCallbackMethod: "POST",
      // Use synchronous AMD so TwiML only executes after Twilio classifies
      // human vs machine. This lets us silently hang up on voicemail before
      // the media stream ever reaches the model.
      MachineDetection: "DetectMessageEnd",
      Timeout: "30",
      // Edge removed — let Twilio auto-route to nearest
    });

    ["initiated", "ringing", "answered", "completed"].forEach((event) => {
      twilioBody.append("StatusCallbackEvent", event);
    });

    const twilioResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: twilioBody.toString(),
      }
    );

    const data = await twilioResp.json();
    if (data.sid) {
      // Store context keyed by CallSid for the status callback
      outboundCallContexts.set(data.sid, {
        caller_name: caller_name,
        company_name: company_name || "",
        appointment_date: appointment_date || "",
        appointment_time: appointment_time || "",
        purpose: purpose || callScenario,
        scenario: callScenario,
      });
      // Clean up after 10 minutes to avoid memory leak
      setTimeout(() => outboundCallContexts.delete(data.sid), 10 * 60 * 1000);
      console.log("[OUTBOUND] Call initiated:", data.sid, "to:", to, "scenario:", callScenario);
      res.json({ success: true, call_sid: data.sid, to, scenario: callScenario, purpose });
    } else {
      console.error("[OUTBOUND] Twilio error:", JSON.stringify(data));
      res.status(500).json({ error: "Twilio call failed", details: data });
    }
  } catch (err: any) {
    console.error("[OUTBOUND] Failed to initiate call:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// TwiML for outbound calls — connects to the same websocket stream
app.all("/twiml-outbound", (req, res) => {
  const answeredBy = String(req.body?.AnsweredBy || req.query?.AnsweredBy || "").trim();
  console.log("[TWIML-OUTBOUND] hit", {
    method: req.method,
    to: req.body?.To || req.query?.to || "unknown",
    caller_name: req.body?.caller_name || req.query?.caller_name || "",
    purpose: req.body?.purpose || req.query?.purpose || "outbound",
    scenario: req.body?.scenario || req.query?.scenario || "",
    answeredBy: answeredBy || "n/a",
  });

  const silentHangupAnsweredBy = new Set([
    "machine_start",
    "machine_end_beep",
    "machine_end_silence",
    "machine_end_other",
    "fax",
  ]);

  if (answeredBy && silentHangupAnsweredBy.has(answeredBy)) {
    console.log("[TWIML-OUTBOUND] Silent hangup for non-human answer:", answeredBy);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    return;
  }

  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  const to = req.body?.To || req.query?.to || "unknown";
  const callerName = req.body?.caller_name || req.query?.caller_name || "";
  const purpose = req.body?.purpose || req.query?.purpose || "outbound";
  const scenario = normalizeScenario(req.body?.scenario || req.query?.scenario) || "custom";

  // Same Stream TwiML, but with outbound-specific parameters
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl.toString()}">
      <Parameter name="direction" value="outbound" />
      <Parameter name="from" value="${TWILIO_NUMBER}" />
      <Parameter name="to" value="${escapeXml(String(to))}" />
      <Parameter name="caller_name" value="${escapeXml(String(callerName))}" />
      <Parameter name="purpose" value="${escapeXml(String(purpose))}" />
      <Parameter name="scenario" value="${scenario}" />
    </Stream>
  </Connect>
</Response>`;
  res.type("text/xml").send(twiml);
});

app.all("/twiml-transfer", (req, res) => {
  const reason = escapeXml(String(req.body?.reason || req.query?.reason || "Urgent caller handoff"));
  const callerName = escapeXml(String(req.body?.caller_name || req.query?.caller_name || "caller"));
  const callerSummary = escapeXml(String(req.body?.caller_summary || req.query?.caller_summary || ""));

  const whisperUrl = new URL(`${PUBLIC_URL}/twiml-transfer-whisper`);
  whisperUrl.searchParams.set("caller_name", callerName);
  whisperUrl.searchParams.set("reason", reason);
  whisperUrl.searchParams.set("caller_summary", callerSummary);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while I connect you with ${escapeXml(TRANSFER_TARGET_LABEL)}.</Say>
  <Dial answerOnBridge="true" timeout="25" callerId="${escapeXml(TWILIO_NUMBER)}">
    <Number url="${escapeXml(whisperUrl.toString())}">${escapeXml(TRANSFER_TARGET_NUMBER)}</Number>
  </Dial>
  <Say>I could not complete the transfer right now. We will call you back shortly.</Say>
</Response>`;

  res.type("text/xml").send(twiml);
});

app.all("/twiml-transfer-whisper", (req, res) => {
  const callerName = escapeXml(String(req.body?.caller_name || req.query?.caller_name || "unknown caller"));
  const reason = escapeXml(String(req.body?.reason || req.query?.reason || "No reason provided"));
  const summary = escapeXml(String(req.body?.caller_summary || req.query?.caller_summary || ""));

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Call transfer. Caller: ${callerName}. Reason: ${reason}.${summary ? ` Summary: ${summary}.` : ""}</Say>
  <Pause length="1" />
</Response>`;

  res.type("text/xml").send(twiml);
});

// Status callback for outbound calls — logs outcome and optionally notifies a webhook.
// Per operator rule, we do not send SMS fallback for missed calls/voicemail.
const handleOutboundStatus = async (req: express.Request, res: express.Response) => {
  const { CallSid, CallStatus, To, AnsweredBy } = req.body;
  console.log("[OUTBOUND] Status:", CallStatus, "SID:", CallSid, "To:", To, "AnsweredBy:", AnsweredBy || "n/a");

  const failureStatuses = ["no-answer", "busy", "failed", "canceled"];
  const isVoicemail = AnsweredBy === "machine_end_beep" || AnsweredBy === "machine_end_silence" || AnsweredBy === "machine_end_other";

  if (failureStatuses.includes(CallStatus) || isVoicemail) {
    // Retrieve outbound context by CallSid
    const ctx = outboundCallContexts.get(CallSid) || {};
    const callerName = (ctx as any).caller_name || "there";
    const apptDate = (ctx as any).appointment_date || "";
    const apptTime = (ctx as any).appointment_time || "";
    // Clean up after use
    if (CallSid) outboundCallContexts.delete(CallSid);

    const scenario = (ctx as any).scenario || "custom";

    // Also notify transcript/status webhook if configured
    await postPhoneTranscript({
      event: "outbound_call_failed",
      call_sid: CallSid,
      to: To,
      status: CallStatus,
      answered_by: AnsweredBy || null,
      sms_fallback_sent: false,
      caller_name: callerName,
      appointment_date: apptDate,
      appointment_time: apptTime,
      scenario,
    }, "outbound-status");
  }

  res.sendStatus(200);
};

// Optional status callback route for controlled environments.
app.post("/outbound-status", handleOutboundStatus);
// Public Twilio callback route.
app.post("/twiml-status", handleOutboundStatus);

let currentCall: WebSocket | null = null;
let currentLogs: WebSocket | null = null;

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  console.log("[WS] connection", {
    pathname: url.pathname,
    host: req.headers.host,
    userAgent: req.headers["user-agent"] || "",
    xForwardedFor: req.headers["x-forwarded-for"] || "",
  });
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 1) {
    ws.close();
    return;
  }

  const type = parts[0];

  if (type === "call") {
    if (currentCall) currentCall.close();
    currentCall = ws;
    handleCallConnection(currentCall, OPENAI_API_KEY);
  } else if (type === "logs") {
    if (currentLogs) currentLogs.close();
    currentLogs = ws;
    handleFrontendConnection(currentLogs);
  } else {
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
