// Pemetaan order Scalev -> donatur + transaksi donasi.
// CATATAN: nama field payload Scalev dapat berbeda antar versi. Pemetaan di bawah
// dibuat toleran (banyak fallback). Cocokkan dengan payload nyata dari menu
// Scalev > Developer > Webhook (lihat README bagian "Verifikasi payload").

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
  zakat: "Zakat",
  infaq: "Infaq",
  infak: "Infaq",
  sedekah: "Sedekah",
  shodaqoh: "Sedekah",
  wakaf: "Wakaf",
  waqf: "Wakaf",
  qurban: "Qurban",
  kurban: "Qurban",
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

// deno-lint-ignore no-explicit-any
export function mapOrder(o: any): MappedOrder | null {
  if (!o) return null;
  const id = o.id ?? o.order_id ?? o.order_number ?? o.uuid;
  if (!id) return null;

  const items = o.orderlines ?? o.order_lines ?? o.items ?? o.line_items ?? [];
  const first = Array.isArray(items) && items.length ? items[0] : {};
  const productName =
    first.product_name ?? first.name ?? first.product?.name ?? o.product_name ?? o.title ?? "";

  const rawStatus = String(o.payment_status ?? o.status ?? "").toLowerCase();
  let status: MappedOrder["status"] = "pending";
  if (["paid", "completed", "success", "settlement", "shipped", "delivered", "done"].includes(rawStatus)) status = "paid";
  else if (["failed", "canceled", "cancelled", "rejected"].includes(rawStatus)) status = "failed";
  else if (["expired"].includes(rawStatus)) status = "expired";
  else if (["refunded", "refund"].includes(rawStatus)) status = "refunded";

  const amount = Number(
    o.gross_revenue ?? o.net_revenue ?? o.total ?? o.total_amount ?? o.amount ?? o.final_price ?? 0,
  );

  return {
    scalev_order_id: String(id),
    customer_id: o.customer_id ? String(o.customer_id) : o.customer?.id ? String(o.customer.id) : null,
    name: o.customer_name ?? o.customer?.name ?? o.name ?? "Hamba Allah",
    phone: normalizePhone(o.customer_phone ?? o.customer?.phone ?? o.phone),
    email: o.customer_email ?? o.customer?.email ?? o.email ?? null,
    city: o.destination_address?.city ?? o.customer?.city ?? null,
    amount: Number.isFinite(amount) ? Math.round(amount) : 0,
    status,
    paid_at: o.paid_time ?? o.paid_at ?? o.payment_time ?? o.updated_at ?? o.created_at ?? new Date().toISOString(),
    payment_method: o.payment_method ?? o.payment?.method ?? null,
    product_name: String(productName),
    product_id: first.product_id ? String(first.product_id) : first.product?.id ? String(first.product.id) : null,
  };
}

// Simpan 1 order. Mengembalikan 'inserted' | 'updated' | 'skipped'.
export async function upsertOrder(
  sb: SupabaseClient,
  m: MappedOrder,
  categoryIds: Record<string, number>,
): Promise<"inserted" | "updated" | "skipped"> {
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
    const { data } = await sb.from("donors").select("id").eq("email", m.email).maybeSingle();
    donorId = data?.id ?? null;
  }
  if (!donorId) {
    const { data, error } = await sb
      .from("donors")
      .insert({
        name: m.name, phone: m.phone, email: m.email, city: m.city,
        source: "scalev", scalev_customer_id: m.customer_id,
      })
      .select("id")
      .single();
    if (error) throw error;
    donorId = data.id;
  }

  // 2) Program (opsional) + kategori
  const catName = detectCategory(m.product_name);
  const categoryId = categoryIds[catName] ?? categoryIds["Lainnya"] ?? null;
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

  // 3) Transaksi (idempoten lewat scalev_order_id)
  const { data: existing } = await sb
    .from("donations").select("id,status,amount").eq("scalev_order_id", m.scalev_order_id).maybeSingle();

  const row = {
    donor_id: donorId, program_id: programId, category_id: categoryId,
    amount: m.amount, status: m.status, payment_method: m.payment_method,
    paid_at: m.paid_at, source: "scalev", scalev_order_id: m.scalev_order_id,
  };

  if (existing) {
    if (existing.status === m.status && Number(existing.amount) === m.amount) return "skipped";
    const { error } = await sb.from("donations").update(row).eq("id", existing.id);
    if (error) throw error;
    return "updated";
  }
  const { error } = await sb.from("donations").insert(row);
  if (error) throw error;
  return "inserted";
}

export async function loadCategoryIds(sb: SupabaseClient): Promise<Record<string, number>> {
  const { data } = await sb.from("categories").select("id,name");
  const map: Record<string, number> = {};
  (data ?? []).forEach((c: { id: number; name: string }) => (map[c.name] = c.id));
  return map;
}
