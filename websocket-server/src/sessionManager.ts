import { RawData, WebSocket } from "ws";
import functions from "./functionHandlers";
import { postPhoneTranscript } from "./systemWebhook";

const ASSISTANT_NAME = process.env.ASSISTANT_NAME || "Avery";
const COMPANY_NAME = process.env.COMPANY_NAME || "Example Company";
const COMPANY_DOMAIN = process.env.COMPANY_DOMAIN || "example.com";
const FOUNDER_NAME = process.env.FOUNDER_NAME || "the founder";
const COMPANY_CITY = process.env.COMPANY_CITY || "your city";
const COMPANY_REGION = process.env.COMPANY_REGION || "your region";
const BUSINESS_DESCRIPTOR = process.env.BUSINESS_DESCRIPTOR || "technology services company";
const INBOUND_GREETING = process.env.INBOUND_GREETING || `${COMPANY_NAME}, this is ${ASSISTANT_NAME}. How can I help you?`;

interface TranscriptEntry {
  role: "voss" | "caller";
  text: string;
  timestamp: string;
}

export type OutboundScenario = "confirmation" | "crisis" | "cold_call" | "sales_call" | "custom";

export interface OutboundContext {
  direction: "outbound";
  to: string;
  caller_name: string;
  company_name?: string;
  appointment_date: string;
  appointment_time: string;
  purpose: string;
  scenario: OutboundScenario;
  prospect_context?: string;
  custom_instructions?: string;
}

interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  callSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  transcript?: TranscriptEntry[];
  callerPhone?: string;
  callStartTime?: string;
  outbound?: OutboundContext;
  preWarmed?: boolean;
  modelReady?: boolean;
  greetingAudioBuffer?: string[];
  greetingBuffering?: boolean;
  greetingComplete?: boolean;
  live?: boolean;  // true once Twilio is connected and audio is flowing
  mediaCount?: number;
  turnCount?: number;  // track response cycles for post-turn-1 tuning
}

let session: Session = {};
let pendingOutboundContext: OutboundContext | null = null;

/** Set context for the next outbound call (called before Twilio connects) */
export function setOutboundContext(ctx: OutboundContext) {
  pendingOutboundContext = ctx;
}

// ─── Session config builder (matches docs 02-session-config.md) ─────────────

const OUTBOUND_SAVED_PROMPT_ID = process.env.OPENAI_SAVED_PROMPT_ID || "";
const OUTBOUND_SAVED_PROMPT_VERSION = process.env.OPENAI_SAVED_PROMPT_VERSION || "1";

function buildSessionConfig(isOutbound: boolean, instructions: string, voiceName: string, tools: any[]) {
  // model + type are set via the WS URL, not in session.update
  const sessionConfig: any = {
    modalities: ["text", "audio"],
    turn_detection: {
      type: "semantic_vad",
      eagerness: "high",
      create_response: true,
      interrupt_response: true,
    },
    tools,
    input_audio_transcription: { model: "whisper-1" },
    input_audio_format: "g711_ulaw",
    output_audio_format: "g711_ulaw",
  };

  if (isOutbound) {
    if (OUTBOUND_SAVED_PROMPT_ID) {
      sessionConfig.prompt = { id: OUTBOUND_SAVED_PROMPT_ID, version: OUTBOUND_SAVED_PROMPT_VERSION };
    }
    sessionConfig.instructions = instructions;
  } else {
    sessionConfig.instructions = instructions;
    sessionConfig.voice = voiceName;
  }

  return {
    type: "session.update",
    session: sessionConfig,
  };
}

