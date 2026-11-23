PAGES.whatsapp = {
  channel: null,
  destroy() { if (this.channel) { sb.removeChannel(this.channel); this.channel = null; } },

  async render(view, ctx) {
    const me = ctx.me, manage = U.canManage(me), self = this;
    const st = { tab: "chat", active: null, convs: new Map(), donors: new Map() };
    const want = new URLSearchParams((location.hash.split("?")[1] || "")).get("to");
    if (want) st.active = want.replace(/\D/g, "");

    view.innerHTML = `<div class="page-head"><div><h1 class="page-title">WhatsApp</h1>
      <p class="page-sub">Percakapan donatur, template pesan, dan kampanye lewat WhatsApp Cloud API</p></div></div>
      <div class="tabs"><button data-t="chat" class="active">Percakapan</button><button data-t="camp">Kampanye</button><button data-t="tpl">Template</button></div>
      <div id="pane"></div>`;
    const $ = (s) => view.querySelector(s);
    view.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
      st.tab = b.dataset.t; view.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b)); draw();
    }));

    // ---------------- Data percakapan ----------------
    async function loadConvs() {
      const { data, error } = await sb.from("wa_messages").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      st.convs = new Map();
      (data || []).forEach((m) => { if (!st.convs.has(m.phone)) st.convs.set(m.phone, { phone: m.phone, donor_id: m.donor_id, last: m, msgs: [] }); st.convs.get(m.phone).msgs.push(m); });
      const ids = [...new Set([...st.convs.values()].map((c) => c.donor_id).filter(Boolean))];
      if (ids.length) {
        const { data: ds } = await sb.from("donors").select("id,name,wa_opt_in").in("id", ids);
        (ds || []).forEach((d) => st.donors.set(d.id, d));
      }
    }
    const convName = (c) => (c.donor_id && st.donors.get(c.donor_id)?.name) || "+" + c.phone;
    const tick = (s) => ({ queued: "⏳", sent: "✓", delivered: "✓✓", read: "✓✓", failed: "⚠", received: "" }[s] || "");

    // ---------------- Tab Percakapan ----------------
    function drawChat() {
      const list = [...st.convs.values()];
      if (st.active && !st.convs.has(st.active)) list.unshift({ phone: st.active, donor_id: null, last: { created_at: new Date().toISOString(), body: "Percakapan baru" }, msgs: [] });
      $("#pane").innerHTML = `<div class="card wa"><div class="wa-list" id="wl">${list.length ? list.map((c) => `
          <div class="wa-item ${c.phone === st.active ? "active" : ""}" data-p="${U.esc(c.phone)}"><span class="avatar" style="border-radius:99px">${U.esc(U.initials(convName(c)))}</span>
          <div class="t"><b><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(convName(c))}</span><small style="flex:none">${U.dateTime(c.last.created_at)}</small></b>
          <small>${c.last.direction === "out" ? "Anda: " : ""}${U.esc(c.last.body || (c.last.template_name ? "[template] " + c.last.template_name : ""))}</small></div></div>`).join("")
          : `<div class="empty"><b>Belum ada percakapan</b>Buka donatur lalu pilih “Chat WhatsApp”.</div>`}</div>
        <div class="wa-chat" id="wc"></div></div>`;
      $("#wl").querySelectorAll(".wa-item").forEach((x) => (x.onclick = () => { st.active = x.dataset.p; drawChat(); }));
      drawThread();
    }

    function drawThread() {
      const box = $("#wc");
      if (!st.active) { box.innerHTML = `<div class="empty" style="margin:auto"><b>Pilih percakapan</b>Pesan masuk akan tampil otomatis.</div>`; return; }
      const c = st.convs.get(st.active) || { phone: st.active, donor_id: null, msgs: [] };
      const msgs = [...c.msgs].reverse();
      const optOut = c.donor_id && st.donors.get(c.donor_id)?.wa_opt_in === false;
      const lastIn = [...c.msgs].find((m) => m.direction === "in");
      const within24 = lastIn && Date.now() - new Date(lastIn.created_at).getTime() < 24 * 3600_000;
      box.innerHTML = `<div class="wa-top"><span class="avatar" style="border-radius:99px">${U.esc(U.initials(convName(c)))}</span><div style="flex:1"><b>${U.esc(convName(c))}</b><small style="display:block;color:var(--ink-3)">+${U.esc(c.phone)}</small></div>
          <button class="btn btn-sm" id="w-tpl">Kirim template</button></div>
        <div class="wa-msgs" id="wm">${msgs.length ? msgs.map((m) => `<div class="bub ${m.direction === "out" ? "out" : ""} ${m.status === "failed" ? "fail" : ""}">${U.esc(m.body || (m.template_name ? "[Template: " + m.template_name + "]" : ""))}
            <small>${U.dateTime(m.created_at)} ${tick(m.status)}${m.error ? " · " + U.esc(m.error) : ""}</small></div>`).join("") : `<div class="empty" style="margin:auto">Belum ada pesan</div>`}</div>
        ${optOut ? `<div class="alert alert-err" style="margin:12px">Donatur ini menolak pesan WhatsApp (opt-out).</div>` :
          `<div class="wa-send"><input class="input" id="w-text" placeholder="${within24 ? "Tulis pesan…" : "Di luar jendela 24 jam — gunakan template"}" ${within24 ? "" : "disabled"}>
          <button class="btn btn-primary" id="w-send" ${within24 ? "" : "disabled"} aria-label="Kirim">${I.send}</button></div>`}`;
      const wm = box.querySelector("#wm"); wm.scrollTop = wm.scrollHeight;
      box.querySelector("#w-tpl").onclick = () => sendTemplate(c);
      const inp = box.querySelector("#w-text");
      if (inp) {
        const go = async () => {
          const text = inp.value.trim(); if (!text) return;
          inp.disabled = true;
          try { await U.fn("wa-send", { mode: "text", phone: c.phone, donor_id: c.donor_id, text }); inp.value = ""; }
          catch (e) { U.toast(e.message, true); }
          inp.disabled = false; inp.focus(); await refresh();
        };
        box.querySelector("#w-send").onclick = go;
        inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
      }
    }

    async function sendTemplate(c) {
      const { data: tpls } = await sb.from("wa_templates").select("*").order("name");
      if (!tpls?.length) return U.toast("Belum ada template. Tambahkan di tab Template.", true);
      U.modal({
        title: "Kirim Template",
        body: `<div class="field"><label>Template</label><select class="input" id="t-sel">${tpls.map((t) => `<option value="${t.id}">${U.esc(t.name)}</option>`).join("")}</select></div>
          <div class="alert alert-ok" id="t-prev" style="white-space:pre-wrap"></div><div id="t-vars"></div><div id="t-err"></div>`,
        footer: `<button class="btn" data-x2>Batal</button><button class="btn btn-primary" id="t-go">Kirim</button>`,
        onMount: (el, close) => {
          el.querySelector("[data-x2]").onclick = close;
          const draw = () => {
            const t = tpls.find((x) => x.id === el.querySelector("#t-sel").value);
            el.querySelector("#t-prev").textContent = t.body;
            el.querySelector("#t-vars").innerHTML = (t.variables || []).map((v, i) => `<div class="field"><label>{{${i + 1}}} — ${U.esc(v)}</label><input class="input" data-v="${i}" value="${v === "name" ? U.esc(convName(c).startsWith("+") ? "" : convName(c)) : ""}"></div>`).join("");
          };
          el.querySelector("#t-sel").onchange = draw; draw();
          el.querySelector("#t-go").onclick = async () => {
            const t = tpls.find((x) => x.id === el.querySelector("#t-sel").value);
            const variables = [...el.querySelectorAll("[data-v]")].map((i) => i.value.trim());
            if (variables.some((v) => !v)) return (el.querySelector("#t-err").innerHTML = `<div class="alert alert-err">Semua variabel wajib diisi.</div>`);
            el.querySelector("#t-go").disabled = true;
            try { await U.fn("wa-send", { mode: "template", phone: c.phone, donor_id: c.donor_id, template: t.name, language: t.language, variables }); U.toast("Pesan dikirim"); close(); refresh(); }
            catch (e) { el.querySelector("#t-go").disabled = false; el.querySelector("#t-err").innerHTML = `<div class="alert alert-err">${U.esc(e.message)}</div>`; }
          };
        },
      });
    }

    // ---------------- Tab Kampanye ----------------
    async function drawCamp() {
      if (!manage) { $("#pane").innerHTML = `<div class="card"><div class="empty"><b>Khusus admin &amp; manager</b>Kampanye massal membutuhkan persetujuan level manager.</div></div>`; return; }
      const [{ data: tpls }, { data: camps }] = await Promise.all([
        sb.from("wa_templates").select("*").order("name"), sb.from("wa_campaigns").select("*").order("created_at", { ascending: false }).limit(15),
      ]);
      $("#pane").innerHTML = `<div class="grid g-main"><div class="card"><div class="card-h"><div><h2>Kampanye Baru</h2><p>Kirim template ke segmen donatur (hanya yang bersedia menerima WA)</p></div></div><div class="card-b">
          <div class="field"><label>Nama kampanye</label><input class="input" id="c-name" placeholder="Terima kasih donatur Oktober"></div>
          <div class="row2"><div class="field"><label>Template</label><select class="input" id="c-tpl">${(tpls || []).map((t) => `<option value="${t.id}">${U.esc(t.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Segmen</label><select class="input" id="c-seg"><option value="all">Semua donatur</option><option value="rutin">Rutin (≥3 donasi)</option><option value="besar">Donatur besar (≥ Rp 1 jt)</option><option value="dorman">Dorman (&gt; 90 hari)</option><option value="baru">Baru (30 hari)</option></select></div></div>
          <div class="alert alert-ok" id="c-prev" style="white-space:pre-wrap"></div>
          <div class="field"><label>Isi variabel template (urut {{1}}, {{2}}, …)</label><div id="c-map"></div></div>
          <div id="c-count" style="margin:8px 0 16px;color:var(--ink-2)"></div><div id="c-err"></div>
          <button class="btn btn-primary" id="c-go" ${tpls?.length ? "" : "disabled"}>${I.send} Kirim Kampanye</button></div></div>
        <div class="card"><div class="card-h"><h2>Riwayat</h2></div>${camps?.length ? camps.map((c) => `<div style="padding:14px 20px;border-bottom:1px solid var(--line)"><b>${U.esc(c.name)}</b>
          <div style="color:var(--ink-3);font-size:12px">${U.dateTime(c.created_at)}</div><div style="margin-top:4px"><span class="tag">${c.sent} terkirim</span>${c.failed ? `<span class="tag red">${c.failed} gagal</span>` : ""}</div></div>`).join("") : `<div class="empty">Belum ada kampanye</div>`}</div></div>`;
      const FIELDS = [["name", "Nama donatur"], ["city", "Kota"], ["total_amount", "Total donasi"], ["total_count", "Jumlah donasi"]];
      let ids = [];
      const day = 86400_000;
      async function segCount() {
        let q = sb.from("donors").select("id", { count: "exact" }).eq("wa_opt_in", true).not("phone", "is", null).limit(1000);
        const s = $("#c-seg").value;
        if (s === "rutin") q = q.gte("total_count", 3);
        if (s === "besar") q = q.gte("total_amount", 1_000_000);
        if (s === "dorman") q = q.lt("last_donation_at", new Date(Date.now() - 90 * day).toISOString());
        if (s === "baru") q = q.gte("created_at", new Date(Date.now() - 30 * day).toISOString());
        const { data, count } = await q; ids = (data || []).map((d) => d.id);
        $("#c-count").innerHTML = `Penerima: <b>${U.num(count || 0)}</b> donatur${(count || 0) > 1000 ? " (dibatasi 1.000 per kampanye)" : ""}`;
      }
      function drawMap() {
        const t = (tpls || []).find((x) => x.id === $("#c-tpl").value); if (!t) return;
        $("#c-prev").textContent = t.body;
        $("#c-map").innerHTML = (t.variables || []).map((v, i) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span style="width:44px">{{${i + 1}}}</span>
          <select class="input" data-f style="height:38px">${FIELDS.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("");
      }
      $("#c-tpl")?.addEventListener("change", drawMap); $("#c-seg").onchange = segCount; drawMap(); segCount();
      $("#c-go").onclick = async () => {
        const t = tpls.find((x) => x.id === $("#c-tpl").value), name = $("#c-name").value.trim();
        if (!name) return ($("#c-err").innerHTML = `<div class="alert alert-err">Nama kampanye wajib diisi.</div>`);
        if (!ids.length) return ($("#c-err").innerHTML = `<div class="alert alert-err">Tidak ada penerima pada segmen ini.</div>`);
        if (!(await U.confirm(`Kirim "${name}" ke ${ids.length} donatur? Tindakan ini tidak dapat dibatalkan.`, "Kirim sekarang"))) return;
        $("#c-go").disabled = true; $("#c-go").innerHTML = '<span class="spin"></span> Mengirim…';
        try {
          const r = await U.fn("wa-send", { mode: "campaign", name, template: t.name, language: t.language, donor_ids: ids, variable_fields: [...view.querySelectorAll("[data-f]")].map((s) => s.value) });
          U.toast(`Selesai: ${r.sent} terkirim, ${r.failed} gagal`); drawCamp();
        } catch (e) { $("#c-err").innerHTML = `<div class="alert alert-err">${U.esc(e.message)}</div>`; $("#c-go").disabled = false; $("#c-go").innerHTML = `${I.send} Kirim Kampanye`; }
      };
    }

    // ---------------- Tab Template ----------------
    async function drawTpl() {
      const { data, error } = await sb.from("wa_templates").select("*").order("name");
      if (error) throw error;
      $("#pane").innerHTML = `<div class="card"><div class="card-h"><div><h2>Template Pesan</h2><p>Nama harus sama persis dengan template yang sudah disetujui di Meta Business Manager</p></div>
        ${manage ? `<button class="btn btn-primary btn-sm" id="tp-add">${I.plus} Template</button>` : ""}</div>
        ${data.length ? `<div class="table-wrap"><table><thead><tr><th>Nama</th><th>Isi</th><th>Variabel</th><th>Kategori</th><th></th></tr></thead><tbody>${data.map((t) => `<tr><td><b>${U.esc(t.name)}</b><small style="display:block;color:var(--ink-3)">${U.esc(t.language)}</small></td>
          <td style="max-width:380px;white-space:pre-wrap">${U.esc(t.body)}</td><td>${(t.variables || []).map((v, i) => `<span class="tag grey">{{${i + 1}}} ${U.esc(v)}</span>`).join("")}</td><td><span class="tag ${t.category === "MARKETING" ? "gold" : ""}">${U.esc(t.category)}</span></td>
          <td class="r">${manage ? `<button class="btn btn-sm btn-danger" data-del="${t.id}" aria-label="Hapus">${I.trash}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Belum ada template</b>Contoh: <i>terima_kasih_donasi</i> dengan isi “Assalamualaikum {{1}}, jazakallahu khairan atas donasi Anda…”</div>`}</div>`;
      const add = $("#tp-add");
      if (add) add.onclick = () => U.modal({
        title: "Tambah Template",
        body: `<div class="field"><label>Nama template (huruf kecil &amp; underscore) *</label><input class="input" id="tp-n" placeholder="terima_kasih_donasi"></div>
          <div class="row2"><div class="field"><label>Bahasa</label><input class="input" id="tp-l" value="id"></div><div class="field"><label>Kategori</label><select class="input" id="tp-c"><option>UTILITY</option><option>MARKETING</option></select></div></div>
          <div class="field"><label>Isi (gunakan {{1}}, {{2}}…) *</label><textarea class="input" id="tp-b" placeholder="Assalamualaikum {{1}}, jazakallahu khairan…"></textarea></div>
          <div class="field"><label>Isi tiap variabel, urut, pisahkan koma</label><input class="input" id="tp-v" value="name"><small style="color:var(--ink-3)">Pilihan: name, city, total_amount, total_count</small></div><div id="tp-err"></div>`,
        footer: `<button class="btn" data-x2>Batal</button><button class="btn btn-primary" id="tp-s">Simpan</button>`,
        onMount: (el, close) => {
          el.querySelector("[data-x2]").onclick = close;
          el.querySelector("#tp-s").onclick = async () => {
            const name = el.querySelector("#tp-n").value.trim(), body = el.querySelector("#tp-b").value.trim();
            if (!/^[a-z0-9_]+$/.test(name)) return (el.querySelector("#tp-err").innerHTML = `<div class="alert alert-err">Nama hanya huruf kecil, angka, dan underscore.</div>`);
            if (!body) return (el.querySelector("#tp-err").innerHTML = `<div class="alert alert-err">Isi wajib diisi.</div>`);
            const variables = el.querySelector("#tp-v").value.split(",").map((s) => s.trim()).filter(Boolean);
            const need = new Set(body.match(/\{\{\d+\}\}/g) || []).size;
            if (need !== variables.length) return (el.querySelector("#tp-err").innerHTML = `<div class="alert alert-err">Isi memakai ${need} variabel, tetapi daftar variabel berisi ${variables.length}.</div>`);
            const r = await sb.from("wa_templates").insert({ name, body, variables, language: el.querySelector("#tp-l").value.trim() || "id", category: el.querySelector("#tp-c").value });
            if (r.error) return (el.querySelector("#tp-err").innerHTML = `<div class="alert alert-err">${U.esc(r.error.code === "23505" ? "Nama template sudah ada." : r.error.message)}</div>`);
            U.toast("Template disimpan"); close(); drawTpl();
          };
        },
      });
      $("#pane").querySelectorAll("[data-del]").forEach((x) => (x.onclick = async () => {
        if (!(await U.confirm("Hapus template ini dari dashboard? (Template di Meta tidak ikut terhapus)", "Hapus"))) return;
        const r = await sb.from("wa_templates").delete().eq("id", x.dataset.del); if (r.error) return U.toast(r.error.message, true); drawTpl();
      }));
    }

    async function refresh() { await loadConvs(); if (st.tab === "chat") drawChat(); }
    function draw() { if (st.tab === "chat") drawChat(); else if (st.tab === "camp") drawCamp(); else drawTpl(); }

    await loadConvs();
    draw();

    // Realtime: pesan masuk / status berubah
    self.destroy();
    self.channel = sb.channel("wa-live").on("postgres_changes", { event: "*", schema: "public", table: "wa_messages" }, U.debounce(() => refresh(), 400)).subscribe();
  },
};
