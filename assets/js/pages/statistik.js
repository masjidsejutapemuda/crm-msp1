PAGES.statistik = {
  async render(view, ctx) {
    ctx.setActions(`<span class="hide-sm" style="font-weight:600;margin-right:8px">Filter</span>` + U.periodHTML());

    view.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Statistik</h1><p class="page-sub" id="s-sub"></p></div>
        <div class="acts"><button class="btn" id="s-exp">${I.dl} Ekspor CSV</button></div></div>
      <div class="card mb2"><div class="card-h"><h2>Kategori</h2></div><div class="card-b"><div class="grid g4" id="cats"></div></div></div>
      <div class="grid g3 mb" id="k1"></div><div class="grid g3 mb2" id="k2"></div>
      <div class="card mb2" id="chart-card"></div>
      <div class="card"><div class="card-h"><div><h2>Donatur Teratas</h2><p>Berdasarkan total donasi pada periode ini</p></div></div><div class="table-wrap" id="top"></div></div>`;

    const $ = (s) => view.querySelector(s);
    const kpi = (k, v, ico) => `<div class="card kpi"><div class="k">${k}</div><div class="ico">${I[ico]}</div><div class="v num">${v}</div></div>`;
    let cache = null, seq = 0;

    async function load() {
      const my = ++seq;
      const P = { ...U.period }, label = U.periodLabel(P), [from, to] = U.periodRange(P), byDay = P.month != null;
      $("#s-sub").textContent = `Periode: ${label}`;

      const [ov, cat, ts, top] = await Promise.all([
        sb.rpc("stats_overview", { p_from: from, p_to: to }),
        sb.rpc("stats_by_category", { p_from: from, p_to: to }),
        sb.rpc("stats_timeseries", { p_from: from, p_to: to, p_bucket: byDay ? "day" : "month" }),
        sb.rpc("stats_top_donors", { p_from: from, p_to: to, p_limit: 15 }),
      ]);
      if (my !== seq) return;
      for (const r of [ov, cat, ts, top]) if (r.error) throw r.error;
      cache = { cat: cat.data, ts: ts.data, top: top.data, label };
      const o = ov.data;

      $("#cats").innerHTML = cat.data.map((c) => `
        <div class="cat-tile" style="--c:${/^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#133C4E"}"><div class="n">${U.esc(c.category)}</div>
        <div class="v num">${U.rp(c.amount)}</div><div class="s">${U.num(c.trx)} Transaksi</div></div>`).join("");

      $("#k1").innerHTML = kpi("Donatur", U.num(o.donors), "person") + kpi("Raihan", U.rp(o.amount), "wallet") + kpi("Total Transaksi", U.num(o.count), "card");
      $("#k2").innerHTML =
        kpi("Avg Raihan/Transaksi", U.rp(o.count ? o.amount / o.count : 0), "chart") +
        kpi("Avg Raihan/Donatur", U.rp(o.donors ? o.amount / o.donors : 0), "chart") +
        kpi("Avg Transaksi/Donatur", U.dec(o.donors ? o.count / o.donors : 0), "chart");

      $("#chart-card").innerHTML = `<div class="chart-head"><div class="t"><h2>Statistik Transaksi</h2><p>Raihan ${byDay ? "per hari" : "per bulan"} — ${U.esc(label)}</p></div>
        <div class="m"><small>Raihan</small><b class="num">${U.num(o.amount)}</b></div><div class="m"><small>Donatur</small><b class="num">${U.num(o.donors)}</b></div></div><div class="chart-wrap" id="chart"></div>`;
      U.areaChart($("#chart"), U.seriesPoints(ts.data, P));

      $("#top").innerHTML = top.data.length
        ? `<table><thead><tr><th>#</th><th>Donatur</th><th class="r">Transaksi</th><th class="r">Total</th></tr></thead><tbody>${top.data.map((d, i) => `<tr><td>${i + 1}</td><td><b>${U.esc(d.name)}</b></td><td class="r num">${d.trx}</td><td class="r num"><b>${U.rp(d.amount)}</b></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><b>Belum ada data</b>Tidak ada transaksi pada ${U.esc(label)}.</div>`;
    }

    $("#s-exp").onclick = () => {
      if (!cache) return;
      const dateKey = (b) => new Date(b).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      const rows = [["Statistik", cache.label], [], ["Kategori", "Raihan", "Transaksi"], ...cache.cat.map((c) => [c.category, c.amount, c.trx]), [],
        ["Periode", "Raihan", "Transaksi", "Donatur"], ...cache.ts.map((r) => [dateKey(r.bucket), r.amount, r.trx, r.donors]), [],
        ["Donatur Teratas", "Total", "Transaksi"], ...cache.top.map((d) => [d.name, d.amount, d.trx])];
      U.downloadCSV(`statistik-${cache.label.replace(/\s+/g, "-")}.csv`, rows);
    };

    U.wirePeriod(ctx.topActs, () => load().catch((e) => U.toast(e.message || "Gagal memuat data", true)));
    await load();
  },
};
