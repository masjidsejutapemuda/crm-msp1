// Menerima webhook Scalev -> simpan ke Supabase real-time.
// Deploy: supabase functions deploy scalev-webhook --no-verify-jwt
// Secret: SCALEV_WEBHOOK_SECRET = "Signing Secret" dari Scalev > Developers > Webhooks.
// Tanda tangan Scalev: header X-Scalev-Hmac-Sha256, HMAC-SHA256 atas body mentah, encoding Base64.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { loadCategoryIds, mapOrder, upsertOrder } from "../_shared/scalev.ts";

const enc = new TextEncoder();

async function hmacRaw(secret: string, body: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}
const toHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Event yang membawa data order untuk dicatat sebagai donasi
const HANDLED = new Set([
  "order.created", "order.updated", "order.status_changed", "order.payment_status_changed",
  "order.epayment_created", "payment.received", "payment.failed",
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  const secret = Deno.env.get("SCALEV_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Server belum dikonfigurasi" }, 500);

  // Verifikasi tanda tangan (Base64 sesuai dokumentasi Scalev; hex diterima sebagai cadangan)
  const headerName = (Deno.env.get("SCALEV_SIGNATURE_HEADER") ?? "x-scalev-hmac-sha256").toLowerCase();
  const provided = (req.headers.get(headerName) ?? "").trim();
  const sig = await hmacRaw(secret, raw);
  const okB64 = provided && safeEqual(provided, toB64(sig));
  const okHex = provided && safeEqual(provided.toLowerCase().replace(/^sha256=/, ""), toHex(sig));
  if (!okB64 && !okHex) return json({ error: "Tanda tangan tidak valid" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const started = new Date().toISOString();
  const log = (row: Record<string, unknown>) =>
    sb.from("sync_logs").insert({ trigger: "webhook", started_at: started, finished_at: new Date().toISOString(), ...row });

  try {
    const payload = JSON.parse(raw);
    const event = String(payload.event ?? "");
    const order = payload.data ?? payload;

    // Event yang tidak relevan: balas 200 agar Scalev tidak mengulang
    if (event === "order.deleted") {
      const id = String(order?.id ?? order?.order_id ?? "");
      if (id) await sb.from("donations").update({ status: "failed" }).eq("scalev_order_id", id);
      await log({ status: "sukses", message: `order.deleted ${id}` });
      return json({ ok: true, event });
    }
    if (event && !HANDLED.has(event)) return json({ ok: true, ignored: event });
    if (order?.is_probably_spam === true) return json({ ok: true, ignored: "spam" });

    const mapped = mapOrder(order);
    if (!mapped) {
      await log({ status: "gagal", message: `Payload ${event || "?"} tidak berisi order yang dikenali` });
      return json({ ok: false, error: "Payload tidak dikenali" }, 422);
    }
    const result = await upsertOrder(sb, mapped, await loadCategoryIds(sb));
    await log({
      status: "sukses", fetched: 1,
      inserted: result === "inserted" ? 1 : 0, updated: result === "updated" ? 1 : 0, skipped: result === "skipped" ? 1 : 0,
      message: `${event || "order"} ${mapped.scalev_order_id}`,
    });
    return json({ ok: true, result });
  } catch (e) {
    await log({ status: "gagal", message: String((e as Error).message ?? e) });
    return json({ ok: false, error: "Gagal memproses" }, 500);
  }
});
