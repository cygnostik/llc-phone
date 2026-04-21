import { FunctionHandler } from "./types";
import { getCallerPhone, getActiveCallSid } from "./sessionManager";
import dotenv from "dotenv";
dotenv.config();

// ─── Configuration ───────────────────────────────────────────────────────────
const RADICALE_URL = process.env.RADICALE_URL || "";
const RADICALE_USER = process.env.RADICALE_USERNAME || "";
const RADICALE_PASS = process.env.RADICALE_PASSWORD || "";
const RADICALE_CALENDAR_PATH = process.env.RADICALE_CALENDAR_PATH || "";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const PUBLIC_URL = process.env.PUBLIC_URL || "";

const TRANSFER_TARGET_NUMBER = process.env.TRANSFER_TARGET_NUMBER || "";
const TRANSFER_TARGET_LABEL = process.env.TRANSFER_TARGET_LABEL || "on-call teammate";
const ASSISTANT_NAME = process.env.ASSISTANT_NAME || "Avery";
const COMPANY_NAME = process.env.COMPANY_NAME || "Example Company";
const COMPANY_DOMAIN = process.env.COMPANY_DOMAIN || "example.com";
const BUSINESS_SMS_FROM = process.env.BUSINESS_SMS_FROM || "";
const TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";
const BUSINESS_HOURS_START = parseInt(process.env.BUSINESS_HOURS_START || "8", 10);
const BUSINESS_HOURS_END = parseInt(process.env.BUSINESS_HOURS_END || "19", 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowPT(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatTimeISO(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}${m}00`;
}

function formatDateTimeISO(d: Date): string {
  return `${formatDateISO(d)}T${formatTimeISO(d)}`;
}

function caldavAuth(): string {
  return "Basic " + Buffer.from(`${RADICALE_USER}:${RADICALE_PASS}`).toString("base64");
}

function requireCalendarConfig() {
  if (!RADICALE_URL || !RADICALE_USER || !RADICALE_PASS || !RADICALE_CALENDAR_PATH) {
    throw new Error("Calendar integration is not configured. Set RADICALE_URL, RADICALE_USERNAME, RADICALE_PASSWORD, and RADICALE_CALENDAR_PATH.");
  }
}

// ─── Tool: check_availability ────────────────────────────────────────────────

const functions: FunctionHandler[] = [];

functions.push({
  schema: {
    name: "check_availability",
    type: "function",
    description:
      "Check available 30-minute appointment slots for callbacks. " +
      "Returns open slots for the requested date or the next 3 calendar days if no date specified.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Date to check in YYYY-MM-DD format. If omitted, checks the next 3 business days.",
        },
      },
      required: [],
    },
  },
  handler: async (args: { date?: string }) => {
    try {
      requireCalendarConfig();
      const now = nowPT();
      const dates: Date[] = [];

      if (args.date) {
        dates.push(new Date(args.date + "T00:00:00"));
      } else {
        // Next 3 calendar days
        let d = new Date(now);
        let count = 0;
        while (count < 3) {
          d = new Date(d.getTime() + 86400000);
          dates.push(new Date(d));
          count++;
        }
      }

      const results: Record<string, string[]> = {};

      for (const date of dates) {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 0);

        // REPORT query to CalDAV
        const reportXml = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${formatDateISO(dayStart)}T000000Z" end="${formatDateISO(dayEnd)}T235959Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

        const resp = await fetch(`${RADICALE_URL}${RADICALE_CALENDAR_PATH}`, {
          method: "REPORT",
          headers: {
            Authorization: caldavAuth(),
            "Content-Type": "application/xml; charset=utf-8",
            Depth: "1",
          },
          body: reportXml,
        });

        // Parse busy times from iCal data
        const body = await resp.text();
        const busySlots: { start: number; end: number }[] = [];
        const dtStartRegex = /DTSTART[^:]*:(\d{8}T\d{6})/g;
        const dtEndRegex = /DTEND[^:]*:(\d{8}T\d{6})/g;

        let match;
        const starts: string[] = [];
        const ends: string[] = [];
        while ((match = dtStartRegex.exec(body)) !== null) starts.push(match[1]);
        while ((match = dtEndRegex.exec(body)) !== null) ends.push(match[1]);

        for (let i = 0; i < starts.length; i++) {
          const s = starts[i];
          const e = ends[i] || starts[i];
          const sH = parseInt(s.substring(9, 11));
          const sM = parseInt(s.substring(11, 13));
          const eH = parseInt(e.substring(9, 11));
          const eM = parseInt(e.substring(11, 13));
          busySlots.push({
            start: sH * 60 + sM,
            end: eH * 60 + eM,
          });
        }

        // Generate 30-min slots across the full day
        const slots: string[] = [];
        for (let hour = 0; hour < 24; hour++) {
          for (let min = 0; min < 60; min += 30) {
            const slotStart = hour * 60 + min;
            const slotEnd = slotStart + 30;

            // Check if today and slot is already in the past
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            if (dateStr === todayStr) {
              const nowMinutes = now.getHours() * 60 + now.getMinutes();
              if (slotStart < nowMinutes) continue;
            }

            // Check conflict with existing events
            const conflict = busySlots.some(
              (b) => slotStart < b.end && slotEnd > b.start
            );
            if (!conflict) {
              const hStr = String(hour).padStart(2, "0");
              const mStr = String(min).padStart(2, "0");
              const eHour = hour + (min + 30 >= 60 ? 1 : 0);
              const eMin = (min + 30) % 60;
              slots.push(
                `${hStr}:${mStr} - ${String(eHour % 24).padStart(2, "0")}:${String(eMin).padStart(2, "0")} PT`
              );
            }
          }
        }

        const dateLabel = date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: TIMEZONE,
        });
        results[dateLabel] = slots.length > 0 ? slots : ["No available slots"];
      }

      return JSON.stringify(results);
    } catch (err: any) {
      return JSON.stringify({ error: `Failed to check availability: ${err.message}` });
    }
  },
});

// ─── Tool: book_appointment ──────────────────────────────────────────────────

functions.push({
  schema: {
    name: "book_appointment",
    type: "function",
    description:
      "Book a 30-minute callback appointment. Requires the caller's name and contact info. " +
      "Only book slots that were confirmed available via check_availability.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format",
        },
        time: {
          type: "string",
          description: "Start time in HH:MM format (24h, Pacific time), e.g. 13:00, 14:30",
        },
        caller_name: {
          type: "string",
          description: "Full name of the caller",
        },
        caller_phone: {
          type: "string",
          description: "Caller's phone number",
        },
        caller_email: {
          type: "string",
          description: "Caller's email address (optional)",
        },
        reason: {
          type: "string",
          description: "Brief description of what the callback is about",
        },
      },
      required: ["date", "time", "caller_name", "caller_phone", "reason"],
    },
  },
  handler: async (args: {
    date: string;
    time: string;
    caller_name: string;
    caller_phone: string;
    caller_email?: string;
    reason: string;
  }) => {
    try {
      const [hour, min] = args.time.split(":").map(Number);
      const startDate = new Date(`${args.date}T${args.time}:00`);
      const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

      // Use verified Twilio caller ID as the real number; keep verbal number as secondary
      const verifiedPhone = getCallerPhone();
      const bookingPhone = verifiedPhone || args.caller_phone;
      const phoneNote = verifiedPhone && verifiedPhone !== args.caller_phone
        ? `Phone (verified): ${verifiedPhone}\\nPhone (stated): ${args.caller_phone}`
        : `Phone: ${bookingPhone}`;

      requireCalendarConfig();
      const uid = `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@${COMPANY_DOMAIN}`;

      const description = [
        `Callback for: ${args.caller_name}`,
        phoneNote,
        args.caller_email ? `Email: ${args.caller_email}` : "",
        `Reason: ${args.reason}`,
        `Booked by: ${ASSISTANT_NAME} (phone agent)`,
      ]
        .filter(Boolean)
        .join("\\n");

      const ical = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `PRODID:-//${COMPANY_NAME}//${ASSISTANT_NAME} Phone Agent//EN`,
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTART;TZID=${TIMEZONE}:${formatDateTimeISO(startDate)}`,
        `DTEND;TZID=${TIMEZONE}:${formatDateTimeISO(endDate)}`,
        `SUMMARY:📞 Callback: ${args.caller_name}`,
        `DESCRIPTION:${description}`,
        `LOCATION:Phone - ${bookingPhone}`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      const resp = await fetch(
        `${RADICALE_URL}${RADICALE_CALENDAR_PATH}${uid}.ics`,
        {
          method: "PUT",
          headers: {
            Authorization: caldavAuth(),
            "Content-Type": "text/calendar; charset=utf-8",
          },
          body: ical,
        }
      );

      if (resp.status >= 200 && resp.status < 300) {
        const timeStr = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        const endHour = hour + (min + 30 >= 60 ? 1 : 0);
        const endMin = (min + 30) % 60;
        const endTimeStr = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;

        return JSON.stringify({
          success: true,
          appointment: {
            date: args.date,
            time: `${timeStr} - ${endTimeStr} PT`,
            caller: args.caller_name,
            phone: bookingPhone,
            verified_phone: verifiedPhone || null,
            reason: args.reason,
            uid: uid,
          },
        });
      } else {
        const errText = await resp.text();
        return JSON.stringify({ error: `Calendar returned ${resp.status}: ${errText}` });
      }
    } catch (err: any) {
      return JSON.stringify({ error: `Failed to book appointment: ${err.message}` });
    }
  },
});

// ─── Tool: transfer_call ─────────────────────────────────────────────────────

functions.push({
  schema: {
    name: "transfer_call",
    type: "function",
    description:
      `Warm transfer the current call to ${TRANSFER_TARGET_LABEL}. Available during configured business hours. ` +
      "Use when the caller asks to speak with a person immediately or when an immediate live handoff is the best next step. " +
      `Before transferring, briefly tell ${TRANSFER_TARGET_LABEL} why the caller is being transferred.`,
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why the caller is being transferred right now",
        },
        caller_name: {
          type: "string",
          description: "The caller's name if known",
        },
        caller_summary: {
          type: "string",
          description: `Brief summary of the conversation so far to pass to ${TRANSFER_TARGET_LABEL}`,
        },
      },
      required: ["reason"],
    },
  },
  handler: async (args: {
    reason: string;
    caller_name?: string;
    caller_summary?: string;
  }) => {
    try {
      const now = nowPT();
      const hour = now.getHours();

      // Enforce configured business hours
      if (hour < BUSINESS_HOURS_START || hour >= BUSINESS_HOURS_END) {
        return JSON.stringify({
          success: false,
          error: "Transfer not available outside configured business hours. Please schedule a callback instead.",
          current_time: `${String(hour).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
          timezone: TIMEZONE,
        });
      }

      const activeCallSid = getActiveCallSid();
      if (!activeCallSid) {
        return JSON.stringify({
          success: false,
          error: "No active call to transfer.",
        });
      }

      // Send SMS to transfer target with context before transfer
      const smsBody = [
        `📞 Incoming transfer from ${ASSISTANT_NAME}:`,
        args.caller_name ? `Caller: ${args.caller_name}` : "",
        getCallerPhone() ? `Caller phone: ${getCallerPhone()}` : "",
        `Reason: ${args.reason}`,
        args.caller_summary ? `Summary: ${args.caller_summary}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      let smsSent = false;
      if (CLICKSEND_USER && CLICKSEND_KEY) {
        const smsResp = await fetch("https://rest.clicksend.com/v3/sms/send", {
          method: "POST",
          headers: {
            Authorization: clicksendAuth(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{ to: TRANSFER_TARGET_NUMBER, body: smsBody, from: CLICKSEND_FROM }],
          }),
        });
        smsSent = smsResp.ok;
      }

      if (!TWILIO_SID || !TWILIO_TOKEN || !PUBLIC_URL) {
        return JSON.stringify({
          success: false,
          error: "Transfer plumbing incomplete: missing Twilio credentials or PUBLIC_URL.",
          sms_sent: smsSent,
        });
      }

      const transferUrl = new URL(`${PUBLIC_URL}/twiml-transfer`);
      transferUrl.searchParams.set("reason", args.reason);
      if (args.caller_name) transferUrl.searchParams.set("caller_name", args.caller_name);
      if (args.caller_summary) transferUrl.searchParams.set("caller_summary", args.caller_summary);

      const transferResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls/${activeCallSid}.json`,
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            Url: transferUrl.toString(),
            Method: "POST",
          }).toString(),
        }
      );

      if (!transferResp.ok) {
        const errBody = await transferResp.text();
        return JSON.stringify({
          success: false,
          error: `Twilio transfer update failed (${transferResp.status}): ${errBody}`,
          sms_sent: smsSent,
          call_sid: activeCallSid,
        });
      }

      return JSON.stringify({
        success: true,
        action: "transfer",
        transfer_to: TRANSFER_TARGET_NUMBER,
        warm: true,
        sms_sent: smsSent,
        reason: args.reason,
        call_sid: activeCallSid,
        message:
          `Transfer initiated. Caller is now being bridged to ${TRANSFER_TARGET_LABEL} with a whisper brief and pre-transfer SMS context.`,
      });
    } catch (err: any) {
      return JSON.stringify({ error: `Transfer failed: ${err.message}` });
    }
  },
});

