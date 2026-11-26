-- =====================================================================
-- CRM Masjid Sejuta Pemuda — Skema Database Supabase
-- Jalankan di Supabase Dashboard > SQL Editor (sekali, berurutan).
-- Role: admin | manager | staf
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ENUM
-- ---------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin', 'manager', 'staf');
exception when duplicate_object then null; end $$;

do $$ begin
  create type donation_status as enum ('pending', 'paid', 'failed', 'expired', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wa_direction as enum ('out', 'in');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wa_status as enum ('queued', 'sent', 'delivered', 'read', 'failed', 'received');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. PROFILES (pengguna dashboard, terhubung ke Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        app_role not null default 'staf',
  is_active   boolean not null default false,   -- akun baru harus disetujui admin
  created_at  timestamptz not null default now()
);

-- Otomatis buat profil saat user baru dibuat (nonaktif sampai admin menyetujui)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper role (security definer agar tidak rekursif di RLS)
create or replace function public.current_role_name()
returns app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.has_role(roles app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = any(roles), false)
$$;

-- ---------------------------------------------------------------------
-- 3. DONATUR
-- ---------------------------------------------------------------------
create table if not exists public.donors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,                    -- format internasional tanpa +, mis. 62812xxxx
  email         text,
  city          text,
  address       text,
  tags          text[] not null default '{}',
  notes         text,
  wa_opt_in     boolean not null default true,
  source        text not null default 'manual',   -- manual | scalev | import
  scalev_customer_id text,
  first_donation_at timestamptz,
  last_donation_at  timestamptz,
  total_amount  numeric(16,0) not null default 0,
  total_count   integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists donors_phone_uidx on public.donors(phone);
create index if not exists donors_name_idx on public.donors using gin (to_tsvector('simple', name));
create index if not exists donors_last_idx on public.donors(last_donation_at desc);

-- ---------------------------------------------------------------------
-- 4. PROGRAM / KATEGORI
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id    serial primary key,
  name  text not null unique,
  color text not null default '#0f766e'
);
insert into public.categories (name, color) values
  ('Zakat', '#133C4E'), ('Infaq', '#8CBA40'), ('Sedekah', '#2F86A6'),
  ('Wakaf', '#6C7A89'), ('Qurban', '#D08A2E'), ('Lainnya', '#94A3B8')
on conflict (name) do nothing;

create table if not exists public.programs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category_id integer references public.categories(id),
  scalev_product_id text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. TRANSAKSI DONASI
