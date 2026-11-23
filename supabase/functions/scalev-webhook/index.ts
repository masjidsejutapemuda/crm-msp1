// Menerima webhook Scalev (order dibuat / dibayar) -> simpan ke Supabase real-time.
// Deploy dengan: supabase functions deploy scalev-webhook --no-verify-jwt
// Secrets: SCALEV_WEBHOOK_SECRET, (opsional) SCALEV_SIGNATURE_HEADER

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { loadCategoryIds, mapOrder, upsertOrder } from "../_shared/scalev.ts";

const enc = new TextEncoder();

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  const secret = Deno.env.get("SCALEV_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Server belum dikonfigurasi" }, 500);

  // Verifikasi tanda tangan (hex atau base64, awalan "sha256=" diizinkan)
  const headerName = (Deno.env.get("SCALEV_SIGNATURE_HEADER") ?? "x-scalev-hmac-sha256").toLowerCase();
  const provided = (req.headers.get(headerName) ?? "").replace(/^sha256=/i, "").trim();
  const okHex = provided && safeEqual(provided.toLowerCase(), await hmacHex(secret, raw));
  const okB64 = provided && safeEqual(provided, await hmacBase64(secret, raw));
  if (!okHex && !okB64) return json({ error: "Tanda tangan tidak valid" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const started = new Date().toISOString();

  try {
    const payload = JSON.parse(raw);
    const order = payload.data ?? payload.order ?? payload;
    const mapped = mapOrder(order);
    if (!mapped) {
      await sb.from("sync_logs").insert({
        trigger: "webhook", status: "gagal", message: "Payload tidak berisi order yang dikenali",
        started_at: started, finished_at: new Date().toISOString(),
      });
      return json({ ok: false, error: "Payload tidak dikenali" }, 422);
    }
    const result = await upsertOrder(sb, mapped, await loadCategoryIds(sb));
    await sb.from("sync_logs").insert({
      trigger: "webhook", status: "sukses", fetched: 1,
      inserted: result === "inserted" ? 1 : 0, updated: result === "updated" ? 1 : 0, skipped: result === "skipped" ? 1 : 0,
      message: `Order ${mapped.scalev_order_id}`, started_at: started, finished_at: new Date().toISOString(),
    });
    return json({ ok: true, result });
  } catch (e) {
    await sb.from("sync_logs").insert({
      trigger: "webhook", status: "gagal", message: String((e as Error).message ?? e),
      started_at: started, finished_at: new Date().toISOString(),
    });
    return json({ ok: false, error: "Gagal memproses" }, 500);
  }
});