// ─── Tool: send_sms (via ClickSend) ──────────────────────────────────────────

const CLICKSEND_USER = process.env.CLICKSEND_USERNAME || "";
const CLICKSEND_KEY = process.env.CLICKSEND_API_KEY || "";
const CLICKSEND_FROM = process.env.CLICKSEND_FROM || BUSINESS_SMS_FROM;

function clicksendAuth(): string {
  return "Basic " + Buffer.from(`${CLICKSEND_USER}:${CLICKSEND_KEY}`).toString("base64");
}

functions.push({
  schema: {
    name: "send_sms",
    type: "function",
    description:
      "Send an SMS text message to a phone number via ClickSend. Use for appointment confirmations, " +
      "follow-up messages, or sharing links with the caller. Always ask permission before texting. " +
      `Messages come from ${COMPANY_NAME}'s business number.`,
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Phone number to text in E.164 format (e.g., +14155551234)",
        },
        message: {
          type: "string",
          description: "The text message to send. Keep it professional and concise.",
        },
      },
      required: ["to", "message"],
    },
  },
  handler: async (args: { to: string; message: string }) => {
    try {
      const resp = await fetch("https://rest.clicksend.com/v3/sms/send", {
        method: "POST",
        headers: {
          Authorization: clicksendAuth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              to: args.to,
              body: args.message,
              from: CLICKSEND_FROM,
            },
          ],
        }),
      });

      const data = await resp.json();
      if (data.response_code === "SUCCESS") {
        return JSON.stringify({ success: true, response: data.response_msg });
      } else {
        return JSON.stringify({
          success: false,
          error: data.response_msg || data.response_code || "Unknown error",
        });
      }
    } catch (err: any) {
      return JSON.stringify({ error: `Failed to send SMS: ${err.message}` });
    }
  },
});

// ─── Tool: get_current_time ──────────────────────────────────────────────────

functions.push({
  schema: {
    name: "get_current_time",
    type: "function",
    description: "Get the current date and time in the configured business timezone. Use to determine business hours, scheduling eligibility, etc.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    const now = nowPT();
    const hour = now.getHours();
    const transferAvailable = hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
    const appointmentsToday = hour < 14; // 2-hour buffer from the last available slot
    const dayOfWeek = now.getDay();
    const isWeekday = dayOfWeek > 0 && dayOfWeek < 6;

    return JSON.stringify({
      datetime: now.toLocaleString("en-US", { timeZone: TIMEZONE }),
      hour,
      day_of_week: now.toLocaleDateString("en-US", { weekday: "long", timeZone: TIMEZONE }),
      is_weekday: isWeekday,
      transfer_available: transferAvailable,
      appointments_available_today: appointmentsToday && isWeekday,
    });
  },
});

export default functions;