-- ---------------------------------------------------------------------
create table if not exists public.donations (
  id             uuid primary key default gen_random_uuid(),
  donor_id       uuid references public.donors(id) on delete set null,
  program_id     uuid references public.programs(id) on delete set null,
  category_id    integer references public.categories(id),
  amount         numeric(16,0) not null check (amount >= 0),
  status         donation_status not null default 'paid',
  payment_method text,
  paid_at        timestamptz not null default now(),
  source         text not null default 'manual',   -- manual | scalev
  scalev_order_id text,
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
create unique index if not exists donations_scalev_uidx on public.donations(scalev_order_id);
create index if not exists donations_paid_idx on public.donations(paid_at desc);
create index if not exists donations_donor_idx on public.donations(donor_id);
create index if not exists donations_cat_idx on public.donations(category_id);

-- Hitung ulang agregat donatur saat transaksi berubah
create or replace function public.refresh_donor_totals(p_donor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_donor is null then return; end if;
  update public.donors d set
    total_amount      = coalesce(s.amt, 0),
    total_count       = coalesce(s.cnt, 0),
    first_donation_at = s.first_at,
    last_donation_at  = s.last_at,
    updated_at        = now()
  from (
    select sum(amount) amt, count(*) cnt, min(paid_at) first_at, max(paid_at) last_at
    from public.donations where donor_id = p_donor and status = 'paid'
  ) s
  where d.id = p_donor;
end $$;

create or replace function public.trg_donation_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then perform public.refresh_donor_totals(new.donor_id); end if;
  if tg_op in ('DELETE','UPDATE') then perform public.refresh_donor_totals(old.donor_id); end if;
  return null;
end $$;

drop trigger if exists donations_totals on public.donations;
create trigger donations_totals
  after insert or update or delete on public.donations
  for each row execute function public.trg_donation_totals();

-- ---------------------------------------------------------------------
-- 6. BUDGET SYIAR
-- ---------------------------------------------------------------------
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  period_year integer not null,
  period_month integer check (period_month between 1 and 12),
  allocated   numeric(16,0) not null default 0,
  channel     text,                 -- Meta Ads, TikTok Ads, Konten, Event, dll.
  status      text not null default 'aktif',   -- draft | aktif | selesai
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.budget_expenses (
  id          uuid primary key default gen_random_uuid(),
  budget_id   uuid not null references public.budgets(id) on delete cascade,
  spent_at    date not null default current_date,
  description text not null,
  amount      numeric(16,0) not null check (amount >= 0),
  receipt_url text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists budget_expenses_budget_idx on public.budget_expenses(budget_id);

create or replace view public.budget_summary with (security_invoker = true) as
select b.*,
       coalesce(sum(e.amount), 0) as spent,
       b.allocated - coalesce(sum(e.amount), 0) as remaining
from public.budgets b
left join public.budget_expenses e on e.budget_id = b.id
group by b.id;

-- ---------------------------------------------------------------------
-- 7. WHATSAPP
-- ---------------------------------------------------------------------
create table if not exists public.wa_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,          -- harus sama dengan nama template di Meta
  language    text not null default 'id',
  category    text not null default 'UTILITY',  -- UTILITY | MARKETING
  body        text not null,                 -- pratinjau, variabel {{1}} {{2}}
  variables   text[] not null default '{}',  -- urutan: nama, total, program, dll.
  meta_status text not null default 'PENDING',
  created_at  timestamptz not null default now()
);

create table if not exists public.wa_messages (
  id          uuid primary key default gen_random_uuid(),
  donor_id    uuid references public.donors(id) on delete set null,
  phone       text not null,
  direction   wa_direction not null,
  body        text,
  template_name text,
  status      wa_status not null default 'queued',
  wa_message_id text,                       -- id dari Meta
  error       text,
  campaign_id uuid,
  sent_by     uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists wa_messages_phone_idx on public.wa_messages(phone, created_at desc);
create index if not exists wa_messages_wamid_idx on public.wa_messages(wa_message_id);

create table if not exists public.wa_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  template_id uuid references public.wa_templates(id),
  segment     jsonb not null default '{}',  -- filter donatur: {min_total, tag, inactive_days}
  total       integer not null default 0,
  sent        integer not null default 0,
  failed      integer not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. SINKRONISASI SCALEV
-- ---------------------------------------------------------------------
create table if not exists public.sync_logs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'scalev',
  trigger     text not null,                -- webhook | manual | terjadwal
  status      text not null,                -- sukses | gagal | sebagian
  fetched     integer not null default 0,
  inserted    integer not null default 0,
  updated     integer not null default 0,
  skipped     integer not null default 0,
  message     text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(key, value) values
  ('org', '{"name":"Masjid Sejuta Pemuda"}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 9. VIEW & FUNGSI STATISTIK (dipanggil dari frontend via RPC)
-- ---------------------------------------------------------------------
create or replace function public.stats_overview(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'donors',   (select count(distinct donor_id) from donations where status='paid' and paid_at >= p_from and paid_at < p_to),
    'amount',   coalesce((select sum(amount) from donations where status='paid' and paid_at >= p_from and paid_at < p_to), 0),
    'count',    (select count(*) from donations where status='paid' and paid_at >= p_from and paid_at < p_to),
    'new_donors', (select count(*) from donors where created_at >= p_from and created_at < p_to)
  )
$$;

create or replace function public.stats_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text default 'month')
returns table(bucket timestamptz, amount numeric, trx bigint, donors bigint)
language sql stable security invoker set search_path = public as $$
  select date_trunc(case when p_bucket in ('day','week','month') then p_bucket else 'month' end, paid_at at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta',
         sum(amount), count(*), count(distinct donor_id)
  from donations
  where status='paid' and paid_at >= p_from and paid_at < p_to
  group by 1 order by 1
$$;

create or replace function public.stats_by_category(p_from timestamptz, p_to timestamptz)
returns table(category text, color text, amount numeric, trx bigint)
language sql stable security invoker set search_path = public as $$
  select c.name, c.color, coalesce(sum(d.amount) filter (where d.status='paid'), 0), count(d.id) filter (where d.status='paid')
  from categories c
  left join donations d on d.category_id = c.id and d.paid_at >= p_from and d.paid_at < p_to
  group by c.id order by c.id
$$;

create or replace function public.stats_top_donors(p_from timestamptz, p_to timestamptz, p_limit int default 10)
returns table(donor_id uuid, name text, amount numeric, trx bigint)
language sql stable security invoker set search_path = public as $$
  select d.id, d.name, sum(t.amount), count(*)
  from donations t join donors d on d.id = t.donor_id
  where t.status='paid' and t.paid_at >= p_from and t.paid_at < p_to
  group by d.id order by 3 desc limit p_limit
$$;

-- ---------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.donors          enable row level security;
alter table public.categories      enable row level security;
alter table public.programs        enable row level security;
alter table public.donations       enable row level security;
alter table public.budgets         enable row level security;
alter table public.budget_expenses enable row level security;
alter table public.wa_templates    enable row level security;
alter table public.wa_messages     enable row level security;
alter table public.wa_campaigns    enable row level security;
alter table public.sync_logs       enable row level security;
alter table public.app_settings    enable row level security;

-- profiles: lihat diri sendiri; admin lihat & kelola semua
create policy profiles_self_read  on public.profiles for select using (id = auth.uid() or public.has_role(array['admin']::app_role[]));
create policy profiles_admin_all  on public.profiles for all    using (public.has_role(array['admin']::app_role[])) with check (public.has_role(array['admin']::app_role[]));

-- donors: semua pengguna aktif baca; semua tulis kecuali hapus (admin/manager)
create policy donors_read   on public.donors for select using (public.is_active_user());
create policy donors_insert on public.donors for insert with check (public.is_active_user());
create policy donors_update on public.donors for update using (public.is_active_user()) with check (public.is_active_user());
create policy donors_delete on public.donors for delete using (public.has_role(array['admin','manager']::app_role[]));

-- categories & programs
create policy cat_read   on public.categories for select using (public.is_active_user());
create policy cat_write  on public.categories for all using (public.has_role(array['admin','manager']::app_role[])) with check (public.has_role(array['admin','manager']::app_role[]));
create policy prog_read  on public.programs   for select using (public.is_active_user());
create policy prog_write on public.programs   for all using (public.has_role(array['admin','manager']::app_role[])) with check (public.has_role(array['admin','manager']::app_role[]));

-- donations
create policy don_read   on public.donations for select using (public.is_active_user());
create policy don_insert on public.donations for insert with check (public.is_active_user());
create policy don_update on public.donations for update using (public.has_role(array['admin','manager']::app_role[])) with check (public.has_role(array['admin','manager']::app_role[]));
create policy don_delete on public.donations for delete using (public.has_role(array['admin']::app_role[]));

-- budget: hanya admin & manager
create policy bud_all  on public.budgets         for all using (public.has_role(array['admin','manager']::app_role[])) with check (public.has_role(array['admin','manager']::app_role[]));
create policy bexp_all on public.budget_expenses for all using (public.has_role(array['admin','manager']::app_role[])) with check (public.has_role(array['admin','manager']::app_role[]));

-- WhatsApp: semua pengguna aktif baca & kirim; template/kampanye dikelola admin & manager
create policy wat_read   on public.wa_templates for select using (public.is_active_user());
create policy wat_write  on public.wa_templates for all using (public.has_role(array['admin','manager']::app_role[])) with check (public.has_role(array['admin','manager']::app_role[]));
create policy wam_read   on public.wa_messages  for select using (public.is_active_user());
create policy wam_insert on public.wa_messages  for insert with check (public.is_active_user());
create policy wac_read   on public.wa_campaigns for select using (public.is_active_user());
create policy wac_write  on public.wa_campaigns for all using (public.has_role(array['admin','manager']::app_role[])) with check (public.has_role(array['admin','manager']::app_role[]));

-- sinkronisasi & pengaturan: baca admin/manager; tulis hanya lewat Edge Function (service role)
create policy sync_read on public.sync_logs   for select using (public.has_role(array['admin','manager']::app_role[]));
create policy set_read  on public.app_settings for select using (public.is_active_user());
create policy set_write on public.app_settings for all using (public.has_role(array['admin']::app_role[])) with check (public.has_role(array['admin']::app_role[]));

-- ---------------------------------------------------------------------
-- 11. REALTIME (pesan WhatsApp masuk tampil langsung)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.wa_messages;

-- ---------------------------------------------------------------------
-- 12. ADMIN PERTAMA
-- Daftar dulu lewat halaman Login (Daftar) atau Supabase Auth > Users,
-- lalu jalankan baris ini dengan email Anda:
--
-- update public.profiles set role='admin', is_active=true
-- where id = (select id from auth.users where email = 'EMAIL_ANDA@example.com');
-- ---------------------------------------------------------------------
