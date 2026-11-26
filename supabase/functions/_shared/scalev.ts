// Pemetaan order Scalev -> donatur + transaksi donasi.
// Disesuaikan dengan dokumentasi resmi Scalev (dev.scalev.com, webhook events):
//   data.id / data.order_id, data.payment_status (paid|unpaid|conflict|settled),
//   data.amounts.gross_revenue (string), data.destination_address {name,phone,email,city},
//   data.orderlines[], data.payment.payment_method, data.paid_time, data.customer_id.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d]/g, "");
  if (!p) return null;
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return p.length >= 9 ? p : null;
}

const CATEGORY_KEYWORDS: Record<string, string> = {
  zakat: "Zakat", infaq: "Infaq", infak: "Infaq", sedekah: "Sedekah", shodaqoh: "Sedekah",
  wakaf: "Wakaf", waqf: "Wakaf", qurban: "Qurban", kurban: "Qurban",
};

export function detectCategory(text: string): string {
  const t = (text || "").toLowerCase();
  for (const k of Object.keys(CATEGORY_KEYWORDS)) if (t.includes(k)) return CATEGORY_KEYWORDS[k];
  return "Lainnya";
}

export type MappedOrder = {
  scalev_order_id: string;
  customer_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  amount: number;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  paid_at: string;
  payment_method: string | null;
  product_name: string;
  product_id: string | null;
};

const toNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// deno-lint-ignore no-explicit-any
export function mapOrder(o: any): MappedOrder | null {
  if (!o || typeof o !== "object") return null;
  const id = o.id ?? o.order_id;
  if (id === undefined || id === null || id === "") return null;

  const dest = o.destination_address ?? {};
  const lines = Array.isArray(o.orderlines) ? o.orderlines : [];
  const first = lines[0] ?? {};

  const ps = String(o.payment_status ?? "").toLowerCase();
  const st = String(o.status ?? "").toLowerCase();
  let status: MappedOrder["status"] = "pending";
  if (ps === "paid" || ps === "settled") status = "paid";
  else if (ps === "conflict") status = "failed";
  if (st === "canceled" || st === "cancelled") status = ps === "paid" || ps === "settled" ? "refunded" : "failed";

  const amount = toNum(o.amounts?.gross_revenue ?? o.gross_revenue ?? o.amounts?.net_revenue ?? 0);
  const variantOrProduct = first.product_id ?? first.variant_unique_id ?? null;

  return {
    scalev_order_id: String(id),
    customer_id: o.customer_id ? String(o.customer_id) : null,
    name: (dest.name && String(dest.name).trim()) || "Hamba Allah",
    phone: normalizePhone(dest.phone),
    email: dest.email ? String(dest.email) : null,
    city: dest.city ? String(dest.city) : null,
    amount: Math.round(amount),
    status,
    paid_at: o.paid_time ?? o.settled_time ?? o.created_at ?? new Date().toISOString(),
    payment_method: o.payment?.payment_method ?? null,
    product_name: String(first.product_name ?? ""),
    product_id: variantOrProduct ? String(variantOrProduct) : null,
  };
}

// Simpan 1 order. Idempoten lewat scalev_order_id (webhook Scalev bisa terkirim lebih dari sekali).
export async function upsertOrder(
  sb: SupabaseClient,
  m: MappedOrder,
  categoryIds: Record<string, number>,
): Promise<"inserted" | "updated" | "skipped"> {
  const { data: existing } = await sb
    .from("donations").select("id,status,amount,donor_id").eq("scalev_order_id", m.scalev_order_id).maybeSingle();

  const catName = detectCategory(m.product_name);
  const categoryId = categoryIds[catName] ?? categoryIds["Lainnya"] ?? null;

  // Order yang sudah tercatat: cukup perbarui status/jumlah, tidak perlu cari donatur lagi.
  if (existing) {
    if (existing.status === m.status && Number(existing.amount) === m.amount) return "skipped";
    const { error } = await sb.from("donations")
      .update({ amount: m.amount, status: m.status, payment_method: m.payment_method, paid_at: m.paid_at, category_id: categoryId })
      .eq("id", existing.id);
    if (error) throw error;
    return "updated";
  }

  // 1) Donatur: cari lewat telepon / scalev id / email
  let donorId: string | null = null;
  if (m.phone) {
    const { data } = await sb.from("donors").select("id").eq("phone", m.phone).maybeSingle();
    donorId = data?.id ?? null;
  }
  if (!donorId && m.customer_id) {
    const { data } = await sb.from("donors").select("id").eq("scalev_customer_id", m.customer_id).maybeSingle();
    donorId = data?.id ?? null;
  }
  if (!donorId && m.email) {
    const { data } = await sb.from("donors").select("id").eq("email", m.email).limit(1).maybeSingle();
    donorId = data?.id ?? null;
  }
  if (!donorId) {
    const { data, error } = await sb
      .from("donors")
      .insert({ name: m.name, phone: m.phone, email: m.email, city: m.city, source: "scalev", scalev_customer_id: m.customer_id })
      .select("id")
      .single();
    if (error) throw error;
    donorId = data.id;
  }

  // 2) Program
  let programId: string | null = null;
  if (m.product_id) {
    const { data: prog } = await sb.from("programs").select("id").eq("scalev_product_id", m.product_id).maybeSingle();
    if (prog) programId = prog.id;
    else {
      const { data: np } = await sb
        .from("programs")
        .insert({ name: m.product_name || "Program Scalev", category_id: categoryId, scalev_product_id: m.product_id })
        .select("id")
        .single();
      programId = np?.id ?? null;
    }
  }

  // 3) Transaksi
  const { error } = await sb.from("donations").insert({
    donor_id: donorId, program_id: programId, category_id: categoryId,
    amount: m.amount, status: m.status, payment_method: m.payment_method,
    paid_at: m.paid_at, source: "scalev", scalev_order_id: m.scalev_order_id,
  });
  if (error) throw error;
  return "inserted";
}

export async function loadCategoryIds(sb: SupabaseClient): Promise<Record<string, number>> {
  const { data } = await sb.from("categories").select("id,name");
  const map: Record<string, number> = {};
  (data ?? []).forEach((c: { id: number; name: string }) => (map[c.name] = c.id));
  return map;
}
