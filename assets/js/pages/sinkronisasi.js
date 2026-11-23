PAGES.sinkronisasi = {
  async render(view, ctx) {
    const base = window.APP_CONFIG.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1";
    view.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Sinkronisasi</h1>
        <p class="page-sub">Data transaksi dari Scalev masuk otomatis lewat webhook, dan bisa ditarik manual kapan saja</p></div></div>
      <div class="grid g3 mb2" id="sk"></div>
      <div class="grid g-main mb2">
        <div class="card"><div class="card-h"><div><h2>Sinkron Manual</h2><p>Tarik order Scalev ke dashboard. Aman dijalankan berulang — tidak membuat data ganda.</p></div></div>
          <div class="card-b"><div class="row2" style="grid-template-columns:1fr auto;align-items:end">
            <div><label class="lbl">Rentang waktu</label><select class="input" id="sy-days"><option value="7">7 hari terakhir</option><option value="30" selected>30 hari terakhir</option><option value="90">90 hari terakhir</option><option value="365">1 tahun terakhir</option></select></div>
            <button class="btn btn-primary" id="sy-go" style="height:44px">${I.sync} Sinkron Sekarang</button></div><div id="sy-res" style="margin-top:14px"></div></div></div>
        <div class="card"><div class="card-h"><h2>Endpoint Webhook</h2></div><div class="card-b">
          <div class="field"><label>Scalev → Supabase</label><div style="display:flex;gap:6px"><input class="input" readonly value="${U.esc(base)}/scalev-webhook" id="u1"><button class="btn" data-copy="u1">Salin</button></div></div>
          <div class="field" style="margin-bottom:0"><label>WhatsApp (Meta) → Supabase</label><div style="display:flex;gap:6px"><input class="input" readonly value="${U.esc(base)}/wa-webhook" id="u2"><button class="btn" data-copy="u2">Salin</button></div></div></div></div>
      </div>
      <div class="card"><div class="card-h"><div><h2>Riwayat Sinkronisasi</h2><p>50 aktivitas terakhir</p></div><button class="btn btn-sm" id="sy-rf">Muat ulang</button></div><div class="table-wrap" id="logs"></div></div>`;
    const $ = (s) => view.querySelector(s);

    view.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText($("#" + b.dataset.copy).value); U.toast("Tersalin"); } catch (_) { $("#" + b.dataset.copy).select(); }
    }));

    const tagFor = (s) => (s === "sukses" ? "" : s === "sebagian" ? "gold" : "red");

    async function load() {
      const [logs, scal, last] = await Promise.all([
        sb.from("sync_logs").select("*").order("started_at", { ascending: false }).limit(50),
        sb.from("donations").select("id", { count: "exact", head: true }).eq("source", "scalev"),
        sb.from("sync_logs").select("*").eq("status", "sukses").order("started_at", { ascending: false }).limit(1),
      ]);
      if (logs.error) throw logs.error;
      const l = last.data?.[0];
      const fails = (logs.data || []).filter((x) => x.status === "gagal").length;
      $("#sk").innerHTML =
        `<div class="card kpi"><div class="k">Sinkron terakhir berhasil</div><div class="ico">${I.sync}</div><div class="v" style="font-size:20px;margin-top:14px">${l ? U.dateTime(l.started_at) : "Belum pernah"}</div>${l ? `<div class="s">via ${U.esc(l.trigger)}</div>` : ""}</div>` +
        `<div class="card kpi"><div class="k">Transaksi dari Scalev</div><div class="ico">${I.card}</div><div class="v num">${U.num(scal.count || 0)}</div></div>` +
        `<div class="card kpi"><div class="k">Gagal (50 terakhir)</div><div class="ico">${I.shield}</div><div class="v num" style="${fails ? "color:var(--danger)" : ""}">${fails}</div></div>`;
      $("#logs").innerHTML = logs.data.length ? `<table><thead><tr><th>Waktu</th><th>Pemicu</th><th>Status</th><th class="r">Diambil</th><th class="r">Baru</th><th class="r">Diperbarui</th><th>Keterangan</th></tr></thead><tbody>${logs.data.map((r) => `
        <tr><td>${U.dateTime(r.started_at)}</td><td>${U.esc(r.trigger)}</td><td><span class="tag ${tagFor(r.status)}">${U.esc(r.status)}</span></td>
        <td class="r num">${r.fetched}</td><td class="r num">${r.inserted}</td><td class="r num">${r.updated}</td><td style="max-width:320px;color:var(--ink-2)">${U.esc(r.message || "")}</td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><b>Belum ada aktivitas</b>Klik “Sinkron Sekarang” untuk memulai.</div>`;
    }

    $("#sy-rf").onclick = load;
    $("#sy-go").onclick = async () => {
      const btn = $("#sy-go"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Menyinkronkan…';
      $("#sy-res").innerHTML = "";
      try {
        const r = await U.fn("scalev-sync", { since_days: +$("#sy-days").value });
        $("#sy-res").innerHTML = `<div class="alert ${r.status === "sukses" ? "alert-ok" : "alert-err"}">Diambil <b>${r.fetched}</b> · baru <b>${r.inserted}</b> · diperbarui <b>${r.updated}</b> · dilewati <b>${r.skipped}</b>${r.errors ? ` · error <b>${r.errors}</b>` : ""}</div>`;
      } catch (e) { $("#sy-res").innerHTML = `<div class="alert alert-err">${U.esc(e.message)}</div>`; }
      btn.disabled = false; btn.innerHTML = `${I.sync} Sinkron Sekarang`; load();
    };
    await load();
  },
};
