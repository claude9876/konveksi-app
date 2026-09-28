-- ============================================================
-- Skema Database Supabase — Konveksi App (Owner) + Portal Karyawan
-- Jalankan sekali di: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- AKTIFKAN REALTIME (perubahan langsung tersinkron antar perangkat)
-- Di dashboard: Database -> Replication -> aktifkan semua tabel di bawah,
-- atau jalankan perintah berikut:
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table stock_movements;
alter publication supabase_realtime add table finance_transactions;
alter publication supabase_realtime add table app_settings;

-- ------------------------------------------------------------
-- 1. TABEL ORDERS (Kanban Produksi)
-- ------------------------------------------------------------
create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,                 -- ORD-001
    product_name text not null,                -- "Diora Pants"
    qty integer not null check (qty > 0),
    stage text not null default 'potong'
        check (stage in ('potong','jahit','qc','packing','selesai')),
    assigned_to text,                          -- email/nama karyawan (portal karyawan)
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists orders_stage_idx on public.orders (stage);

-- ------------------------------------------------------------
-- 2. TABEL STOCK_MOVEMENTS (Scan barcode masuk/keluar)
-- ------------------------------------------------------------
create table if not exists public.stock_movements (
    id uuid primary key default gen_random_uuid(),
    sku text not null,                         -- hasil scan barcode/QR
    direction text not null check (direction in ('masuk','keluar')),
    category text not null default 'barang_jadi', -- bahan_baku | barang_jadi | retur
    qty integer not null check (qty > 0),
    scanned_by text default 'owner',           -- 'owner' atau email karyawan
    note text,
    created_at timestamptz not null default now()
);
create index if not exists stock_movements_sku_idx on public.stock_movements (sku);
create index if not exists stock_movements_created_idx on public.stock_movements (created_at desc);

-- ------------------------------------------------------------
-- 3. TABEL FINANCE_TRANSACTIONS (Arus kas)
-- ------------------------------------------------------------
create table if not exists public.finance_transactions (
    id uuid primary key default gen_random_uuid(),
    txn_date date not null default current_date,
    category text not null,                    -- Penjualan Shopee, Upah Produksi, ...
    amount numeric not null,                   -- positif = pemasukan, negatif = pengeluaran
    description text,
    recorded_by text default 'owner',
    created_at timestamptz not null default now()
);
create index if not exists finance_txn_date_idx on public.finance_transactions (txn_date desc);

-- ------------------------------------------------------------
-- 4. TABEL APP_SETTINGS (saldo awal, counter order, dst.)
-- ------------------------------------------------------------
create table if not exists public.app_settings (
    key text primary key,                      -- 'saldo_awal', 'next_order_id', ...
    value jsonb not null,
    updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. TABEL PRODUCTIONS (catatan kerja per order utk portal karyawan)
-- ------------------------------------------------------------
create table if not exists public.productions (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references public.orders(id) on delete cascade,
    worker_email text not null,                -- login karyawan (Auth Supabase)
    stage text not null check (stage in ('potong','jahit','qc','packing')),
    status text not null default 'proses'
        check (status in ('menunggu','proses','selesai','revisi')),
    qty_done integer not null default 0,
    photo_url text,                            -- upload bukti hasil kerja (Supabase Storage)
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists productions_worker_idx on public.productions (worker_email);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------
-- Kebijakan:
--  * Mode demo (belum pakai login): anon boleh baca & tulis.
--  * Saat portal karyawan dengan Supabase Auth diaktifkan,
--    cukup ketatkan policy — struktur tabel tidak berubah.

alter table public.orders enable row level security;
alter table public.stock_movements enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.app_settings enable row level security;
alter table public.productions enable row level security;

-- Policy sementara untuk pengembangan (anon & authenticated akses penuh)
do $$
begin
    foreach tbl in array ['orders','stock_movements','finance_transactions','app_settings','productions']
    loop
        execute format('drop policy if exists dev_all on public.%I;', tbl);
        execute format('create policy dev_all on public.%I for all to anon, authenticated using (true) with check (true);', tbl);
    end loop;
end $$;

-- >>> CONTOH KETAT (aktifkan setelah portal karyawan siap) <<<
-- drop policy dev_all on public.orders;
-- create policy "karyawan lihat order sendiri" on public.orders
--   for select to authenticated
--   using (assigned_to = auth.jwt() ->> 'email' or exists (
--     select 1 from public.app_settings s where s.key='role_owner'
--       and s.value->>'email' = auth.jwt() ->> 'email'));
-- create policy "karyawan update progres" on public.orders
--   for update to authenticated
--   using (assigned_to = auth.jwt() ->> 'email')
--   with check (assigned_to = auth.jwt() ->> 'email');

-- ------------------------------------------------------------
-- Trigger auto-update updated_at
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
for each row execute function public.touch_updated_at();

drop trigger if exists productions_touch on public.productions;
create trigger productions_touch before update on public.productions
for each row execute function public.touch_updated_at();
