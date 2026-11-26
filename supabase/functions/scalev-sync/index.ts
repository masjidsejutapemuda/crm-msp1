// Sinkron manual / terjadwal: menarik order dari API Scalev v3 lalu menyimpannya.
// Dipanggil dari tombol "Sinkron Sekarang" (JWT admin/manager) atau scheduler dengan header x-cron-secret.
// Secret: SCALEV_API_KEY (scope order:list), opsional SCALEV_API_BASE (default https://api.scalev.com/v3), CRON_SECRET.
// API Scalev v3: GET /orders, urut created_at menurun, paging cursor (page_size maks 25, next_cursor).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "./cors.ts";
import { loadCategoryIds, mapOrder, upsertOrder } from "./scalev.ts";

const MAX_PAGES = 30; // 30 x 25 = 750 order per eksekusi agar tidak timeout

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // --- Otorisasi ---
  let trigger = "manual";
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) {
    trigger = "terjadwal";
  } else {
    const { data: u } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    }).auth.getUser();
    if (!u?.user) return json({ error: "Belum login" }, 401);
    const { data: prof } = await sb.from("profiles").select("role,is_active").eq("id", u.user.id).single();
    if (!prof?.is_active || !["admin", "manager"].includes(prof.role)) return json({ error: "Tidak diizinkan" }, 403);
  }

  const apiKey = Deno.env.get("SCALEV_API_KEY");
  const base = (Deno.env.get("SCALEV_API_BASE") ?? "https://api.scalev.com/v3").replace(/\/$/, "");
  if (!apiKey) return json({ error: "SCALEV_API_KEY belum diatur" }, 500);
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  const body = await req.json().catch(() => ({}));
  const sinceDays = Math.min(Math.max(Number(body.since_days ?? 30), 1), 365);
  const sinceMs = Date.now() - sinceDays * 86400_000;

  const started = new Date().toISOString();
  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0, truncated: false };
  let lastError = "";

  try {
    const cats = await loadCategoryIds(sb);
    let cursor: string | null = null;
    let page = 0;
    let reachedOld = false;

    while (!reachedOld) {
      if (page >= MAX_PAGES) { stats.truncated = true; break; }
      page++;
      const qs = new URLSearchParams({ page_size: "25" });
      if (cursor) qs.set("next_cursor", cursor);
      const res = await fetch(`${base}/orders?${qs}`, { headers });
      if (!res.ok) throw new Error(`Scalev API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const payload = await res.json();
      const list = Array.isArray(payload.data) ? payload.data : payload.data?.results ?? [];
      if (!Array.isArray(list) || list.length === 0) break;

      for (const item of list) {
        const created = new Date(item.created_at ?? 0).getTime();
        if (created && created < sinceMs) { reachedOld = true; break; } // urut menurun: sisanya lebih lama
        stats.fetched++;

        // Daftar order bisa tidak memuat alamat/orderlines; ambil detail bila perlu.
        let order = item;
        if (!item.destination_address && !item.orderlines && item.id) {
          try {
            const d = await fetch(`${base}/orders/${item.id}`, { headers });
            if (d.ok) { const dj = await d.json(); order = dj.data ?? dj; }
          } catch (_) { /* pakai data daftar */ }
        }

        const m = mapOrder(order);
        if (!m || order.is_probably_spam === true) { stats.skipped++; continue; }
        try {
          const r = await upsertOrder(sb, m, cats);
          stats[r]++;
        } catch (e) {
          stats.errors++;
          lastError = String((e as Error).message ?? e);
        }
      }

      if (!payload.has_next || !payload.next_cursor) break;
      cursor = payload.next_cursor;
    }

    const status = stats.errors === 0 ? "sukses" : stats.errors < stats.fetched ? "sebagian" : "gagal";
    await sb.from("sync_logs").insert({
      trigger, status, fetched: stats.fetched, inserted: stats.inserted, updated: stats.updated, skipped: stats.skipped,
      message: stats.errors
        ? `${stats.errors} error. Terakhir: ${lastError}`
        : `Sinkron ${sinceDays} hari terakhir${stats.truncated ? " (dibatasi 750 order, jalankan lagi dengan rentang lebih pendek)" : ""}`,
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
