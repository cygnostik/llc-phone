const PHONE_TRANSCRIPT_HOOK_URL = process.env.TRANSCRIPT_WEBHOOK_URL || "";

function getHookHeaders(): Record<string, string> {
  const token = (process.env.TRANSCRIPT_WEBHOOK_BEARER_TOKEN || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function postPhoneTranscript(payload: Record<string, any>, source: string): Promise<void> {
  if (!PHONE_TRANSCRIPT_HOOK_URL) {
    return;
  }

  try {
    const resp = await fetch(PHONE_TRANSCRIPT_HOOK_URL, {
      method: "POST",
      headers: getHookHeaders(),
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[HOOK:${source}] call webhook failed (${resp.status}):`, body || "(empty)");
      return;
    }

    console.log(`[HOOK:${source}] call webhook delivered (${resp.status})`);
  } catch (err: any) {
    console.error(`[HOOK:${source}] call webhook error:`, err.message || err);
  }
}
