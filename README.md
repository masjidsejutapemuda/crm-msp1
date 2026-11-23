# CRM Masjid Sejuta Pemuda

Web dashboard donatur: **Login terbatas · Dashboard · Data Donatur · Statistik · Budget Syiar · WhatsApp · Sinkronisasi Scalev**.
Stack: HTML/CSS/JS statis (GitHub Pages) + Supabase (Auth, Postgres, Edge Functions) + Scalev + WhatsApp Cloud API.

```
crm-msp/
├─ index.html              Login / Daftar / Lupa password
├─ app.html                Shell aplikasi (sidebar + router)
├─ assets/css/style.css    Tema hijau zamrud + emas (ubah di :root)
├─ assets/js/              config.js · core.js · app.js · pages/*.js
└─ supabase/
   ├─ schema.sql           Tabel, RLS, fungsi statistik
   └─ functions/           scalev-webhook · scalev-sync · wa-send · wa-webhook
```

## Status saat ini
Proyek Supabase **crm-masjid-sejuta-pemuda** (`arvknvgihsrpzmypjxwv`, Singapura) sudah dibuat. Skema + RLS sudah terpasang, `config.js` sudah terisi, dan 4 Edge Function sudah ter-deploy. Yang tersisa untuk Anda: langkah 1.3 dan 1.5 di bawah, isi secret (langkah 2), webhook Scalev/Meta (3-4), dan GitHub Pages (5). Langkah 1.1, 1.2, 1.4 dan deploy fungsi di langkah 2 sudah selesai.

## Langkah setup (±30 menit)

### 1. Supabase
1. Buat proyek di supabase.com (region Singapore).
2. **SQL Editor** → tempel isi `supabase/schema.sql` → Run. *(Jalankan sekali; policy tidak idempoten.)*
3. **Authentication → Providers → Email**: aktifkan. **URL Configuration**: isi *Site URL* dengan alamat GitHub Pages Anda.
4. Salin **Project URL** dan **anon public key** (Settings → API) ke `assets/js/config.js`.
5. Daftar akun Anda lewat halaman login, lalu jadikan admin (SQL Editor):
   ```sql
   update public.profiles set role='admin', is_active=true
   where id = (select id from auth.users where email = 'EMAIL_ANDA');
   ```
   Akun lain yang mendaftar akan berstatus *Menunggu persetujuan* sampai Anda menyetujuinya di menu **Pengguna & Akses**.

### 2. Edge Functions
```bash
npm i -g supabase && supabase login
supabase link --project-ref <PROJECT_ID>

supabase secrets set \
  SCALEV_WEBHOOK_SECRET=<rahasia-webhook> \
  SCALEV_API_KEY=<api-key-scalev> \
  SCALEV_API_BASE=https://api.scalev.id/v2 \
  WA_PHONE_NUMBER_ID=<id> WA_ACCESS_TOKEN=<token> \
  WA_VERIFY_TOKEN=<string-bebas> WA_APP_SECRET=<app-secret-meta> \
  ALLOWED_ORIGIN=https://<user>.github.io

supabase functions deploy scalev-webhook --no-verify-jwt
supabase functions deploy wa-webhook     --no-verify-jwt
supabase functions deploy scalev-sync
supabase functions deploy wa-send
```
Webhook publik (`--no-verify-jwt`) dilindungi tanda tangan HMAC, bukan login.

### 3. Scalev
Scalev → Developer/Webhook: URL `https://<PROJECT_ID>.supabase.co/functions/v1/scalev-webhook`, event order dibuat/dibayar, isi secret sama dengan `SCALEV_WEBHOOK_SECRET`.

> **Verifikasi payload (penting):** nama field & header tanda tangan Scalev saya petakan secara toleran (`supabase/functions/_shared/scalev.ts`), tetapi saya belum bisa menguji ke akun Scalev Anda. Kirim 1 order uji, lalu cek menu **Sinkronisasi → Riwayat**. Jika status *gagal*/field kosong, sesuaikan `mapOrder()` dan nama header di `SCALEV_SIGNATURE_HEADER` dengan dokumentasi Scalev.

Kategori donasi (Zakat/Infaq/Sedekah/Wakaf/Qurban) dideteksi dari **nama produk** Scalev. Beri nama produk yang memuat kata tersebut.

### 4. WhatsApp Cloud API
1. developers.facebook.com → buat app Business → tambahkan produk WhatsApp → nomor & token permanen (System User).
2. Webhook: Callback URL `…/functions/v1/wa-webhook`, Verify token = `WA_VERIFY_TOKEN`, subscribe field `messages`.
3. Buat template di Meta Business Manager (nama huruf kecil), tunggu *Approved*, lalu daftarkan namanya di dashboard → **WhatsApp → Template**.
4. Aturan Meta: pesan bebas hanya dalam 24 jam setelah donatur membalas; di luar itu wajib template. Donatur yang membalas “STOP” otomatis di-opt-out.

### 5. Deploy ke GitHub Pages
Push folder ini ke repo GitHub → Settings → Pages → Branch `main` / root. (Jangan commit service-role key; yang ada di `config.js` hanya anon key.)

## Hak akses
| Fitur | Admin | Manager | Staf |
|---|:-:|:-:|:-:|
| Dashboard, Statistik, Donatur, WhatsApp 1-1 | ✓ | ✓ | ✓ |
| Hapus donatur, kampanye WA, template | ✓ | ✓ | – |
| Budget Syiar, Sinkronisasi | ✓ | ✓ | – |
| Pengguna & Akses | ✓ | – | – |

Aturan ini dipaksa di database (Row Level Security), bukan hanya disembunyikan di menu.

## Sinkron terjadwal (opsional)
Set `CRON_SECRET`, lalu jadwalkan `pg_cron` + `pg_net` memanggil `scalev-sync` dengan header `x-cron-secret` setiap beberapa jam sebagai cadangan webhook.
