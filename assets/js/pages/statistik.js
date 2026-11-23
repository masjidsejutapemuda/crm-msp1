PAGES.statistik = {
  async render(view, ctx) {
    const now = new Date();
    const st = { mode: "month", year: now.getFullYear(), month: now.getMonth() };
    const years = []; for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) years.push(y);

    ctx.setActions(`<span style="font-weight:600;margin-right:8px">Filter</span>
      <select class="input" id="s-mode" style="height:36px;width:auto;display:inline-block"><option value="month">Bulanan</option><option value="day">Harian</option></select>
      <select class="input" id="s-month" style="height:36px;width:auto;display:none">${U.monthName.map((m, i) => `<option value="${i}" ${i === st.month ? "selected" : ""}>${m}</option>`).join("")}</select>
      <select class="input" id="s-year" style="height:36px;width:auto;display:inline-block">${years.map((y) => `<option>${y}</option>`).join("")}</select>`);
    const A = ctx.topActs;
    const sync = () => { A.querySelector("#s-month").style.display = st.mode === "day" ? "inline-block" : "none"; };
    A.querySelector("#s-mode").onchange = (e) => { st.mode = e.target.value; sync(); load(); };
    A.querySelector("#s-month").onchange = (e) => { st.month = +e.target.value; load(); };
    A.querySelector("#s-year").onchange = (e) => { st.year = +e.target.value; load(); };

    view.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Statistik</h1><p class="page-sub" id="s-sub"></p></div>
        <div class="acts"><button class="btn" id="s-exp">${I.dl} Ekspor CSV</button></div></div>
      <div class="card mb2"><div class="card-h"><h2>Kategori</h2></div><div class="card-b"><div class="grid g4" id="cats"></div></div></div>
      <div class="grid g3 mb" id="k1"></div><div class="grid g3 mb2" id="k2"></div>
      <div class="card mb2" id="chart-card"></div>
      <div class="card"><div class="card-h"><div><h2>Donatur Teratas</h2><p>Berdasarkan total donasi pada periode ini</p></div></div><div class="table-wrap" id="top"></div></div>`;

    const kpi = (k, v, ico) => `<div class="card kpi"><div class="k">${k}</div><div class="ico">${I[ico]}</div><div class="v num">${v}</div></div>`;
    let cache = null;

    async function load() {
      const [from, to] = st.mode === "month" ? U.range(st.year, null) : U.range(st.year, st.month);
      const label = st.mode === "month" ? `Tahun ${st.year}` : `${U.monthName[st.month]} ${st.year}`;
      view.querySelector("#s-sub").textContent = `Periode: ${label}`;

      const [ov, cat, ts, top] = await Promise.all([
        sb.rpc("stats_overview", { p_from: from, p_to: to }),
        sb.rpc("stats_by_category", { p_from: from, p_to: to }),
        sb.rpc("stats_timeseries", { p_from: from, p_to: to, p_bucket: st.mode }),
        sb.rpc("stats_top_donors", { p_from: from, p_to: to, p_limit: 15 }),
      ]);
      for (const r of [ov, cat, ts, top]) if (r.error) throw r.error;
      cache = { cat: cat.data, ts: ts.data, top: top.data, label };
      const o = ov.data;

      view.querySelector("#cats").innerHTML = cat.data.map((c) => `
        <div class="cat-tile" style="--c:${/^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#0b7a5b"}"><div class="n">${U.esc(c.category)}</div>
        <div class="v num">${U.rp(c.amount)}</div><div class="s">${U.num(c.trx)} Transaksi</div></div>`).join("");

      view.querySelector("#k1").innerHTML = kpi("Donatur", U.num(o.donors), "person") + kpi("Raihan", U.rp(o.amount), "wallet") + kpi("Total Transaksi", U.num(o.count), "card");
      view.querySelector("#k2").innerHTML =
        kpi("Avg Raihan/Transaksi", U.rp(o.count ? o.amount / o.count : 0), "chart") +
        kpi("Avg Raihan/Donatur", U.rp(o.donors ? o.amount / o.donors : 0), "chart") +
        kpi("Avg Transaksi/Donatur", U.dec(o.donors ? o.count / o.donors : 0), "chart");

      // titik grafik
      const map = {};
      ts.data.forEach((r) => (map[new Date(r.bucket).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })] = r));
      let pts = [];
      if (st.mode === "month") {
        pts = U.monthName.map((m, i) => { const r = map[`${st.year}-${String(i + 1).padStart(2, "0")}-01`]; return { label: `${m} ${st.year}`, value: r ? +r.amount : 0, extra: r ? `${r.trx} transaksi · ${r.donors} donatur` : "Belum ada transaksi" }; });
      } else {
        const days = new Date(st.year, st.month + 1, 0).getDate();
        for (let d = 1; d <= days; d++) {
          const r = map[`${st.year}-${String(st.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`];
          pts.push({ label: `${d} ${U.monthName[st.month]}`, value: r ? +r.amount : 0, extra: r ? `${r.trx} transaksi · ${r.donors} donatur` : "Belum ada transaksi" });
        }
      }
      view.querySelector("#chart-card").innerHTML = `<div class="chart-head"><div class="t"><h2>Statistik Transaksi</h2><p>Raihan ${st.mode === "month" ? "per bulan" : "per hari"} — ${U.esc(label)}</p></div>
        <div class="m"><small>Raihan</small><b class="num">${U.num(o.amount)}</b></div><div class="m"><small>Donatur</small><b class="num">${U.num(o.donors)}</b></div></div><div class="chart-wrap" id="chart"></div>`;
      U.areaChart(view.querySelector("#chart"), pts);

      view.querySelector("#top").innerHTML = top.data.length
        ? `<table><thead><tr><th>#</th><th>Donatur</th><th class="r">Transaksi</th><th class="r">Total</th></tr></thead><tbody>${top.data.map((d, i) => `<tr><td>${i + 1}</td><td><b>${U.esc(d.name)}</b></td><td class="r num">${d.trx}</td><td class="r num"><b>${U.rp(d.amount)}</b></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><b>Belum ada data</b>Tidak ada transaksi pada periode ini.</div>`;
    }

    view.querySelector("#s-exp").onclick = () => {
      if (!cache) return;
      const rows = [["Statistik", cache.label], [], ["Kategori", "Raihan", "Transaksi"], ...cache.cat.map((c) => [c.category, c.amount, c.trx]), [],
        ["Periode", "Raihan", "Transaksi", "Donatur"], ...cache.ts.map((r) => [new Date(r.bucket).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }), r.amount, r.trx, r.donors]), [],
        ["Donatur Teratas", "Total", "Transaksi"], ...cache.top.map((d) => [d.name, d.amount, d.trx])];
      U.downloadCSV(`statistik-${cache.label.replace(/\s+/g, "-")}.csv`, rows);
    };

    await load();
  },
};
