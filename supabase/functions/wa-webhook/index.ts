// Webhook WhatsApp Cloud API: verifikasi (GET), pesan masuk & status pengiriman (POST).
// Deploy dengan: supabase functions deploy wa-webhook --no-verify-jwt
// Secrets: WA_VERIFY_TOKEN, WA_APP_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const enc = new TextEncoder();

async function sigHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const STATUS_MAP: Record<string, string> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- Verifikasi saat mendaftarkan webhook di Meta ---
  if (req.method === "GET") {
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === Deno.env.get("WA_VERIFY_TOKEN")
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  const appSecret = Deno.env.get("WA_APP_SECRET");
  if (!appSecret) return new Response("Server belum dikonfigurasi", { status: 500 });
  const provided = (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  if (!provided || !safeEqual(provided, await sigHex(appSecret, raw))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const payload = JSON.parse(raw);
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};

        // Status pengiriman
        for (const st of v.statuses ?? []) {
          const mapped = STATUS_MAP[st.status];
          if (!mapped) continue;
          await sb.from("wa_messages").update({
            status: mapped,
            error: mapped === "failed" ? (st.errors?.[0]?.title ?? "Gagal terkirim") : null,
          }).eq("wa_message_id", st.id);
        }

        // Pesan masuk
        for (const m of v.messages ?? []) {
          const phone = String(m.from ?? "");
          const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`;
          const { data: donor } = await sb.from("donors").select("id").eq("phone", phone).maybeSingle();

          await sb.from("wa_messages").insert({
            donor_id: donor?.id ?? null, phone, direction: "in", body: text,
            status: "received", wa_message_id: m.id,
          });

          // Opt-out otomatis
          if (/^\s*(stop|berhenti|unsubscribe)\s*$/i.test(text) && donor?.id) {
            await sb.from("donors").update({ wa_opt_in: false }).eq("id", donor.id);
          }
        }
      }
    }
  } catch (e) {
    console.error("wa-webhook error", e);
  }
  // Selalu 200 agar Meta tidak mengulang pengiriman
  return new Response("ok", { status: 200 });
});
