PAGES.pengguna = {
  async render(view, ctx) {
    view.innerHTML = `<div class="page-head"><div><h1 class="page-title">Pengguna &amp; Akses</h1>
      <p class="page-sub">Setujui akun baru dan atur level akses. Admin: semua fitur · Manager: laporan, budget, sinkronisasi · Staf: donatur &amp; WhatsApp</p></div></div>
      <div class="card"><div class="table-wrap" id="tbl"></div></div>`;
    const me = ctx.me;

    async function load() {
      const { data, error } = await sb.from("profiles").select("*").order("is_active").order("created_at", { ascending: false });
      if (error) throw error;
      view.querySelector("#tbl").innerHTML = `<table><thead><tr><th>Nama</th><th>Role</th><th>Status</th><th>Terdaftar</th><th></th></tr></thead><tbody>${data.map((p) => `
        <tr><td><div class="name-cell"><span class="avatar">${U.esc(U.initials(p.full_name))}</span><b>${U.esc(p.full_name || "(tanpa nama)")}</b>${p.id === me.id ? ' <span class="tag grey">Anda</span>' : ""}</div></td>
        <td><select class="input" data-role="${p.id}" style="height:34px;width:130px" ${p.id === me.id ? "disabled" : ""}>${["admin", "manager", "staf"].map((r) => `<option ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
        <td><span class="tag ${p.is_active ? "" : "gold"}">${p.is_active ? "Aktif" : "Menunggu persetujuan"}</span></td><td>${U.date(p.created_at)}</td>
        <td class="r">${p.id === me.id ? "" : p.is_active ? `<button class="btn btn-sm btn-danger" data-act="off" data-id="${p.id}">Nonaktifkan</button>` : `<button class="btn btn-sm btn-primary" data-act="on" data-id="${p.id}">${I.check} Setujui</button>`}</td></tr>`).join("")}</tbody></table>`;

      view.querySelectorAll("[data-role]").forEach((s) => (s.onchange = async () => {
        const r = await sb.from("profiles").update({ role: s.value }).eq("id", s.dataset.role);
        U.toast(r.error ? r.error.message : "Role diperbarui", !!r.error);
      }));
      view.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
        const on = b.dataset.act === "on";
        if (!on && !(await U.confirm("Nonaktifkan pengguna ini? Ia tidak bisa masuk lagi sampai diaktifkan kembali.", "Nonaktifkan"))) return;
        const r = await sb.from("profiles").update({ is_active: on }).eq("id", b.dataset.id);
        if (r.error) return U.toast(r.error.message, true);
        U.toast(on ? "Pengguna disetujui" : "Pengguna dinonaktifkan"); load();
      }));
    }
    await load();
  },
};