/** Pre-warm the OpenAI Realtime session before the call connects */
export function preWarmSession(openAIApiKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pendingOutboundContext) {
      console.error("[PRE-WARM] No outbound context set");
      resolve(false);
      return;
    }

    if (isOpen(session.modelConn)) {
      session.modelConn.close();
    }

    session.openAIApiKey = openAIApiKey;
    session.outbound = pendingOutboundContext;
    session.callerPhone = pendingOutboundContext.to;
    session.preWarmed = true;
    session.modelReady = false;
    session.greetingAudioBuffer = [];
    session.greetingBuffering = false;
    session.greetingComplete = false;
    session.live = false;
    session.mediaCount = 0;
    session.turnCount = 0;
    session.transcript = [];
    session.callStartTime = new Date().toISOString();

    console.log("[PRE-WARM] Connecting to OpenAI Realtime for", session.outbound.scenario, "call to", session.outbound.caller_name);

    session.modelConn = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5",
      {
        headers: {
          Authorization: `Bearer ${openAIApiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    const timeout = setTimeout(() => {
      console.error("[PRE-WARM] Timed out");
      resolve(false);
    }, 10000);

    session.modelConn.on("open", () => {
      console.log("[PRE-WARM] OpenAI WebSocket open, waiting for session.created...");
    });

    session.modelConn.on("message", (data: RawData) => {
      const event = parseMessage(data);
      if (!event) return;

      // Log non-audio events during pre-warm (with full error details)
      if (event.type !== "response.output_audio.delta" && event.type !== "response.audio.delta") {
        console.log("[PRE-WARM] Event:", event.type, event.error ? JSON.stringify(event.error) : "");
      }

      if (event.type === "session.created") {
        console.log("[PRE-WARM] Session created, sending config...");

        const isOutbound = !!session.outbound;
        const instructions = isOutbound
          ? getOutboundInstructions(session.outbound!)
          : getInboundInstructions();
        const voiceConfig = getVoiceConfig(isOutbound ? session.outbound!.scenario : "inbound");
        // Lean toolset for first turn — full tools added after response.done
        const tools = getLeanTools();

        // Send session.update — wait for session.updated before triggering greeting
        jsonSend(session.modelConn, buildSessionConfig(isOutbound, instructions, voiceConfig.voice, tools));
      }

      if (event.type === "session.updated") {
        clearTimeout(timeout);
        const isOutbound = !!session.outbound;

        if (isOutbound) {
          // OUTBOUND: warm the inference pipeline, but do not generate a live
          // audible turn until Twilio is actually connected.
          console.log("[PRE-WARM] Session configured — outbound, warming inference pipeline (text-only)");
          jsonSend(session.modelConn, {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "The outbound call is connecting. Be ready to greet immediately once the callee answers." }],
            },
          });
          jsonSend(session.modelConn, {
            type: "response.create",
            response: { modalities: ["text"] },
          });
          session.modelReady = true;
          resolve(true);
        } else {
          // INBOUND: generate the opening greeting audio during pre-warm so it
          // can be flushed immediately when Twilio connects.
          console.log("[PRE-WARM] Session configured, triggering inbound greeting...");
          const greetingText = `Greet the caller: '${INBOUND_GREETING}'`;
          jsonSend(session.modelConn, {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: greetingText }],
            },
          });
          jsonSend(session.modelConn, { type: "response.create" });
          session.greetingBuffering = true;
          session.modelReady = true;
          resolve(true);
        }
      }

      // Buffer greeting audio during pre-warm
      if (session.greetingBuffering) {
        if ((event.type === "response.output_audio.delta" || event.type === "response.audio.delta") && event.delta) {
          session.greetingAudioBuffer!.push(event.delta);
        }
        if (event.type === "response.output_audio.done" || event.type === "response.audio.done") {
          session.greetingBuffering = false;
          session.greetingComplete = true;
          console.log("[PRE-WARM] Greeting buffered:", session.greetingAudioBuffer!.length, "chunks");
          // If Twilio already connected, flush now
          if (session.streamSid && session.twilioConn) {
            flushGreetingBuffer();
          }
        }
      }

      // Capture greeting transcript
      if (event.type === "response.audio_transcript.done" && event.transcript) {
        console.log("[PRE-WARM] Greeting transcript:", event.transcript);
        if (session.transcript) {
          session.transcript.push({
            role: "voss",
            text: event.transcript,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Track assistant item for truncation
      if ((event.type === "response.output_audio.delta" || event.type === "response.audio.delta") && event.item_id) {
        session.lastAssistantItem = event.item_id;
      }

      // Forward to frontend if connected
      jsonSend(session.frontendConn, event);
    });

    session.modelConn.on("error", (err) => {
      clearTimeout(timeout);
      console.error("[PRE-WARM] OpenAI error:", err.message || err);
      resolve(false);
    });

    session.modelConn.on("close", (code, reason) => {
      clearTimeout(timeout);
      console.log("[PRE-WARM] OpenAI closed:", code, reason?.toString());
      if (!session.modelReady) resolve(false);
    });
  });
}

function flushGreetingBuffer() {
  if (!session.streamSid || !session.twilioConn) return;
  session.live = true;

  // Pad ~500ms of silence before greeting so the callee hears it cleanly
  // after pickup, not mid-word. 8kHz μ-law silence = 0xFF bytes.
  const silenceBytes = 4000; // 500ms at 8kHz
  const silenceBuf = Buffer.alloc(silenceBytes, 0xff);
  const silencePayload = silenceBuf.toString("base64");
  jsonSend(session.twilioConn, {
    event: "media",
    streamSid: session.streamSid,
    media: { payload: silencePayload },
  });

  console.log("[CALL] Flushing", session.greetingAudioBuffer?.length || 0, "greeting chunks to Twilio (after 500ms silence pad)");
  if (session.greetingAudioBuffer) {
    for (const chunk of session.greetingAudioBuffer) {
      jsonSend(session.twilioConn, {
        event: "media",
        streamSid: session.streamSid,
        media: { payload: chunk },
      });
    }
    session.greetingAudioBuffer = [];
  }
}

/** Get the verified Twilio caller ID for the current call */
export function getCallerPhone(): string | undefined {
  return session.callerPhone;
}

/** Get active Twilio call SID */
export function getActiveCallSid(): string | undefined {
  return session.callSid;
}

export function handleCallConnection(ws: WebSocket, openAIApiKey: string) {
  cleanupConnection(session.twilioConn);
  session.twilioConn = ws;
  session.openAIApiKey = openAIApiKey;

  ws.on("message", handleTwilioMessage);
  ws.on("error", ws.close);
  ws.on("close", () => {
    sendTranscriptToWebhook();
    cleanupConnection(session.modelConn);
    cleanupConnection(session.twilioConn);
    session.twilioConn = undefined;
    session.modelConn = undefined;
    session.streamSid = undefined;
    session.callSid = undefined;
    session.lastAssistantItem = undefined;
    session.responseStartTimestamp = undefined;
    session.latestMediaTimestamp = undefined;
    session.preWarmed = undefined;
    session.modelReady = undefined;
    session.greetingAudioBuffer = undefined;
    session.greetingBuffering = undefined;
    session.greetingComplete = undefined;
    session.live = undefined;
    session.mediaCount = undefined;
    if (!session.frontendConn) session = {};
  });
}

export function handleFrontendConnection(ws: WebSocket) {
  cleanupConnection(session.frontendConn);
  session.frontendConn = ws;

  ws.on("message", handleFrontendMessage);
  ws.on("close", () => {
    cleanupConnection(session.frontendConn);
    session.frontendConn = undefined;
    if (!session.twilioConn && !session.modelConn) session = {};
  });
}

async function handleFunctionCall(item: { name: string; arguments: string }) {
  console.log("Handling function call:", item);
  const fnDef = functions.find((f) => f.schema.name === item.name);
  if (!fnDef) {
    throw new Error(`No handler found for function: ${item.name}`);
  }

  let args: unknown;
  try {
    args = JSON.parse(item.arguments);
  } catch {
    return JSON.stringify({
      error: "Invalid JSON arguments for function call.",
    });
  }

  try {
    console.log("Calling function:", fnDef.schema.name, args);
    const result = await fnDef.handler(args as any);
    return result;
  } catch (err: any) {
    console.error("Error running function:", err);
    return JSON.stringify({
      error: `Error running function ${item.name}: ${err.message}`,
    });
  }
}

function handleTwilioMessage(data: RawData) {
  const msg = parseMessage(data);
  if (!msg) return;

  switch (msg.event) {
    case "start":
      console.log("[CALL] Twilio stream started, streamSid:", msg.start.streamSid);
      session.streamSid = msg.start.streamSid;
      session.callSid = msg.start?.callSid;
      session.latestMediaTimestamp = 0;
      session.responseStartTimestamp = undefined;
      session.mediaCount = 0;

      const params = msg.start?.customParameters;

      if (session.preWarmed && session.modelReady) {
        // ─── PRE-WARMED PATH ───
        console.log("[CALL] PRE-WARMED session ready, greetingComplete:", session.greetingComplete);

        // Switch model message handler to the live handler
        session.modelConn?.removeAllListeners("message");
        session.modelConn?.on("message", handleModelMessage);

        if (session.outbound) {
          // OUTBOUND: greet immediately on answer.
          console.log("[CALL] Outbound — triggering opening greeting");
          session.greetingAudioBuffer = [];
          session.live = true;
          const greetingText = getOutboundGreeting(session.outbound);
          jsonSend(session.modelConn, {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: greetingText }],
            },
          });
          jsonSend(session.modelConn, { type: "response.create" });
        } else if (session.greetingComplete) {
          // INBOUND: flush buffered greeting
          flushGreetingBuffer();
        }
        // else: inbound greeting still buffering, will flush on audio.done

      } else if (params?.direction === "outbound") {
        // ─── NON-PRE-WARMED OUTBOUND: fallback
        session.outbound = pendingOutboundContext || {
          direction: "outbound" as const,
          to: params.to || "unknown",
          caller_name: params.caller_name || "",
          appointment_date: "",
          appointment_time: "",
          purpose: params.purpose || "outbound",
          scenario: (params.scenario || params.purpose || "custom") as OutboundScenario,
        };
        session.callerPhone = params.to || pendingOutboundContext?.to;
        pendingOutboundContext = null;
        session.transcript = [];
        session.callStartTime = new Date().toISOString();
        console.log("[CALL] OUTBOUND (no pre-warm) to:", session.callerPhone, "scenario:", session.outbound!.scenario);
        tryConnectModel();

      } else {
        // ─── INBOUND CALL
        if (params?.from) {
          session.callerPhone = params.from;
        } else if (msg.start?.callSid) {
          session.callerPhone = msg.start.callSid;
        }
        session.outbound = undefined;
        session.transcript = [];
        session.callStartTime = new Date().toISOString();
        console.log("[CALL] INBOUND from:", session.callerPhone || "unknown");
        tryConnectModel();
      }
      break;

    case "media": {
      session.latestMediaTimestamp = msg.media.timestamp;
      session.mediaCount = (session.mediaCount || 0) + 1;
      if (session.mediaCount === 1 || session.mediaCount === 10 || session.mediaCount === 50 || session.mediaCount % 200 === 0) {
        console.log(`[MEDIA] packet #${session.mediaCount}, modelOpen: ${isOpen(session.modelConn)}, live: ${session.live}`);
      }
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        });
      }
      break;
    }

    case "stop":
    case "close":
      sendTranscriptToWebhook();
      closeAllConnections();
      break;
  }
}

