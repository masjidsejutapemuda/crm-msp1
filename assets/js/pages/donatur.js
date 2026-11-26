PAGES.donatur = {
  async render(view, ctx) {
    const me = ctx.me;
    const PAGE = 20;
    const st = { page: 0, q: "", sort: "last_donation_at", seg: "", total: 0 };

    ctx.setActions(`<button class="btn btn-primary btn-sm" id="a-add">${I.plus} Donatur</button>`);
    ctx.topActs.querySelector("#a-add").onclick = () => editDonor();

    view.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Data Donatur</h1>
        <p class="page-sub">Kelola data donatur, riwayat donasi, dan segmentasi</p></div>
        <div class="acts"><button class="btn" id="b-imp">${I.plus} Import CSV</button><button class="btn" id="b-exp">${I.dl} Ekspor CSV</button></div></div>
      <div class="card">
        <div class="toolbar">
          <input class="input search" id="q" placeholder="Cari nama, telepon, atau email…">
          <select class="input" id="seg">
            <option value="">Semua donatur</option>
            <option value="rutin">Rutin (≥3 donasi)</option>
            <option value="besar">Donatur besar (≥ Rp 1 jt)</option>
            <option value="baru">Baru (30 hari)</option>
            <option value="dorman">Dorman (&gt; 90 hari)</option>
            <option value="nowa">Tanpa nomor WA</option>
          </select>
          <select class="input" id="sort">
            <option value="last_donation_at">Donasi terakhir</option>
            <option value="total_amount">Total terbesar</option>
            <option value="total_count">Terbanyak transaksi</option>
            <option value="created_at">Terbaru ditambahkan</option>
            <option value="name">Nama (A–Z)</option>
          </select>
        </div>
        <div class="table-wrap" id="tbl"></div>
        <div class="pager"><span id="pg-info"></span><span><button class="btn btn-sm" id="prev">‹ Sebelumnya</button> <button class="btn btn-sm" id="next">Berikutnya ›</button></span></div>
      </div>`;

    const $ = (id) => view.querySelector("#" + id);
    const canDelete = U.canManage(me);

    function applyFilters(q) {
      const t = st.q.trim().replace(/[,()%*\\]/g, " ").trim();
      if (t) q = q.or(`name.ilike.%${t}%,phone.ilike.%${t}%,email.ilike.%${t}%`);
      const day = 86400_000;
      if (st.seg === "rutin") q = q.gte("total_count", 3);
      if (st.seg === "besar") q = q.gte("total_amount", 1_000_000);
      if (st.seg === "baru") q = q.gte("created_at", new Date(Date.now() - 30 * day).toISOString());
      if (st.seg === "dorman") q = q.lt("last_donation_at", new Date(Date.now() - 90 * day).toISOString());
      if (st.seg === "nowa") q = q.is("phone", null);
      return q;
    }

    async function load() {
      $("tbl").innerHTML = '<div class="loading"><span class="spin"></span></div>';
      let q = sb.from("donors").select("*", { count: "exact" });
      q = applyFilters(q).order(st.sort, { ascending: st.sort === "name", nullsFirst: false }).range(st.page * PAGE, st.page * PAGE + PAGE - 1);
      const { data, count, error } = await q;
      if (error) { $("tbl").innerHTML = `<div class="empty"><b>Gagal memuat</b>${U.esc(error.message)}</div>`; return; }
      st.total = count || 0;
      $("pg-info").textContent = st.total ? `${st.page * PAGE + 1}–${Math.min((st.page + 1) * PAGE, st.total)} dari ${U.num(st.total)} donatur` : "0 donatur";
      $("prev").disabled = st.page === 0;
      $("next").disabled = (st.page + 1) * PAGE >= st.total;
      if (!data.length) { $("tbl").innerHTML = `<div class="empty"><b>Tidak ada donatur</b>Tambah manual, import CSV, atau jalankan sinkronisasi Scalev.</div>`; return; }
      $("tbl").innerHTML = `<table><thead><tr><th>Donatur</th><th>Kontak</th><th>Tag</th><th class="r">Transaksi</th><th class="r">Total</th><th>Terakhir</th><th></th></tr></thead><tbody>${data.map((d) => `
        <tr data-id="${d.id}" style="cursor:pointer">
          <td><div class="name-cell"><span class="avatar">${U.esc(U.initials(d.name))}</span><div><b>${U.esc(d.name)}</b><small>${U.esc(d.city || "")}</small></div></div></td>
          <td>${d.phone ? `<span class="num">+${U.esc(d.phone)}</span>` : '<span style="color:var(--ink-3)">—</span>'}<small style="display:block;color:var(--ink-3)">${U.esc(d.email || "")}</small></td>
          <td>${(d.tags || []).map((t) => `<span class="tag">${U.esc(t)}</span>`).join("")}${d.wa_opt_in === false ? '<span class="tag red">Opt-out WA</span>' : ""}${d.source === "scalev" ? '<span class="tag grey">Scalev</span>' : ""}</td>
          <td class="r num">${U.num(d.total_count)}</td><td class="r num"><b>${U.rp(d.total_amount)}</b></td>
          <td>${U.date(d.last_donation_at)}</td>
          <td class="r"><button class="btn btn-sm" data-edit="${d.id}" title="Ubah">${I.edit}</button></td></tr>`).join("")}</tbody></table>`;
      $("tbl").querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = (e) => {
        const d = data.find((x) => x.id === tr.dataset.id);
        if (e.target.closest("[data-edit]")) editDonor(d); else detail(d);
      }));
    }

    $("q").oninput = U.debounce((e) => { st.q = e.target.value; st.page = 0; load(); }, 350);
    $("seg").onchange = (e) => { st.seg = e.target.value; st.page = 0; load(); };
    $("sort").onchange = (e) => { st.sort = e.target.value; st.page = 0; load(); };
    $("prev").onclick = () => { st.page--; load(); };
    $("next").onclick = () => { st.page++; load(); };

    // ---------- Ekspor ----------
    $("b-exp").onclick = async () => {
      U.toast("Menyiapkan ekspor…");
      const rows = [["Nama", "Telepon", "Email", "Kota", "Tag", "Jumlah Transaksi", "Total Donasi", "Donasi Pertama", "Donasi Terakhir", "Opt-in WA"]];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await applyFilters(sb.from("donors").select("*")).order("name").range(from, from + 999);
        if (error) return U.toast(error.message, true);
        data.forEach((d) => rows.push([d.name, d.phone, d.email, d.city, (d.tags || []).join("; "), d.total_count, d.total_amount, d.first_donation_at, d.last_donation_at, d.wa_opt_in ? "ya" : "tidak"]));
        if (data.length < 1000) break;
      }
      U.downloadCSV(`donatur-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    };

    // ---------- Import CSV: kolom nama,telepon,email,kota ----------
    $("b-imp").onclick = () => {
      const m = U.modal({
        title: "Import Donatur (CSV)",
        body: `<p style="color:var(--ink-2);margin-bottom:12px">Kolom berurutan: <b>nama, telepon, email, kota</b>. Baris pertama (header) dilewati. Nomor yang sudah ada akan diperbarui.</p>
          <input type="file" id="imp-file" accept=".csv,text/csv" class="input" style="padding-top:9px"><div id="imp-res" style="margin-top:12px"></div>`,
        footer: `<button class="btn" data-x2>Tutup</button><button class="btn btn-primary" id="imp-go">Import</button>`,
        onMount: (el, close) => {
          el.querySelector("[data-x2]").onclick = close;
          el.querySelector("#imp-go").onclick = async () => {
            const f = el.querySelector("#imp-file").files[0];
            if (!f) return U.toast("Pilih file CSV dulu", true);
            if (f.size > 5_000_000) return U.toast("File terlalu besar (maks 5 MB)", true);
            const text = (await f.text()).replace(/^﻿/, "");
            const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(1);
            const parse = (l) => { const sep = l.includes(";") && !l.includes(",") ? ";" : ","; return l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()); };
            const seen = new Set(), rows = [];
            lines.forEach((l) => {
              const [name, phone, email, city] = parse(l);
              if (!name) return;
              const p = U.normPhone(phone);
              if (p && seen.has(p)) return;
              if (p) seen.add(p);
              rows.push({ name, phone: p, email: email || null, city: city || null, source: "import" });
            });
            if (!rows.length) return U.toast("Tidak ada baris valid", true);
            el.querySelector("#imp-go").disabled = true;
            const withPhone = rows.filter((r) => r.phone), noPhone = rows.filter((r) => !r.phone);
            let err = null;
            for (let i = 0; i < withPhone.length; i += 200) {
              const r = await sb.from("donors").upsert(withPhone.slice(i, i + 200), { onConflict: "phone", ignoreDuplicates: false });
              if (r.error) { err = r.error; break; }
            }
            if (!err && noPhone.length) { const r = await sb.from("donors").insert(noPhone); err = r.error; }
            if (err) { el.querySelector("#imp-res").innerHTML = `<div class="alert alert-err">${U.esc(err.message)}</div>`; el.querySelector("#imp-go").disabled = false; return; }
            U.toast(`${rows.length} donatur diimpor`); close(); load();
          };
        },
      });
    };

    // ---------- Tambah / ubah ----------
    function editDonor(d) {
      const isNew = !d;
      U.modal({
        title: isNew ? "Tambah Donatur" : "Ubah Donatur",
        body: `<div class="field"><label>Nama *</label><input class="input" id="e-name" value="${U.esc(d?.name || "")}"></div>
          <div class="row2"><div class="field"><label>Telepon / WhatsApp</label><input class="input" id="e-phone" placeholder="08xxxxxxxxxx" value="${U.esc(d?.phone || "")}"></div>
          <div class="field"><label>Email</label><input class="input" id="e-email" type="email" value="${U.esc(d?.email || "")}"></div></div>
          <div class="row2"><div class="field"><label>Kota</label><input class="input" id="e-city" value="${U.esc(d?.city || "")}"></div>
          <div class="field"><label>Tag (pisahkan koma)</label><input class="input" id="e-tags" placeholder="rutin, alumni" value="${U.esc((d?.tags || []).join(", "))}"></div></div>
          <div class="field"><label>Catatan</label><textarea class="input" id="e-notes">${U.esc(d?.notes || "")}</textarea></div>
          <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="e-wa" ${d?.wa_opt_in === false ? "" : "checked"}> Bersedia menerima pesan WhatsApp</label>
          <div id="e-err"></div>`,
        footer: `${!isNew && canDelete ? `<button class="btn btn-danger" id="e-del" style="margin-right:auto">${I.trash} Hapus</button>` : ""}<button class="btn" data-x2>Batal</button><button class="btn btn-primary" id="e-save">Simpan</button>`,
        onMount: (el, close) => {
          el.querySelector("[data-x2]").onclick = close;
          const err = (m) => (el.querySelector("#e-err").innerHTML = `<div class="alert alert-err" style="margin-top:12px">${U.esc(m)}</div>`);
          el.querySelector("#e-save").onclick = async () => {
            const name = el.querySelector("#e-name").value.trim();
            if (!name) return err("Nama wajib diisi.");
            const rawPhone = el.querySelector("#e-phone").value.trim();
            const phone = U.normPhone(rawPhone);
            if (rawPhone && !phone) return err("Nomor telepon tidak valid.");
            const row = {
              name, phone, email: el.querySelector("#e-email").value.trim() || null, city: el.querySelector("#e-city").value.trim() || null,
              tags: el.querySelector("#e-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
              notes: el.querySelector("#e-notes").value.trim() || null, wa_opt_in: el.querySelector("#e-wa").checked, updated_at: new Date().toISOString(),
            };
            el.querySelector("#e-save").disabled = true;
            const r = isNew ? await sb.from("donors").insert(row) : await sb.from("donors").update(row).eq("id", d.id);
            if (r.error) { el.querySelector("#e-save").disabled = false; return err(r.error.code === "23505" ? "Nomor telepon sudah dipakai donatur lain." : r.error.message); }
            U.toast("Donatur disimpan"); close(); load();
          };
          const del = el.querySelector("#e-del");
          if (del) del.onclick = async () => {
            if (!(await U.confirm(`Hapus donatur "${d.name}"? Riwayat transaksinya tetap tersimpan tanpa nama donatur.`, "Hapus"))) return;
            const r = await sb.from("donors").delete().eq("id", d.id);
            if (r.error) return err(r.error.message);
            U.toast("Donatur dihapus"); close(); load();
          };
        },
      });
    }

    // ---------- Detail + riwayat ----------
    async function detail(d) {
      const m = U.modal({
        title: d.name, wide: true,
        body: `<div class="grid g3 mb"><div class="cat-tile"><div class="n">Total donasi</div><div class="v num">${U.rp(d.total_amount)}</div><div class="s">${U.num(d.total_count)} transaksi</div></div>
          <div class="cat-tile" style="--c:var(--accent)"><div class="n">Pertama</div><div class="v" style="font-size:18px">${U.date(d.first_donation_at)}</div></div>
          <div class="cat-tile" style="--c:var(--accent)"><div class="n">Terakhir</div><div class="v" style="font-size:18px">${U.date(d.last_donation_at)}</div></div></div>
          <p style="color:var(--ink-2);margin-bottom:12px">${d.phone ? "+" + U.esc(d.phone) : "Tanpa nomor"} · ${U.esc(d.email || "tanpa email")} ${d.city ? "· " + U.esc(d.city) : ""}</p>
          ${d.notes ? `<p class="alert alert-ok">${U.esc(d.notes)}</p>` : ""}
          <div class="lbl"><span>Riwayat donasi</span></div><div id="hist" class="card" style="box-shadow:none"><div class="loading"><span class="spin"></span></div></div>`,
        footer: `${d.phone && d.wa_opt_in !== false ? `<a class="btn" href="#/whatsapp?to=${encodeURIComponent(d.phone)}" id="d-wa">${I.wa} Chat WhatsApp</a>` : ""}<button class="btn btn-primary" id="d-add">${I.plus} Catat Donasi</button>`,
        onMount: async (el, close) => {
          const a = el.querySelector("#d-wa"); if (a) a.onclick = close;
          el.querySelector("#d-add").onclick = () => { close(); addDonation(d); };
          const { data } = await sb.from("donations").select("id,amount,status,paid_at,source,categories(name),programs(name)").eq("donor_id", d.id).order("paid_at", { ascending: false }).limit(50);
          el.querySelector("#hist").innerHTML = data?.length
            ? `<table><thead><tr><th>Tanggal</th><th>Kategori / Program</th><th>Status</th><th class="r">Jumlah</th></tr></thead><tbody>${data.map((r) => `<tr><td>${U.date(r.paid_at)}</td>
              <td>${U.esc(r.categories?.name || "—")}${r.programs?.name ? `<small style="display:block;color:var(--ink-3)">${U.esc(r.programs.name)}</small>` : ""}</td>
              <td><span class="tag ${r.status === "paid" ? "" : r.status === "pending" ? "gold" : "red"}">${U.esc(r.status)}</span></td><td class="r num"><b>${U.rp(r.amount)}</b></td></tr>`).join("")}</tbody></table>`
            : `<div class="empty">Belum ada donasi</div>`;
        },
      });
    }

    async function addDonation(d) {
      const { data: cats } = await sb.from("categories").select("id,name").order("id");
      U.modal({
        title: `Catat Donasi — ${d.name}`,
        body: `<div class="row2"><div class="field"><label>Jumlah (Rp) *</label><input class="input num" id="n-amt" inputmode="numeric" placeholder="100000"></div>
          <div class="field"><label>Kategori</label><select class="input" id="n-cat">${(cats || []).map((c) => `<option value="${c.id}">${U.esc(c.name)}</option>`).join("")}</select></div></div>
          <div class="row2"><div class="field"><label>Tanggal</label><input class="input" id="n-date" type="date" value="${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })}"></div>
          <div class="field"><label>Metode</label><select class="input" id="n-pm"><option>Transfer</option><option>Tunai</option><option>QRIS</option><option>Lainnya</option></select></div></div>
          <div class="field"><label>Catatan</label><input class="input" id="n-note"></div><div id="n-err"></div>`,
        footer: `<button class="btn" data-x2>Batal</button><button class="btn btn-primary" id="n-save">Simpan</button>`,
        onMount: (el, close) => {
          el.querySelector("[data-x2]").onclick = close;
          el.querySelector("#n-save").onclick = async () => {
            const amount = Number(el.querySelector("#n-amt").value.replace(/[^\d]/g, ""));
            if (!amount) return (el.querySelector("#n-err").innerHTML = `<div class="alert alert-err">Jumlah wajib diisi.</div>`);
            el.querySelector("#n-save").disabled = true;
            const r = await sb.from("donations").insert({
              donor_id: d.id, amount, category_id: +el.querySelector("#n-cat").value, status: "paid", source: "manual",
              payment_method: el.querySelector("#n-pm").value, paid_at: `${el.querySelector("#n-date").value}T12:00:00+07:00`,
              note: el.querySelector("#n-note").value.trim() || null, created_by: me.id,
            });
            if (r.error) { el.querySelector("#n-save").disabled = false; return (el.querySelector("#n-err").innerHTML = `<div class="alert alert-err">${U.esc(r.error.message)}</div>`); }
            U.toast("Donasi dicatat"); close(); load();
          };
        },
      });
    }

    await load();
  },
};
