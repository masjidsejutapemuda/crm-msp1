// Sinkron manual / terjadwal: menarik order dari API Scalev lalu menyimpannya.
// Dipanggil dari tombol "Sinkron Sekarang" (JWT pengguna admin/manager)
// atau dari pg_cron/scheduler dengan header x-cron-secret.
// Secrets: SCALEV_API_KEY, SCALEV_API_BASE (mis. https://api.scalev.id/v2), CRON_SECRET (opsional)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { loadCategoryIds, mapOrder, upsertOrder } from "../_shared/scalev.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, service);

  // --- Otorisasi ---
  let trigger = "manual";
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) {
    trigger = "terjadwal";
  } else {
    const auth = req.headers.get("Authorization") ?? "";
    const { data: u } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    }).auth.getUser();
    if (!u?.user) return json({ error: "Belum login" }, 401);
    const { data: prof } = await sb.from("profiles").select("role,is_active").eq("id", u.user.id).single();
    if (!prof?.is_active || !["admin", "manager"].includes(prof.role)) return json({ error: "Tidak diizinkan" }, 403);
  }

  const apiKey = Deno.env.get("SCALEV_API_KEY");
  const base = (Deno.env.get("SCALEV_API_BASE") ?? "https://api.scalev.id/v2").replace(/\/$/, "");
  if (!apiKey) return json({ error: "SCALEV_API_KEY belum diatur" }, 500);

  const body = await req.json().catch(() => ({}));
  const sinceDays = Math.min(Number(body.since_days ?? 30), 365);
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();

  const started = new Date().toISOString();
  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  let lastError = "";

  try {
    const cats = await loadCategoryIds(sb);
    let page = 1;
    const pageSize = 100;
    // Batasi 50 halaman (5.000 order) per eksekusi agar tidak timeout
    while (page <= 50) {
      const res = await fetch(`${base}/orders?page=${page}&page_size=${pageSize}&created_at_gte=${encodeURIComponent(since)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Scalev API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const payload = await res.json();
      const list = payload.data?.results ?? payload.data ?? payload.results ?? payload.orders ?? [];
      if (!Array.isArray(list) || list.length === 0) break;

      for (const o of list) {
        stats.fetched++;
        const m = mapOrder(o);
        if (!m) { stats.skipped++; continue; }
        try {
          const r = await upsertOrder(sb, m, cats);
          stats[r]++;
        } catch (e) {
          stats.errors++;
          lastError = String((e as Error).message ?? e);
        }
      }
      if (list.length < pageSize) break;
      page++;
    }

    const status = stats.errors === 0 ? "sukses" : stats.errors < stats.fetched ? "sebagian" : "gagal";
    await sb.from("sync_logs").insert({
      trigger, status, fetched: stats.fetched, inserted: stats.inserted, updated: stats.updated, skipped: stats.skipped,
      message: stats.errors ? `${stats.errors} error. Terakhir: ${lastError}` : `Sinkron ${sinceDays} hari terakhir`,
      started_at: started, finished_at: new Date().toISOString(),
    });
    return json({ ok: true, ...stats, status });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await sb.from("sync_logs").insert({
      trigger, status: "gagal", message: msg, started_at: started, finished_at: new Date().toISOString(),
    });
    return json({ ok: false, error: msg }, 500);
  }
});
