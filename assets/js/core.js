/* Inti: klien Supabase, utilitas, ikon, modal, toast. */
window.PAGES = window.PAGES || {}; // harus ada sebelum skrip halaman dimuat
(function () {
  const cfg = window.APP_CONFIG;
  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const U = (window.U = {});

  // ---------- Keamanan: escape HTML (semua data eksternal WAJIB lewat ini) ----------
  U.esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Format ----------
  U.num = (n) => new Intl.NumberFormat("id-ID").format(Math.round(Number(n) || 0));
  U.rp = (n) => "Rp " + U.num(n);
  U.rpShort = (n) => {
    n = Number(n) || 0;
    if (n >= 1e9) return "Rp " + (n / 1e9).toFixed(1).replace(".", ",") + " M";
    if (n >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(".", ",") + " jt";
    if (n >= 1e3) return "Rp " + Math.round(n / 1e3) + " rb";
    return "Rp " + n;
  };
  U.dec = (n) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
  U.date = (d) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "—");
  U.dateTime = (d) =>
    d ? new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "—";
  U.monthName = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  U.initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  U.debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.normPhone = (raw) => {
    let p = String(raw || "").replace(/\D/g, "");
    if (!p) return null;
    if (p.startsWith("0")) p = "62" + p.slice(1);
    else if (p.startsWith("8")) p = "62" + p;
    return p.length >= 9 ? p : null;
  };
  U.csvEscape = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah CSV/formula injection di Excel
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  U.downloadCSV = (name, rows) => {
    const csv = "﻿" + rows.map((r) => r.map(U.csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // Batas waktu Asia/Jakarta untuk filter periode
  U.range = (year, month /* 0-11 atau null */) => {
    if (month == null) return [`${year}-01-01T00:00:00+07:00`, `${year + 1}-01-01T00:00:00+07:00`];
    const m = String(month + 1).padStart(2, "0");
    const ny = month === 11 ? year + 1 : year;
    const nm = String(((month + 1) % 12) + 1).padStart(2, "0");
    return [`${year}-${m}-01T00:00:00+07:00`, `${ny}-${nm}-01T00:00:00+07:00`];
  };

  // ---------- Toast ----------
  U.toast = (msg, err = false) => {
    let box = document.querySelector(".toast-box");
    if (!box) { box = document.createElement("div"); box.className = "toast-box"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), err ? 6000 : 3500);
  };

  // ---------- Modal ----------
  U.modal = ({ title, body, footer = "", wide = false, onMount }) => {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-h"><h3>${U.esc(title)}</h3><button class="menu-btn" data-x aria-label="Tutup">${I.x}</button></div>
      <div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ""}</div>`;
    const close = () => ov.remove();
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
    ov.querySelector("[data-x]").onclick = close;
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
    document.body.appendChild(ov);
    if (onMount) onMount(ov, close);
    return { el: ov, close };
  };
  U.confirm = (msg, okLabel = "Ya, lanjutkan") =>
    new Promise((res) => {
      const m = U.modal({
        title: "Konfirmasi",
        body: `<p>${U.esc(msg)}</p>`,
        footer: `<button class="btn" data-no>Batal</button><button class="btn btn-primary" data-ok>${U.esc(okLabel)}</button>`,
        onMount: (el, close) => {
          el.querySelector("[data-no]").onclick = () => { close(); res(false); };
          el.querySelector("[data-ok]").onclick = () => { close(); res(true); };
        },
      });
    });

  // ---------- Ikon (stroke, 24x24) ----------
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = (window.I = {
    dash: ic('<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1117.4 0"/>'),
    stat: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    users: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5 6.5-5s5.9 1.6 6.5 5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 15c2 .5 3.200 2 3.500 5"/>'),
    wallet: ic('<path d="M3 7a2 2 0 012-2h13v4"/><path d="M3 7v11a2 2 0 002 2h15a1 1 0 001-1v-9a1 1 0 00-1-1H5a2 2 0 01-2-2z"/><circle cx="16.500" cy="14" r="1"/>'),
    card: ic('<rect x="2.500" y="5" width="19" height="14" rx="2.500"/><path d="M2.500 10h19"/>'),
    chart: ic('<path d="M3 3v16a2 2 0 002 2h16"/><path d="M7 15l4-5 3 3 5-6"/>'),
    person: ic('<circle cx="12" cy="8" r="3.500"/><path d="M5 20c.7-3.500 3.500-5.500 7-5.500s6.300 2 7 5.500"/>'),
    budget: ic('<path d="M12 2v20M17 6H9.500a3 3 0 000 6h5a3 3 0 010 6H6"/>'),
    wa: ic('<path d="M21 11.500a8.500 8.500 0 01-12.600 7.400L3 20.500l1.700-5.200A8.500 8.500 0 1121 11.500z"/><path d="M9 9.500c.5 2.200 2.300 4 4.500 4.500l1.200-1.200 1.800.9c-.3 1.200-1.300 1.800-2.500 1.700C10.800 15 8.500 12.200 8.300 10c0-1.200.8-2 1.700-2.200z"/>'),
    sync: ic('<path d="M21 12a9 9 0 01-15.500 6.200L3 16"/><path d="M3 12a9 9 0 0115.500-6.200L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'),
    shield: ic('<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    mosque: ic('<path d="M12 2c-1.500 2-1 3.500 0 4.500M5 21V12a7 7 0 0114 0v9M2 21h20M9 21v-4a3 3 0 016 0v4"/>'),
    eye: ic('<path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeoff: ic('<path d="M3 3l18 18M10.600 6.100A9.800 9.800 0 0112 6c6.500 0 10 6 10 6a17 17 0 01-3.300 3.900M6.600 6.600A16.500 16.500 0 002 12s3.500 6 10 6a9.700 9.700 0 004.100-.9"/>'),
    x: ic('<path d="M18 6L6 18M6 6l12 12"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    search: ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.300-4.300"/>'),
    menu: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
    out: ic('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>'),
    dl: ic('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
    send: ic('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>'),
    edit: ic('<path d="M12 20h9M16.500 3.500a2.100 2.100 0 013 3L7 19l-4 1 1-4z"/>'),
    trash: ic('<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>'),
    check: ic('<path d="M20 6L9 17l-5-5"/>'),
  });

  U.logo = (size = 34) => `<span class="logo"><svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
    <rect width="48" height="48" rx="12" fill="#0b7a5b"/>
    <path d="M24 9c-1.800 2.300-1.300 4 0 5.200" stroke="#f0c75e" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M12 38V26a12 12 0 0124 0v12z" fill="#fff"/>
    <path d="M20 38v-6a4 4 0 018 0v6z" fill="#0b7a5b"/>
  </svg><span>${U.esc(window.APP_CONFIG.ORG_NAME)}</span></span>`;

  // ---------- Sesi & profil ----------
  U.session = async () => (await sb.auth.getSession()).data.session;
  U.loadProfile = async (uid) => {
    const { data } = await sb.from("profiles").select("*").eq("id", uid).single();
    return data;
  };
  U.canManage = (p) => p && ["admin", "manager"].includes(p.role);

  // ---------- Panggil Edge Function dengan JWT pengguna ----------
  U.fn = async (name, body) => {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    return data;
  };

  // ---------- Grafik area SVG (tanpa pustaka luar) ----------
  U.areaChart = (el, points, { valueFmt = U.rpShort, tipFmt = U.rp, labelFmt = (p) => p.label } = {}) => {
    const W = 1000, H = 320, L = 56, R = 16, T = 16, B = 46;
    const max = Math.max(...points.map((p) => p.value));
    const nice = (m) => { const e = Math.pow(10, Math.floor(Math.log10(m))); const f = m / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
    const top = max > 0 ? nice(max) : 1_000_000; // data kosong: skala 0–1 jt agar sumbu wajar
    const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
    const y = (v) => T + (H - T - B) * (1 - v / top);
    // kurva halus (Catmull-Rom -> Bezier)
    let d = "";
    points.forEach((p, i) => {
      const px = x(i), py = y(p.value);
      if (i === 0) d = `M${px},${py}`;
      else {
        const p0 = points[i - 2] ? [x(i - 2), y(points[i - 2].value)] : [x(i - 1), y(points[i - 1].value)];
        const p1 = [x(i - 1), y(points[i - 1].value)];
        const p2 = [px, py];
        const p3 = points[i + 1] ? [x(i + 1), y(points[i + 1].value)] : p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(Math.max(p1[1] + (p2[1] - p0[1]) / 6, T), H - B)];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(Math.max(p2[1] - (p3[1] - p1[1]) / 6, T), H - B)];
        d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
      }
    });
    const area = `${d} L${x(points.length - 1)},${H - B} L${x(0)},${H - B} Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => {
      const gy = y(top * g);
      return `<line x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}" stroke="#e3e9e6" stroke-dasharray="${g === 0 ? "0" : "3 4"}"/>
        <text x="${L - 8}" y="${gy + 4}" text-anchor="end" font-size="11" fill="#7b8a84">${valueFmt(top * g)}</text>`;
    }).join("");
    const step = Math.ceil(points.length / 14);
    const labels = points.map((p, i) => (i % step ? "" :
      `<text x="${x(i)}" y="${H - B + 18}" font-size="11" fill="#7b8a84" text-anchor="end" transform="rotate(-35 ${x(i)} ${H - B + 18})">${U.esc(labelFmt(p))}</text>`)).join("");
    const gid = "g" + Math.random().toString(36).slice(2, 7);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b7a5b" stop-opacity=".42"/><stop offset="1" stop-color="#0b7a5b" stop-opacity=".02"/></linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="#0b7a5b" stroke-width="2.5" stroke-linejoin="round"/>
      ${labels}<line class="cur" y1="${T}" y2="${H - B}" stroke="#0b7a5b" stroke-opacity=".35" style="display:none"/>
      <circle class="dot" r="5" fill="#fff" stroke="#0b7a5b" stroke-width="2.500" style="display:none"/></svg><div class="tip hidden"></div>`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), cur = svg.querySelector(".cur"), dot = svg.querySelector(".dot");
    svg.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * W;
      let best = 0, bd = 1e9;
      points.forEach((_, i) => { const dd = Math.abs(x(i) - sx); if (dd < bd) { bd = dd; best = i; } });
      const p = points[best], px = x(best), py = y(p.value);
      cur.setAttribute("x1", px); cur.setAttribute("x2", px); cur.style.display = "";
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.style.display = "";
      tip.classList.remove("hidden");
      tip.innerHTML = `<b>${tipFmt(p.value)}</b>${U.esc(labelFmt(p))}${p.extra ? "<br>" + U.esc(p.extra) : ""}`;
      tip.style.left = (px / W) * r.width + "px";
      tip.style.top = (py / H) * r.height + "px";
    });
    svg.addEventListener("mouseleave", () => { cur.style.display = "none"; dot.style.display = "none"; tip.classList.add("hidden"); });
  };
})();
