PAGES.dashboard = {
  async render(view, ctx) {
    const now = new Date();
    let year = now.getFullYear();
    const years = [];
    for (let y = year; y >= year - 4; y--) years.push(y);

    ctx.setActions(`<select class="input" id="d-year" style="height:36px;width:auto">${years.map((y) => `<option ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select>`);
    ctx.topActs.querySelector("#d-year").onchange = (e) => { year = +e.target.value; load(); };

    view.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Dashboard</h1>
        <p class="page-sub">Ringkasan donasi Masjid Sejuta Pemuda — <span id="d-sub"></span></p></div></div>
      <div class="grid g3 mb" id="k1"></div>
      <div class="grid g3 mb2" id="k2"></div>
      <div class="card mb2" id="chart-card"></div>
      <div class="grid g-main">
        <div class="card"><div class="card-h"><div><h2>Transaksi Terbaru</h2><p>10 donasi terakhir</p></div><a class="btn btn-sm" href="#/donatur">Lihat donatur</a></div><div class="table-wrap" id="recent"></div></div>
        <div class="card"><div class="card-h"><div><h2>Donatur Teratas</h2><p id="top-sub"></p></div></div><div id="top"></div></div>
      </div>`;

    const kpi = (k, v, ico, s = "") => `<div class="card kpi"><div class="k">${k}</div><div class="ico">${I[ico]}</div><div class="v num">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

    async function load() {
      const [from, to] = U.range(year, null);
      document.getElementById("d-sub").textContent = `tahun ${year}`;
      document.getElementById("top-sub").textContent = `Tahun ${year}`;

      const [ov, ts, top, rec] = await Promise.all([
        sb.rpc("stats_overview", { p_from: from, p_to: to }),
        sb.rpc("stats_timeseries", { p_from: from, p_to: to, p_bucket: "month" }),
        sb.rpc("stats_top_donors", { p_from: from, p_to: to, p_limit: 8 }),
        sb.from("donations").select("id,amount,paid_at,status,donors(name),categories(name)").eq("status", "paid").order("paid_at", { ascending: false }).limit(10),
      ]);
      if (ov.error) throw ov.error;
      const o = ov.data;
      const avgTrx = o.count ? o.amount / o.count : 0;
      const avgDonor = o.donors ? o.amount / o.donors : 0;
      const trxPerDonor = o.donors ? o.count / o.donors : 0;

      document.getElementById("k1").innerHTML =
        kpi("Donatur", U.num(o.donors), "person", `${U.num(o.new_donors)} donatur baru`) +
        kpi("Raihan", U.rp(o.amount), "wallet") +
        kpi("Total Transaksi", U.num(o.count), "card");
      document.getElementById("k2").innerHTML =
        kpi("Avg Raihan/Transaksi", U.rp(avgTrx), "chart") +
        kpi("Avg Raihan/Donatur", U.rp(avgDonor), "chart") +
        kpi("Avg Transaksi/Donatur", U.dec(trxPerDonor), "chart");

      // grafik: pastikan 12 bulan terisi
      const byMonth = {};
      (ts.data || []).forEach((r) => (byMonth[new Date(r.bucket).toLocaleString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7)] = r));
      const pts = U.monthName.map((m, i) => {
        const key = `${year}-${String(i + 1).padStart(2, "0")}`;
        const r = byMonth[key];
        return { label: `${m} ${year}`, value: r ? Number(r.amount) : 0, extra: r ? `${r.trx} transaksi · ${r.donors} donatur` : "Belum ada transaksi" };
      });
      document.getElementById("chart-card").innerHTML = `
        <div class="chart-head"><div class="t"><h2>Statistik Transaksi</h2><p>Raihan donasi per bulan, tahun ${year}</p></div>
          <div class="m"><small>Raihan</small><b class="num">${U.num(o.amount)}</b></div>
          <div class="m"><small>Donatur</small><b class="num">${U.num(o.donors)}</b></div></div>
        <div class="chart-wrap" id="chart"></div>`;
      U.areaChart(document.getElementById("chart"), pts);

      const rows = rec.data || [];
      document.getElementById("recent").innerHTML = rows.length
        ? `<table><thead><tr><th>Donatur</th><th>Kategori</th><th>Tanggal</th><th class="r">Jumlah</th></tr></thead><tbody>${rows.map((r) => `
          <tr><td>${U.esc(r.donors?.name || "Hamba Allah")}</td><td><span class="tag">${U.esc(r.categories?.name || "—")}</span></td>
          <td>${U.date(r.paid_at)}</td><td class="r num"><b>${U.rp(r.amount)}</b></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><b>Belum ada transaksi</b>Transaksi dari Scalev akan muncul setelah sinkronisasi.</div>`;

      const t = top.data || [];
      document.getElementById("top").innerHTML = t.length
        ? t.map((d, i) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line)">
            <span class="avatar" style="width:30px;height:30px;font-size:12px;border-radius:99px">${i + 1}</span>
            <div style="flex:1;min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(d.name)}</b><small style="color:var(--ink-3)">${d.trx} transaksi</small></div>
            <b class="num">${U.rpShort(d.amount)}</b></div>`).join("")
        : `<div class="empty">Belum ada data</div>`;
    }
    await load();
  },
};
