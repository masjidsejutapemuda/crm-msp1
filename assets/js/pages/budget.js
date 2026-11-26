PAGES.budget = {
  async render(view, ctx) {
    const CHANNELS = ["Meta Ads", "TikTok Ads", "Google Ads", "Konten & Desain", "Influencer / KOL", "Event & Kajian", "Cetak & Spanduk", "Lainnya"];

    ctx.setActions(U.periodHTML({ futureYears: 1 }) + `<button class="btn btn-primary btn-sm" id="b-add" style="margin-left:8px">${I.plus} Budget</button>`);
    ctx.topActs.querySelector("#b-add").onclick = () => editBudget();

    view.innerHTML = `<div class="page-head"><div><h1 class="page-title">Budget Syiar</h1>
      <p class="page-sub">Anggaran dakwah &amp; promosi, realisasi pengeluaran, dan dampaknya pada raihan donasi</p></div></div>
      <div class="grid g4 mb2" id="sum"></div><div id="list"></div>`;
    const $ = (s) => view.querySelector(s);
    const kpi = (k, v, s = "") => `<div class="card kpi"><div class="k">${k}</div><div class="v num">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    const pct = (a, b) => (b > 0 ? Math.min(999, Math.round((a / b) * 100)) : 0);
    const barCls = (p) => (p > 100 ? "over" : p >= 85 ? "warn" : "");

    async function load() {
      const P = { ...U.period }, label = U.periodLabel(P), [from, to] = U.periodRange(P);
      const [b, don] = await Promise.all([
        (() => { let q = sb.from("budget_summary").select("*").eq("period_year", P.year);
          if (P.month != null) q = q.or(`period_month.eq.${P.month + 1},period_month.is.null`); // bulan terpilih + pos setahun penuh
          return q.order("period_month", { nullsFirst: true }).order("created_at"); })(),
        sb.rpc("stats_overview", { p_from: from, p_to: to }),
      ]);
      if (b.error) throw b.error;
      const rows = b.data || [];
      const alloc = rows.reduce((a, r) => a + Number(r.allocated), 0), spent = rows.reduce((a, r) => a + Number(r.spent), 0);
      const raihan = Number(don.data?.amount || 0);

      $("#sum").innerHTML = kpi("Total Anggaran", U.rp(alloc), `${rows.length} pos budget`) + kpi("Terpakai", U.rp(spent), `${pct(spent, alloc)}% dari anggaran`) +
        kpi("Sisa", U.rp(alloc - spent)) + kpi("Raihan ÷ Biaya Syiar", spent ? (raihan / spent).toFixed(1).replace(".", ",") + "×" : "—", `Raihan ${U.rpShort(raihan)} · ${label}`);

      $("#list").innerHTML = rows.length ? `<div class="grid g3">${rows.map((r) => {
        const p = pct(r.spent, r.allocated);
        return `<div class="card" style="padding:20px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><b style="font-size:15px">${U.esc(r.title)}</b>
            <div style="color:var(--ink-3);font-size:12px;margin-top:2px">${r.period_month ? U.monthName[r.period_month - 1] + " " : ""}${r.period_year}${r.channel ? " · " + U.esc(r.channel) : ""}</div></div>
            <span class="tag ${r.status === "aktif" ? "" : r.status === "selesai" ? "grey" : "gold"}">${U.esc(r.status)}</span></div>
          <div style="margin:16px 0 8px;display:flex;justify-content:space-between"><span class="num"><b style="font-size:18px">${U.rp(r.spent)}</b></span><span style="color:var(--ink-3)">dari ${U.rpShort(r.allocated)}</span></div>
          <div class="bar ${barCls(p)}"><i style="width:${Math.min(p, 100)}%"></i></div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:var(--ink-3)"><span>${p}% terpakai</span><span class="${r.remaining < 0 ? "" : ""}" style="${r.remaining < 0 ? "color:var(--danger);font-weight:700" : ""}">${r.remaining < 0 ? "Lebih " + U.rpShort(-r.remaining) : "Sisa " + U.rpShort(r.remaining)}</span></div>
          <div style="display:flex;gap:6px;margin-top:16px"><button class="btn btn-sm" data-exp="${r.id}" style="flex:1">Pengeluaran</button><button class="btn btn-sm" data-edit="${r.id}" aria-label="Ubah">${I.edit}</button></div></div>`;
      }).join("")}</div>` : `<div class="card"><div class="empty"><b>Belum ada budget untuk ${label}</b>Klik “+ Budget” untuk membuat pos anggaran syiar pertama.</div></div>`;

      $("#list").querySelectorAll("[data-exp]").forEach((x) => (x.onclick = () => expenses(rows.find((r) => r.id === x.dataset.exp))));
      $("#list").querySelectorAll("[data-edit]").forEach((x) => (x.onclick = () => editBudget(rows.find((r) => r.id === x.dataset.edit))));
    }

    function editBudget(b) {
      const isNew = !b;
      U.modal({
        title: isNew ? "Budget Baru" : "Ubah Budget",
        body: `<div class="field"><label>Nama pos *</label><input class="input" id="b-title" placeholder="Iklan Ramadhan 1448H" value="${U.esc(b?.title || "")}"></div>
          <div class="row2"><div class="field"><label>Saluran</label><select class="input" id="b-ch">${CHANNELS.map((c) => `<option ${b?.channel === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          <div class="field"><label>Anggaran (Rp) *</label><input class="input num" id="b-al" inputmode="numeric" value="${b ? Number(b.allocated) : ""}"></div></div>
          <div class="row2"><div class="field"><label>Tahun</label><input class="input" id="b-y" type="number" value="${b?.period_year || U.period.year}"></div>
          <div class="field"><label>Bulan (opsional)</label><select class="input" id="b-m"><option value="">Setahun penuh</option>${U.monthName.map((m, i) => `<option value="${i + 1}" ${(b ? b.period_month : (U.period.month != null ? U.period.month + 1 : null)) === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></div></div>
          <div class="field"><label>Status</label><select class="input" id="b-st">${["draft", "aktif", "selesai"].map((s) => `<option ${(b?.status || "aktif") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
          <div class="field"><label>Catatan</label><textarea class="input" id="b-nt">${U.esc(b?.notes || "")}</textarea></div><div id="b-err"></div>`,
        footer: `${!isNew ? `<button class="btn btn-danger" id="b-del" style="margin-right:auto">${I.trash} Hapus</button>` : ""}<button class="btn" data-x2>Batal</button><button class="btn btn-primary" id="b-save">Simpan</button>`,
        onMount: (el, close) => {
          el.querySelector("[data-x2]").onclick = close;
          const err = (m) => (el.querySelector("#b-err").innerHTML = `<div class="alert alert-err">${U.esc(m)}</div>`);
          el.querySelector("#b-save").onclick = async () => {
            const title = el.querySelector("#b-title").value.trim();
            const allocated = Number(el.querySelector("#b-al").value.replace(/[^\d]/g, ""));
            if (!title) return err("Nama pos wajib diisi.");
            if (!allocated) return err("Anggaran wajib diisi.");
            const row = { title, allocated, channel: el.querySelector("#b-ch").value, period_year: +el.querySelector("#b-y").value,
              period_month: el.querySelector("#b-m").value ? +el.querySelector("#b-m").value : null, status: el.querySelector("#b-st").value, notes: el.querySelector("#b-nt").value.trim() || null };
            el.querySelector("#b-save").disabled = true;
            const r = isNew ? await sb.from("budgets").insert({ ...row, created_by: ctx.me.id }) : await sb.from("budgets").update(row).eq("id", b.id);
            if (r.error) { el.querySelector("#b-save").disabled = false; return err(r.error.message); }
            U.toast("Budget disimpan"); close(); load();
          };
          const del = el.querySelector("#b-del");
          if (del) del.onclick = async () => {
            if (!(await U.confirm(`Hapus budget "${b.title}" beserta seluruh catatan pengeluarannya?`, "Hapus"))) return;
            const r = await sb.from("budgets").delete().eq("id", b.id);
            if (r.error) return err(r.error.message);
            U.toast("Budget dihapus"); close(); load();
          };
        },
      });
    }

    async function expenses(b) {
      const m = U.modal({
        title: `Pengeluaran — ${b.title}`, wide: true,
        body: `<div class="row2" style="grid-template-columns:140px 1fr 160px auto;align-items:end;margin-bottom:16px">
          <div><label class="lbl">Tanggal</label><input class="input" id="x-d" type="date" value="${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })}"></div>
          <div><label class="lbl">Keterangan</label><input class="input" id="x-t" placeholder="Boost postingan Instagram"></div>
          <div><label class="lbl">Jumlah (Rp)</label><input class="input num" id="x-a" inputmode="numeric"></div>
          <button class="btn btn-primary" id="x-add">${I.plus}</button></div><div id="x-err"></div>
          <div class="card" style="box-shadow:none"><div id="x-list"><div class="loading"><span class="spin"></span></div></div></div>`,
        onMount: (el) => {
          async function refresh() {
            const { data, error } = await sb.from("budget_expenses").select("*").eq("budget_id", b.id).order("spent_at", { ascending: false });
            if (error) return (el.querySelector("#x-list").innerHTML = `<div class="empty">${U.esc(error.message)}</div>`);
            const total = data.reduce((a, r) => a + Number(r.amount), 0);
            el.querySelector("#x-list").innerHTML = data.length
              ? `<table><thead><tr><th>Tanggal</th><th>Keterangan</th><th class="r">Jumlah</th><th></th></tr></thead><tbody>${data.map((r) => `<tr><td>${U.date(r.spent_at)}</td><td>${U.esc(r.description)}</td><td class="r num"><b>${U.rp(r.amount)}</b></td>
                <td class="r"><button class="btn btn-sm btn-danger" data-del="${r.id}" aria-label="Hapus">${I.trash}</button></td></tr>`).join("")}
                <tr><td></td><td><b>Total terpakai</b></td><td class="r num"><b>${U.rp(total)}</b></td><td></td></tr></tbody></table>` : `<div class="empty">Belum ada pengeluaran</div>`;
            el.querySelectorAll("[data-del]").forEach((x) => (x.onclick = async () => {
              if (!(await U.confirm("Hapus catatan pengeluaran ini?", "Hapus"))) return;
              const r = await sb.from("budget_expenses").delete().eq("id", x.dataset.del);
              if (r.error) return U.toast(r.error.message, true);
              refresh(); load();
            }));
          }
          el.querySelector("#x-add").onclick = async () => {
            const description = el.querySelector("#x-t").value.trim();
            const amount = Number(el.querySelector("#x-a").value.replace(/[^\d]/g, ""));
            if (!description || !amount) return (el.querySelector("#x-err").innerHTML = `<div class="alert alert-err">Keterangan dan jumlah wajib diisi.</div>`);
            const r = await sb.from("budget_expenses").insert({ budget_id: b.id, spent_at: el.querySelector("#x-d").value, description, amount, created_by: ctx.me.id });
            if (r.error) return (el.querySelector("#x-err").innerHTML = `<div class="alert alert-err">${U.esc(r.error.message)}</div>`);
            el.querySelector("#x-err").innerHTML = ""; el.querySelector("#x-t").value = ""; el.querySelector("#x-a").value = "";
            refresh(); load();
          };
          refresh();
        },
      });
    }

    U.wirePeriod(ctx.topActs, () => load().catch((e) => U.toast(e.message || "Gagal memuat data", true)));
    await load();
  },
};
