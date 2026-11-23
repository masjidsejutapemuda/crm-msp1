// Kirim pesan WhatsApp lewat WhatsApp Cloud API (Meta).
// Hanya pengguna aktif yang login. Kampanye massal hanya admin/manager.
// Secrets: WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN, (opsional) WA_API_VERSION

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

type SendBody =
  | { mode: "text"; donor_id?: string; phone: string; text: string }
  | { mode: "template"; donor_id?: string; phone: string; template: string; language?: string; variables?: string[] }
  | { mode: "campaign"; name: string; template: string; language?: string; donor_ids: string[]; variable_fields: string[] };

const GRAPH = () => `https://graph.facebook.com/${Deno.env.get("WA_API_VERSION") ?? "v21.0"}`;

async function callMeta(payload: unknown) {
  const res = await fetch(`${GRAPH()}/${Deno.env.get("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("WA_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function templatePayload(to: string, template: string, language: string, vars: string[]) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: language },
      components: vars.length
        ? [{ type: "body", parameters: vars.map((v) => ({ type: "text", text: String(v ?? "") })) }]
        : [],
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!Deno.env.get("WA_PHONE_NUMBER_ID") || !Deno.env.get("WA_ACCESS_TOKEN")) {
    return json({ error: "WhatsApp Cloud API belum dikonfigurasi (WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN)" }, 500);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: u } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  }).auth.getUser();
  if (!u?.user) return json({ error: "Belum login" }, 401);
  const { data: prof } = await sb.from("profiles").select("role,is_active").eq("id", u.user.id).single();
  if (!prof?.is_active) return json({ error: "Akun belum aktif" }, 403);

  const body = (await req.json()) as SendBody;

  // ---------- Kirim satu pesan ----------
  if (body.mode === "text" || body.mode === "template") {
    const to = body.phone.replace(/\D/g, "");
    if (to.length < 9) return json({ error: "Nomor tidak valid" }, 400);

    // Hormati opt-out donatur
    if (body.donor_id) {
      const { data: d } = await sb.from("donors").select("wa_opt_in").eq("id", body.donor_id).single();
      if (d && d.wa_opt_in === false) return json({ error: "Donatur menolak pesan WhatsApp (opt-out)" }, 409);
    }

    const payload = body.mode === "text"
      ? { messaging_product: "whatsapp", to, type: "text", text: { body: body.text, preview_url: false } }
      : templatePayload(to, body.template, body.language ?? "id", body.variables ?? []);

    const r = await callMeta(payload);
    const wamid = r.data?.messages?.[0]?.id ?? null;
    await sb.from("wa_messages").insert({
      donor_id: body.donor_id ?? null, phone: to, direction: "out",
      body: body.mode === "text" ? body.text : null,
      template_name: body.mode === "template" ? body.template : null,
      status: r.ok ? "sent" : "failed", wa_message_id: wamid,
      error: r.ok ? null : (r.data?.error?.message ?? "Gagal mengirim"), sent_by: u.user.id,
    });
    if (!r.ok) {
      const code = r.data?.error?.code;
      const hint = code === 131047 ? " (di luar jendela 24 jam — gunakan template)" : "";
      return json({ ok: false, error: (r.data?.error?.message ?? "Gagal mengirim") + hint }, 502);
    }
    return json({ ok: true, wa_message_id: wamid });
  }

  // ---------- Kampanye massal (template) ----------
  if (body.mode === "campaign") {
    if (!["admin", "manager"].includes(prof.role)) return json({ error: "Hanya admin/manager" }, 403);
    if (!body.donor_ids?.length) return json({ error: "Tidak ada penerima" }, 400);
    if (body.donor_ids.length > 1000) return json({ error: "Maksimal 1000 penerima per kampanye" }, 400);

    const { data: donors } = await sb
      .from("donors").select("id,name,phone,city,total_amount,total_count,last_donation_at,wa_opt_in")
      .in("id", body.donor_ids);

    const { data: camp } = await sb.from("wa_campaigns").insert({
      name: body.name, segment: { donor_ids: body.donor_ids.length }, total: donors?.length ?? 0, created_by: u.user.id,
    }).select("id").single();

    let sent = 0, failed = 0;
    for (const d of donors ?? []) {
      if (!d.phone || d.wa_opt_in === false) { failed++; continue; }
      const vars = body.variable_fields.map((f) => {
        if (f === "name") return d.name;
        if (f === "city") return d.city ?? "";
        if (f === "total_amount") return new Intl.NumberFormat("id-ID").format(Number(d.total_amount));
        if (f === "total_count") return String(d.total_count);
        return "";
      });
      const r = await callMeta(templatePayload(d.phone, body.template, body.language ?? "id", vars));
      const ok = r.ok;
      ok ? sent++ : failed++;
      await sb.from("wa_messages").insert({
        donor_id: d.id, phone: d.phone, direction: "out", template_name: body.template,
        status: ok ? "sent" : "failed", wa_message_id: r.data?.messages?.[0]?.id ?? null,
        error: ok ? null : (r.data?.error?.message ?? "Gagal"), campaign_id: camp?.id ?? null, sent_by: u.user.id,
      });
      await new Promise((res) => setTimeout(res, 120)); // hindari rate limit
    }
    await sb.from("wa_campaigns").update({ sent, failed }).eq("id", camp?.id);
    return json({ ok: true, sent, failed });
  }

  return json({ error: "mode tidak dikenal" }, 400);
});
