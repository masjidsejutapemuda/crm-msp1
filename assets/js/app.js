/* Router & penjaga akses. Setiap halaman mendaftar ke window.PAGES. */
window.PAGES = window.PAGES || {};

(async function () {
  const $ = (id) => document.getElementById(id);

  // ---- 1. Penjaga akses: tanpa sesi aktif => kembali ke login ----
  const s = await U.session();
  if (!s) return location.replace("index.html");
  const me = await U.loadProfile(s.user.id);
  if (!me || !me.is_active) {
    await sb.auth.signOut();
    return location.replace("index.html?pending=1");
  }
  window.ME = me;
  window.ME.email = s.user.email;

  // Sesi berakhir / logout di tab lain
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") location.replace("index.html"); });

  // ---- 2. Menu berdasar role ----
  const MENU = [
    { id: "dashboard", label: "Dashboard", icon: I.dash, roles: ["admin", "manager", "staf"] },
    { id: "donatur", label: "Data Donatur", icon: I.users, roles: ["admin", "manager", "staf"] },
    { id: "statistik", label: "Statistik Data", icon: I.stat, roles: ["admin", "manager", "staf"] },
    { id: "budget", label: "Budget Syiar", icon: I.budget, roles: ["admin", "manager"] },
    { id: "whatsapp", label: "WhatsApp", icon: I.wa, roles: ["admin", "manager", "staf"] },
    { id: "sinkronisasi", label: "Sinkronisasi", icon: I.sync, roles: ["admin", "manager"] },
    { grp: "Pengaturan", roles: ["admin"] },
    { id: "pengguna", label: "Pengguna & Akses", icon: I.shield, roles: ["admin"] },
  ].filter((m) => m.roles.includes(me.role));

  $("sb-logo").innerHTML = `<a class="logo-link" href="#/dashboard">${U.logo()}</a>`;
  $("toggle").innerHTML = I.menu;
  $("logout").innerHTML = I.out;
  $("u-av").textContent = U.initials(me.full_name);
  $("u-name").textContent = me.full_name || me.email;
  $("u-role").textContent = me.role;
  $("nav").innerHTML = MENU.map((m) =>
    m.grp ? `<div class="grp">${U.esc(m.grp)}</div>` : `<a href="#/${m.id}" data-id="${m.id}">${m.icon}<span>${U.esc(m.label)}</span></a>`
  ).join("");

  $("toggle").onclick = () => $("sidebar").classList.toggle("open");
  $("logout").onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };
  $("nav").addEventListener("click", () => $("sidebar").classList.remove("open"));

  // ---- 3. Router ----
  let current = null;
  async function route() {
    let id = (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
    if (!MENU.some((m) => m.id === id)) id = "dashboard"; // akses ke halaman terlarang dialihkan
    const page = PAGES[id];
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === id));
    const item = MENU.find((m) => m.id === id);
    $("top-title").textContent = item.label;
    document.title = `${item.label} — CRM Masjid Sejuta Pemuda`;
    $("top-acts").innerHTML = "";
    const view = $("view");
    if (current?.destroy) { try { current.destroy(); } catch (_) {} }
    view.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    current = page;
    try {
      await page.render(view, { me, setActions: (html) => ($("top-acts").innerHTML = html), topActs: $("top-acts") });
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="card"><div class="empty"><b>Terjadi kesalahan</b>${U.esc(e.message || e)}</div></div>`;
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  $("boot").classList.add("hidden");
  $("shell").classList.remove("hidden");
  route();
})();