function handleFrontendMessage(data: RawData) {
  const msg = parseMessage(data);
  if (!msg) return;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, msg);
  }

  if (msg.type === "session.update") {
    session.saved_config = msg.session;
  }
}

function tryConnectModel() {
  if (!session.twilioConn || !session.streamSid || !session.openAIApiKey)
    return;
  if (isOpen(session.modelConn)) return;

  session.modelConn = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5",
    {
      headers: {
        Authorization: `Bearer ${session.openAIApiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  session.modelConn.on("open", () => {
    console.log("[CALL] OpenAI Realtime WebSocket open (waiting for session.created)");
  });

  session.modelConn.on("message", handleModelMessage);
  session.modelConn.on("error", (err) => {
    console.error("[CALL] OpenAI Realtime error:", err.message || err);
    closeModel();
  });
  session.modelConn.on("close", (code, reason) => {
    console.log("[CALL] OpenAI Realtime closed, code:", code, "reason:", reason?.toString());
    closeModel();
  });
}

function handleModelMessage(data: RawData) {
  const event = parseMessage(data);
  if (!event) return;

  // Log events
  if (event.type === "response.audio_transcript.delta") {
    process.stdout.write(event.delta || "");
  } else if (event.type === "response.audio_transcript.done") {
    console.log("\n[CALL] Full transcript:", event.transcript || "(empty)");
    if (event.transcript && session.transcript) {
      session.transcript.push({
        role: "voss",
        text: event.transcript,
        timestamp: new Date().toISOString(),
      });
    }
  } else if (event.type === "conversation.item.input_audio_transcription.completed") {
    if (event.transcript && session.transcript) {
      session.transcript.push({
        role: "caller",
        text: event.transcript,
        timestamp: new Date().toISOString(),
      });
    }
  } else if (event.type !== "response.output_audio.delta" && event.type !== "response.audio.delta") {
    console.log("[CALL] OpenAI event:", event.type, event.error ? JSON.stringify(event.error) : "");
  }

  // Handle greeting completion in live handler (if greeting wasn't done during pre-warm)
  if (session.greetingBuffering) {
    if ((event.type === "response.output_audio.delta" || event.type === "response.audio.delta") && event.delta) {
      session.greetingAudioBuffer!.push(event.delta);
    }
    if (event.type === "response.output_audio.done" || event.type === "response.audio.done") {
      session.greetingBuffering = false;
      session.greetingComplete = true;
      console.log("[CALL] Late greeting complete, flushing", session.greetingAudioBuffer?.length, "chunks");
      flushGreetingBuffer();
    }
  }

  // Non-pre-warmed path: configure on session.created
  if (event.type === "session.created" && !session.preWarmed) {
    const isOutbound = !!session.outbound;
    const scenario = session.outbound?.scenario || "inbound";
    console.log(`[CALL] Session created (${isOutbound ? "OUTBOUND:" + scenario : "INBOUND"}), configuring...`);

    const instructions = isOutbound
      ? getOutboundInstructions(session.outbound!)
      : getInboundInstructions();
    const voiceConfig = getVoiceConfig(isOutbound ? session.outbound!.scenario : "inbound");
    const tools = getLeanTools();

    jsonSend(session.modelConn, buildSessionConfig(isOutbound, instructions, voiceConfig.voice, tools));
  }

  // Non-pre-warmed: only the first session.updated should trigger the opening greeting.
  // Later session.updated events can come from our own session.update calls, for example
  // when loading the full toolset after the first response, and must not retrigger speech.
  if (event.type === "session.updated" && !session.preWarmed && !session.live) {
    const isOutbound = !!session.outbound;
    if (isOutbound) {
      // Outbound: greet immediately on answer.
      console.log("[CALL] Non-pre-warmed outbound — triggering opening greeting");
      session.live = true;
      const greetingText = getOutboundGreeting(session.outbound!);
      jsonSend(session.modelConn, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: greetingText }],
        },
      });
      jsonSend(session.modelConn, { type: "response.create" });
    } else {
      // Inbound: generate greeting
      const greetingText = `Greet the caller: '${INBOUND_GREETING}'`;
      jsonSend(session.modelConn, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: greetingText }],
        },
      });
      jsonSend(session.modelConn, { type: "response.create" });
      session.live = true;
    }
  }

  jsonSend(session.frontendConn, event);

  switch (event.type) {
    case "input_audio_buffer.speech_started":
      console.log("[CALL] Speech detected — truncating");
      handleTruncation();
      break;

    case "response.output_audio.delta":
    case "response.audio.delta":
      if (session.twilioConn && session.streamSid && session.live) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
        }
        if (event.item_id) session.lastAssistantItem = event.item_id;

        // Audio delta is already base64 PCMU per docs — forward directly
        jsonSend(session.twilioConn, {
          event: "media",
          streamSid: session.streamSid,
          media: { payload: event.delta },
        });

        jsonSend(session.twilioConn, {
          event: "mark",
          streamSid: session.streamSid,
          mark: { name: "response_chunk" }
        });
      }
      break;

    case "response.output_item.done": {
      const { item } = event;
      if (item.type === "function_call") {
        handleFunctionCall(item)
          .then((output) => {
            if (session.modelConn) {
              jsonSend(session.modelConn, {
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: item.call_id,
                  output: JSON.stringify(output),
                },
              });
              jsonSend(session.modelConn, { type: "response.create" });
            }
          })
          .catch((err) => {
            console.error("Error handling function call:", err);
          });
      }
      break;
    }

    case "response.done": {
      // After first response: load the full toolset.
      // Do not re-send turn_detection here, because that has been
      // causing an immediate second auto-response right after the greeting.
      session.turnCount = (session.turnCount || 0) + 1;
      if (session.turnCount === 1) {
        console.log("[CALL] First response done — loading full tools without retriggering speech");
        const fullTools = getToolsForScenario(session.outbound?.scenario);
        jsonSend(session.modelConn, {
          type: "session.update",
          session: {
            tools: fullTools,
          },
        });
      }
      break;
    }
  }
}

// ─── Truncation (barge-in) ──────────────────────────────────────────────────

function handleTruncation() {
  if (
    !session.lastAssistantItem ||
    session.responseStartTimestamp === undefined
  )
    return;

  const elapsedMs =
    (session.latestMediaTimestamp || 0) - (session.responseStartTimestamp || 0);
  const audio_end_ms = elapsedMs > 0 ? elapsedMs : 0;

  if (isOpen(session.modelConn) && audio_end_ms > 0) {
    jsonSend(session.modelConn, {
      type: "conversation.item.truncate",
      item_id: session.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    });
  }

  if (session.twilioConn && session.streamSid) {
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    });
  }

  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

function closeModel() {
  cleanupConnection(session.modelConn);
  session.modelConn = undefined;
  if (!session.twilioConn && !session.frontendConn) session = {};
}

async function sendTranscriptToWebhook() {
  if (!session.transcript || session.transcript.length === 0) {
    console.log("[CALL] No transcript to send");
    return;
  }

  const transcriptText = session.transcript
    .map((entry) => `[${entry.role === "voss" ? ASSISTANT_NAME : "Caller"}] ${entry.text}`)
    .join("\n");

  const payload: Record<string, any> = {
    event: "call_ended",
    direction: session.outbound ? "outbound" : "inbound",
    caller_phone: session.callerPhone || "unknown",
    call_start: session.callStartTime || new Date().toISOString(),
    call_end: new Date().toISOString(),
    turn_count: session.transcript.length,
    transcript: transcriptText,
  };

  if (session.outbound) {
    payload.outbound_context = {
      caller_name: session.outbound.caller_name,
      company_name: session.outbound.company_name,
      appointment_date: session.outbound.appointment_date,
      appointment_time: session.outbound.appointment_time,
      purpose: session.outbound.purpose,
      scenario: session.outbound.scenario,
      prospect_context: session.outbound.prospect_context,
      custom_instructions: session.outbound.custom_instructions,
    };
  }

  console.log("[CALL] Sending transcript to webhook:", JSON.stringify(payload, null, 2));
  await postPhoneTranscript(payload, "call-ended");
}

// ─── Voice config per scenario ───────────────────────────────────────────────

function getVoiceConfig(scenario: OutboundScenario | "inbound"): { voice: string; temperature: number } {
  // Outbound voice/settings now come from the saved Realtime prompt.
  // Keep inbound on a supported RTM voice.
  return { voice: "cedar", temperature: 0.65 };
}

// ─── Tool selection per scenario ─────────────────────────────────────────────

function getLeanTools() {
  // Minimal tools for first turn — reduces inference overhead
  return [{ type: "function" as const, name: "get_current_time", description: "Get the current date and time in Pacific timezone.", parameters: { type: "object", properties: {}, required: [] as string[] } }];
}

function getToolsForScenario(scenario?: OutboundScenario) {
  const timeOnly = [{ type: "function" as const, name: "get_current_time", description: "Get the current date and time in Pacific timezone.", parameters: { type: "object", properties: {}, required: [] as string[] } }];

  const allTools = functions.map((f) => ({
    type: "function" as const,
    name: f.schema.name,
    description: f.schema.description,
    parameters: f.schema.parameters,
  }));

  switch (scenario) {
    case "confirmation":
      return timeOnly;
    default:
      return allTools;
  }
}

// ─── Outbound greetings per scenario ─────────────────────────────────────────

function getOutboundGreeting(ctx: OutboundContext): string {
  const name = ctx.caller_name;

  // Brief opener — identify yourself, then listen.
  switch (ctx.scenario) {
    case "crisis":
      return `Say briefly: "Hi, is this ${name}? This is ${ASSISTANT_NAME} with ${COMPANY_NAME}."`;

    case "cold_call":
      return `Say briefly: "Hey ${name}, this is ${ASSISTANT_NAME} with ${COMPANY_NAME}."`;

    case "sales_call":
      return `Say briefly: "Hey ${name}, this is ${ASSISTANT_NAME} with ${COMPANY_NAME}."`;

    case "confirmation":
      return `Say briefly: "Hey ${name}, this is ${ASSISTANT_NAME} from ${COMPANY_NAME}, calling about your appointment."`;

    case "custom":
      return ctx.custom_instructions
        ? `Say ONE short greeting, then listen: ${ctx.custom_instructions}`
        : `Say briefly: "Hey ${name}, this is ${ASSISTANT_NAME} with ${COMPANY_NAME}."`;

    default:
      return `Say briefly: "Hey ${name}, this is ${ASSISTANT_NAME} with ${COMPANY_NAME}."`;
  }
}

// ─── Outbound prompt: scenario-driven ────────────────────────────────────────

function getOutboundInstructions(ctx: OutboundContext): string {
  // ─── Compressed prompt: ~550 tokens (down from ~1200) ─────────────────────
  // Behavior-preserving. Same personality, same rules, half the tokens.

  const identity = `You are ${ASSISTANT_NAME} from ${COMPANY_NAME} (${COMPANY_DOMAIN}), a ${BUSINESS_DESCRIPTOR} based in ${COMPANY_CITY}, ${COMPANY_REGION}. Founded by ${FOUNDER_NAME}.

CALL BEHAVIOR: Outbound call. Greet first as soon as they answer, then identify yourself and state purpose. 1-2 sentences per turn.

VOICE: Late-night radio DJ. Calm, low energy, downflect sentences. Never rushed, never performative.`;

  const services = `

SERVICES (discuss only if relevant):
- ${COMPANY_NAME}: describe your actual services here
- Replace these example service lines with your own offerings before production`;

  const prospectBriefing = ctx.prospect_context
    ? `\nPROSPECT INTEL (guide conversation, never quote verbatim, never say "our research"):\n${ctx.prospect_context}`
    : "";

  const rules = `

RULES: Sound human, relaxed, natural pauses, casual. Never scripted. Let them talk. Silence is fine. If busy: "Better time to call back?" If not interested: gracious, move on. If asked something technical: "I can have a teammate follow up with you on that properly, if you'd like." Never pressure. Never mention AI. If asked: "I work with the team here."`;

  switch (ctx.scenario) {
    case "crisis":
      return `${identity}${services}
SCENARIO: Empathetic outreach for an urgent operational problem.${prospectBriefing}
APPROACH: Genuine concern, not a pitch. Calm and steady. Offer a short diagnostic or a brief follow-up call with a teammate. If not interested: "No worries. Take care."${rules}`;

    case "cold_call":
      return `${identity}${services}
SCENARIO: First-touch intro. NOT a sales call.${prospectBriefing}
APPROACH: 60-90 seconds max. Goal: they understand what your company does and remember how to reach you. One sentence about what you do, then stop. Leave them with name, company, website.${rules}`;

    case "sales_call":
      return `${identity}${services}
SCENARIO: Discovery + sales conversation. Prospect is warm.${prospectBriefing}
APPROACH: Discover first, present second. Only show relevant services. Close on a next step, a booked call, or an email follow-up.${rules}`;

    case "confirmation":
      return `${identity}
SCENARIO: Appointment confirmation. ${ctx.caller_name}, ${ctx.appointment_date || "TBD"} at ${ctx.appointment_time || "TBD"} Pacific. Purpose: ${ctx.purpose}.
APPROACH: 30-second call. Confirm, reschedule, or cancel. Don't pitch.${rules}`;

    case "custom": {
      return ctx.custom_instructions
        ? `${identity}${services}${prospectBriefing}
SCENARIO: Custom call mission.
APPROACH: Follow the mission brief below. Treat it as the goal and constraints for this call. Keep it natural. Do not invent extra policies, fallback paths, transfer offers, or scheduling assumptions that are not stated in the brief.
MISSION BRIEF:
${ctx.custom_instructions}${rules}`
        : `${identity}${services}${prospectBriefing}
SCENARIO: Custom call mission.
APPROACH: Keep the call brief, natural, and focused on the stated purpose. If the goal is not clear from context, clarify quickly and move to the next step.${rules}`;
    }

    default:
      return `${identity}${services}${prospectBriefing}${rules}`;
  }
}

// ─── Prompt: Inbound receptionist ────────────────────────────────────────────

function getInboundInstructions(): string {
  return `You are ${ASSISTANT_NAME}, the phone agent for ${COMPANY_NAME}.

VOICE STYLE:
- calm, composed, downflect the end of a sentence
- think late night radio DJ voice — that's you
- relaxed, unhurried, low energy, confident

About ${COMPANY_NAME}:
- ${BUSINESS_DESCRIPTOR} based in ${COMPANY_CITY}, ${COMPANY_REGION}
- Founded by ${FOUNDER_NAME}
- Services: replace with your actual services
- Website: ${COMPANY_DOMAIN}

Your role:
- Professional, concise, calm. Nothing rattles you.
- Schedule appointments, answer service questions, take messages, transfer to a teammate when configured
- Keep responses to 1-2 sentences. Speak naturally.
- Treat ordinary frustration, cursing, or sarcasm as normal phone conversation, not as a mental health crisis.
- Do not suggest the caller talk to a trusted person, seek professional help, or use support resources unless they clearly ask for mental health help or express imminent risk of self-harm.
- If the caller sounds annoyed, just acknowledge it briefly and move the call forward, for example: "Yeah, I hear you. What can I help with?"

Scheduling: collect name, email, phone, topic. Then check_availability and offer 2-3 slots.

If unsure: "Let me have a teammate follow up with you on that." Never guess.

Company services:
- Replace this section with your actual services, brands, and offers before production.`;
}

function closeAllConnections() {
  if (session.twilioConn) {
    session.twilioConn.close();
    session.twilioConn = undefined;
  }
  if (session.modelConn) {
    session.modelConn.close();
    session.modelConn = undefined;
  }
  if (session.frontendConn) {
    session.frontendConn.close();
    session.frontendConn = undefined;
  }
  session.streamSid = undefined;
  session.callSid = undefined;
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.latestMediaTimestamp = undefined;
  session.saved_config = undefined;
  session.outbound = undefined;
  session.preWarmed = undefined;
  session.modelReady = undefined;
  session.greetingAudioBuffer = undefined;
  session.greetingBuffering = undefined;
  session.greetingComplete = undefined;
  session.live = undefined;
  session.mediaCount = undefined;
}

function cleanupConnection(ws?: WebSocket) {
  if (isOpen(ws)) ws.close();
}

function parseMessage(data: RawData): any {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));
}

function isOpen(ws?: WebSocket): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}
