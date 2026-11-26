PAGES.dashboard = {
  async render(view, ctx) {
    ctx.setActions(U.periodHTML());

    view.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Dashboard</h1>
        <p class="page-sub">Ringkasan donasi Masjid Sejuta Pemuda — <span id="d-sub"></span></p></div></div>
      <div class="grid g3 mb" id="k1"></div>
      <div class="grid g3 mb2" id="k2"></div>
      <div class="card mb2" id="chart-card"></div>
      <div class="grid g-main">
        <div class="card"><div class="card-h"><div><h2>Transaksi Terbaru</h2><p id="rec-sub"></p></div><a class="btn btn-sm" href="#/donatur">Lihat donatur</a></div><div class="table-wrap" id="recent"></div></div>
        <div class="card"><div class="card-h"><div><h2>Donatur Teratas</h2><p id="top-sub"></p></div></div><div id="top"></div></div>
      </div>`;

    const $ = (id) => view.querySelector("#" + id);
    const kpi = (k, v, ico, s = "") => `<div class="card kpi"><div class="k">${k}</div><div class="ico">${I[ico]}</div><div class="v num">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

    let seq = 0; // abaikan hasil lama bila periode diganti cepat-cepat
    async function load() {
      const my = ++seq;
      const P = { ...U.period }, label = U.periodLabel(P), [from, to] = U.periodRange(P), byDay = P.month != null;
      $("d-sub").textContent = label;
      $("top-sub").textContent = label;
      $("rec-sub").textContent = `10 donasi terakhir — ${label}`;

      const [ov, ts, top, rec] = await Promise.all([
        sb.rpc("stats_overview", { p_from: from, p_to: to }),
        sb.rpc("stats_timeseries", { p_from: from, p_to: to, p_bucket: byDay ? "day" : "month" }),
        sb.rpc("stats_top_donors", { p_from: from, p_to: to, p_limit: 8 }),
        sb.from("donations").select("id,amount,paid_at,status,donors(name),categories(name)").eq("status", "paid")
          .gte("paid_at", from).lt("paid_at", to).order("paid_at", { ascending: false }).limit(10),
      ]);
      if (my !== seq) return;
      if (ov.error) throw ov.error;
      const o = ov.data;
      const avgTrx = o.count ? o.amount / o.count : 0;
      const avgDonor = o.donors ? o.amount / o.donors : 0;
      const trxPerDonor = o.donors ? o.count / o.donors : 0;

      $("k1").innerHTML =
        kpi("Donatur", U.num(o.donors), "person", `${U.num(o.new_donors)} donatur baru`) +
        kpi("Raihan", U.rp(o.amount), "wallet") +
        kpi("Total Transaksi", U.num(o.count), "card");
      $("k2").innerHTML =
        kpi("Avg Raihan/Transaksi", U.rp(avgTrx), "chart") +
        kpi("Avg Raihan/Donatur", U.rp(avgDonor), "chart") +
        kpi("Avg Transaksi/Donatur", U.dec(trxPerDonor), "chart");

      $("chart-card").innerHTML = `
        <div class="chart-head"><div class="t"><h2>Statistik Transaksi</h2><p>Raihan donasi ${byDay ? "per hari" : "per bulan"} — ${U.esc(label)}</p></div>
          <div class="m"><small>Raihan</small><b class="num">${U.num(o.amount)}</b></div>
          <div class="m"><small>Donatur</small><b class="num">${U.num(o.donors)}</b></div></div>
        <div class="chart-wrap" id="chart"></div>`;
      U.areaChart($("chart"), U.seriesPoints(ts.data, P));

      const rows = rec.data || [];
      $("recent").innerHTML = rows.length
        ? `<table><thead><tr><th>Donatur</th><th>Kategori</th><th>Tanggal</th><th class="r">Jumlah</th></tr></thead><tbody>${rows.map((r) => `
          <tr><td>${U.esc(r.donors?.name || "Hamba Allah")}</td><td><span class="tag">${U.esc(r.categories?.name || "—")}</span></td>
          <td>${U.date(r.paid_at)}</td><td class="r num"><b>${U.rp(r.amount)}</b></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><b>Belum ada transaksi</b>Tidak ada donasi pada ${U.esc(label)}.</div>`;

      const t = top.data || [];
      $("top").innerHTML = t.length
        ? t.map((d, i) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line)">
            <span class="avatar" style="width:30px;height:30px;font-size:12px;border-radius:99px">${i + 1}</span>
            <div style="flex:1;min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(d.name)}</b><small style="color:var(--ink-3)">${d.trx} transaksi</small></div>
            <b class="num">${U.rpShort(d.amount)}</b></div>`).join("")
        : `<div class="empty">Belum ada data</div>`;
    }

    U.wirePeriod(ctx.topActs, () => load().catch((e) => U.toast(e.message || "Gagal memuat data", true)));
    await load();
  },
};
