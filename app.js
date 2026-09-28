// ============================================================
// Konveksi App - Logika Utama
// Integrasi database: Supabase (cloud, realtime) dengan
// fallback otomatis ke localStorage saat offline/belum dikonfigurasi.
// Perubahan data juga diantrekan dan disinkronkan saat online.
// ============================================================

// --- State Global ---
let html5QrCode = null;
let isScanning = false;
let lastScannedSku = "";

const STORAGE_KEY = "konveksi_app_v2";

// Pemetaan arah transaksi stok -> kolom database
const JENIS_TO_DB = {
    MASUK_BAHAN:     { direction: "masuk",  category: "bahan_baku" },
    MASUK_BARANGJADI:{ direction: "masuk",  category: "barang_jadi" },
    KELUAR_RETUR:    { direction: "keluar", category: "retur" },
    KELUAR_KIRIM:    { direction: "keluar", category: "barang_jadi" }
};

const defaultState = {
    saldo: 12500000,
    stokBarangJadi: 1240,
    totalOrderAktif: 4,
    nextOrderId: 5, // ORD-005 dan seterusnya
    riwayatScan: [],
    transaksiKeuangan: [
        { tgl: "27 Sep 2026", kategori: "Penjualan Shopee", nominal: 2500000 },
        { tgl: "26 Sep 2026", kategori: "Upah Produksi", nominal: -800000 }
    ],
    orderKanban: {
        potong: [
            { id: cryptoId(), dbId: null, orderId: "ORD-001", nama: "Diora Pants (100 pcs)" },
            { id: cryptoId(), dbId: null, orderId: "ORD-002", nama: "Sakura Dress (50 pcs)" }
        ],
        jahit: [
            { id: cryptoId(), dbId: null, orderId: "ORD-003", nama: "Kemeja Flanel (200 pcs)" }
        ],
        qc: [],
        packing: [
            { id: cryptoId(), dbId: null, orderId: "ORD-004", nama: "Celana Chino (75 pcs)" }
        ]
    }
};

function cryptoId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let state = muatState();

// ---------- Konversi baris Supabase <-> state lokal ----------
function rowToCard(r, tahap) {
    const m = (r.product_name || "").match(/\((\d+)\s*pcs\)/i);
    return {
        id: r.id, dbId: r.id, orderId: r.code,
        nama: r.product_name, qty: r.qty, tahap,
        assigned_to: r.assigned_to || "", notes: r.notes || ""
    };
}

function applyRemoteData(data) {
    // orders -> kanban
    const kanban = { potong: [], jahit: [], qc: [], packing: [] };
    let selesaiCount = 0;
    [...(data.orders || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .forEach(r => {
            if (r.stage === 'selesai') { selesaiCount++; return; }
            if (kanban[r.stage]) kanban[r.stage].push(rowToCard(r, r.stage));
        });
    state.orderKanban = kanban;
    state.totalOrderAktif = Object.values(kanban).reduce((n, a) => n + a.length, 0);
    const maxNum = (data.orders || []).reduce((mx, r) => {
        const n = parseInt((r.code || "").replace(/\D/g, ""), 10);
        return isNaN(n) ? mx : Math.max(mx, n);
    }, 0);
    state.nextOrderId = Math.max(state.nextOrderId, maxNum + 1);

    // stock_movements -> riwayatScan + stok barang jadi
    state.riwayatScan = (data.stock_movements || []).map(mv => ({
        sku: mv.sku,
        jenis: mv.direction === "masuk" ? "Masuk" : "Keluar",
        qty: mv.qty,
        waktu: new Date(mv.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    })).slice(0, 50);
    state.stokBarangJadi = (data.stock_movements || []).reduce((acc, mv) => {
        if (mv.category !== "barang_jadi") return acc;
        return acc + (mv.direction === "masuk" ? mv.qty : -mv.qty);
    }, 0);
    state.stokBarangJadi = Math.max(0, state.stokBarangJadi);

    // finance_transactions -> arus kas & saldo
    const bulan = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
    state.transaksiKeuangan = (data.finance_transactions || []).map(t => {
        const d = new Date(t.txn_date + "T00:00:00");
        return {
            id: t.id,
            tgl: `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`,
            kategori: t.category,
            nominal: Number(t.amount),
            dbId: t.id
        };
    });
    state.saldo = state.transaksiKeuangan.reduce((s, t) => s + t.nominal, 0);

    // app_settings -> saldo awal & counter
    (data.app_settings || []).forEach(s => {
        if (s.key === "next_order_id") state.nextOrderId = Math.max(state.nextOrderId, Number(s.value) || 1);
        if (s.key === "saldo_awal") state.saldo += Number(s.value) || 0;
    });
}

// --- Toast Notification (pengganti alert yang lebih halus & profesional) ---
function showToast(pesan, tipe = 'sukses') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const gaya = {
        sukses:     { bg: '#059669', ikon: 'fa-circle-check' },
        info:       { bg: '#4f46e5', ikon: 'fa-circle-info' },
        peringatan: { bg: '#d97706', ikon: 'fa-triangle-exclamation' },
        galat:      { bg: '#dc2626', ikon: 'fa-circle-exclamation' }
    }[tipe] || { bg: '#059669', ikon: 'fa-circle-check' };

    const el = document.createElement('div');
    el.className = 'toast';
    el.style.background = gaya.bg;
    el.innerHTML = `<i class="fas ${gaya.ikon}"></i><span>${escapeHtml(String(pesan))}</span>`;
    container.appendChild(el);

    setTimeout(() => {
        el.classList.add('out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }, 2800);
}

function muatState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return Object.assign({}, JSON.parse(JSON.stringify(defaultState)), JSON.parse(raw));
    } catch (e) {
        console.warn("Gagal memuat state dari localStorage:", e);
    }
    return JSON.parse(JSON.stringify(defaultState));
}

function simpanState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("Gagal menyimpan state:", e);
    }
}

// --- Inisialisasi awal saat halaman selesai dimuat ---
document.addEventListener("DOMContentLoaded", async () => {
    // Set default tanggal pada form keuangan ke hari ini
    const tglKeuanganEl = document.getElementById('tgl-keuangan');
    if (tglKeuanganEl) {
        tglKeuanganEl.valueAsDate = new Date();
    }

    // Inisialisasi Scanner (hanya jika library html5-qrcode tersedia)
    if (typeof Html5Qrcode !== "undefined") {
        try {
            html5QrCode = new Html5Qrcode("reader");
        } catch (e) {
            console.warn("Html5Qrcode gagal diinisialisasi:", e);
        }
    }

    // ---- Inisialisasi database (Supabase / offline) ----
    const badge = document.getElementById('sync-status');
    if (typeof window.db !== 'undefined') {
        window.db.initDB();
        if (window.db.isRemote()) {
            if (badge) { badge.textContent = '● Menghubungkan…'; badge.className = 'text-xs font-semibold text-blue-600'; }
            try {
                const remote = await window.db.loadAll();
                if (remote) {
                    applyRemoteData(remote);
                    simpanState(); // cache lokal = cermin data cloud
                    showToast('Terhubung ke Supabase. Data cloud dimuat.', 'info');
                } else {
                    showToast('Gagal memuat data cloud — memakai data lokal.', 'peringatan');
                }
            } catch (e) {
                console.warn('Muat Supabase gagal:', e);
                showToast('Koneksi Supabase gagal — mode offline.', 'peringatan');
            }
            // Realtime: render ulang saat ada perubahan dari perangkat lain
            window.db.subscribe(async (table, event) => {
                try {
                    const fresh = await window.db.loadAll();
                    if (fresh) { applyRemoteData(fresh); simpanState(); renderSemua(); }
                } catch (_) {}
            });
        } else {
            if (badge) { badge.textContent = '● Offline (lokal)'; badge.className = 'text-xs font-semibold text-amber-600'; }
            window.addEventListener('online', async () => {
                const n = await window.db.flushQueue().catch(() => 0);
                if (n) showToast(`${n} data tertunda tersinkron ke cloud.`, 'sukses');
            });
        }
    }

    // Render seluruh data dari state (localStorage/Supabase)
    renderSemua();

    // Default menu yang aktif awal
    switchTab('dashboard');
});

function renderSemua() {
    renderDashboard();
    renderRiwayatScan();
    renderKanban();
    renderKeuangan();
}

// --- 1. Logika Navigasi Tab ---
const metaTab = {
    dashboard: { judul: 'Dashboard', sub: 'Ringkasan operasional konveksi hari ini' },
    stok:      { judul: 'Stok & Scan Barcode', sub: 'Catat keluar-masuk barang dengan pemindaian' },
    produksi:  { judul: 'Alur Produksi', sub: 'Pantau progres batch dari potongan hingga pengemasan' },
    keuangan:  { judul: 'Keuangan', sub: 'Pencatatan arus kas pemasukan & pengeluaran' }
};

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('block', 'flex');
    });

    const targetTab = document.getElementById(tabId);
    if (!targetTab) return;
    targetTab.classList.remove('hidden');
    targetTab.classList.add('block');

    // Aktifkan nav yang cocok (sidebar desktop + bottom nav mobile, keduanya memakai data-tab-btn)
    document.querySelectorAll('[data-tab-btn]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tabBtn === tabId);
    });

    // Perbarui judul & subjudul halaman di topbar
    const meta = metaTab[tabId];
    if (meta) {
        const t = document.getElementById('page-title');
        const s = document.getElementById('page-subtitle');
        if (t) t.textContent = meta.judul;
        if (s) s.textContent = meta.sub;
    }

    window.scrollTo({ top: 0 });

    // Matikan kamera otomatis jika pindah menu
    if (tabId !== 'stok' && isScanning) {
        stopScanner();
    }
}

// Perbarui indikator nav aktif saat ukuran layar berubah (mobile <-> desktop)
window.addEventListener('resize', () => {
    const active = document.querySelector('.tab-content:not(.hidden)');
    if (active) switchTab(active.id);
});

// --- 2. Logika Scanner Barcode ---
function startScanner() {
    const btnStartScan = document.getElementById('btn-start-scan');
    const placeholder = document.getElementById('kamera-placeholder');
    const scanLine = document.getElementById('scan-line');
    const resultContainer = document.getElementById('scan-result-container');
    const btnSimpanStok = document.getElementById('btn-simpan-stok');
    const manualContainer = document.getElementById('manual-scan-container');

    // Jika library atau objek scanner tidak tersedia, tampilkan input manual
    if (!html5QrCode) {
        placeholder.classList.add('hidden');
        manualContainer.classList.remove('hidden');
        manualContainer.classList.add('flex');
        btnStartScan.innerHTML = '<i class="fas fa-keyboard mr-1"></i> Input Manual';
        return;
    }

    const config = { fps: 10, qrbox: { width: 200, height: 200 }, aspectRatio: 1.0 };

    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess)
        .then(() => {
            isScanning = true;
            manualContainer.classList.add('hidden');
            manualContainer.classList.remove('flex');
            placeholder.classList.add('hidden');
            scanLine.style.display = 'block';

            btnStartScan.innerHTML = '<i class="fas fa-stop mr-1"></i> Berhenti';
            btnStartScan.classList.replace('bg-blue-600', 'bg-red-600');
            btnStartScan.classList.replace('hover:bg-blue-700', 'hover:bg-red-700');

            resultContainer.classList.add('hidden');
            btnSimpanStok.disabled = true;
            btnSimpanStok.classList.add('opacity-50', 'cursor-not-allowed');
        })
        .catch((err) => {
            console.warn("Gagal akses kamera:", err);
            // Fallback: izinkan input manual alih-alih hanya alert
            placeholder.classList.add('hidden');
            manualContainer.classList.remove('hidden');
            manualContainer.classList.add('flex');
            btnStartScan.innerHTML = '<i class="fas fa-keyboard mr-1"></i> Input Manual';
        });
}

function stopScanner() {
    const btnStartScan = document.getElementById('btn-start-scan');
    const placeholder = document.getElementById('kamera-placeholder');
    const scanLine = document.getElementById('scan-line');

    if (html5QrCode && isScanning) {
        html5QrCode.stop().then(() => {
            isScanning = false;
            placeholder.classList.remove('hidden');
            scanLine.style.display = 'none';

            btnStartScan.innerHTML = '<i class="fas fa-play mr-1"></i> Mulai Scan';
            btnStartScan.classList.replace('bg-red-600', 'bg-blue-600');
            btnStartScan.classList.replace('hover:bg-red-700', 'hover:bg-blue-700');
        }).catch(err => console.warn("Gagal menghentikan scanner:", err));
    }
}

// Tampilkan hasil SKU (dipakai oleh scanner kamera maupun input manual)
function tampilkanHasilSku(sku) {
    lastScannedSku = sku;
    document.getElementById('scanned-sku').textContent = lastScannedSku;
    document.getElementById('scan-result-container').classList.remove('hidden');

    const btnSimpanStok = document.getElementById('btn-simpan-stok');
    btnSimpanStok.disabled = false;
    btnSimpanStok.classList.remove('opacity-50', 'cursor-not-allowed');
}

function onScanSuccess(decodedText) {
    if (window.navigator && window.navigator.vibrate) navigator.vibrate(100);

    tampilkanHasilSku(decodedText);
    stopScanner();
    document.getElementById('btn-start-scan').innerHTML = '<i class="fas fa-redo mr-1"></i> Scan Ulang';
}

document.getElementById('btn-start-scan').addEventListener('click', () => {
    isScanning ? stopScanner() : startScanner();
});

// Handler input manual (fallback ketika kamera tidak tersedia)
document.getElementById('btn-manual-submit').addEventListener('click', () => {
    const input = document.getElementById('manual-sku-input');
    const sku = input.value.trim();
    if (!sku) {
        alert("Mohon masukkan SKU terlebih dahulu.");
        return;
    }
    tampilkanHasilSku(sku);
    input.value = "";
    document.getElementById('manual-scan-container').classList.add('hidden');
    document.getElementById('manual-scan-container').classList.remove('flex');
    document.getElementById('kamera-placeholder').classList.remove('hidden');
    document.getElementById('btn-start-scan').innerHTML = '<i class="fas fa-redo mr-1"></i> Scan Ulang';
});

document.getElementById('manual-sku-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-manual-submit').click();
    }
});

document.getElementById('btn-simpan-stok').addEventListener('click', () => {
    if (!lastScannedSku) return;

    const selectEl = document.getElementById('jenis-transaksi');
    const jenisValue = selectEl.value;
    const jenisKata = jenisValue.startsWith('MASUK') ? "Masuk" : "Keluar";

    const jumlahEl = document.getElementById('jumlah-stok');
    const qty = parseInt(jumlahEl.value);
    if (!qty || isNaN(qty) || qty <= 0) {
        showToast("Jumlah harus berupa angka lebih dari 0.", "peringatan");
        return;
    }

    // Update stok barang jadi di dashboard untuk transaksi barang jadi
    if (jenisValue === 'MASUK_BARANGJADI') {
        state.stokBarangJadi += qty;
    } else if (jenisValue === 'KELUAR_KIRIM') {
        state.stokBarangJadi = Math.max(0, state.stokBarangJadi - qty);
    }

    const waktu = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    state.riwayatScan.unshift({ sku: lastScannedSku, jenis: jenisKata, qty: qty, waktu: waktu });
    if (state.riwayatScan.length > 50) state.riwayatScan.pop();

    simpanState();

    // Simpan pergerakan stok ke Supabase (tabel stock_movements).
    // Saat offline, db.insert otomatis mengantrekan operasi utk disinkronkan nanti.
    const dbMap = JENIS_TO_DB[jenisValue] || { direction: jenisKata.toLowerCase(), category: 'barang_jadi' };
    if (window.db) {
        window.db.insert('stock_movements', {
            sku: lastScannedSku,
            direction: dbMap.direction,
            category: dbMap.category,
            qty: qty,
            scanned_by: 'owner',
            note: null
        }).catch(() => {});
    }

    renderDashboard();
    renderRiwayatScan(lastScannedSku);
    showToast(`Stok ${jenisKata.toLowerCase()}: ${escapeHtml(lastScannedSku)} ×${qty} tersimpan.`, 'sukses');

    // Reset UI hasil scan
    const btnSimpanStok = document.getElementById('btn-simpan-stok');
    document.getElementById('scan-result-container').classList.add('hidden');
    btnSimpanStok.disabled = true;
    btnSimpanStok.classList.add('opacity-50', 'cursor-not-allowed');
    lastScannedSku = "";

    startScanner();
});

function renderRiwayatScan(skuHighlight) {
    const tbody = document.getElementById('tabel-riwayat');
    if (!tbody) return;

    if (state.riwayatScan.length === 0) {
        tbody.innerHTML = `
            <tr class="border-b">
                <td class="py-2.5 px-2 font-mono text-blue-600">BRG-JD-001</td>
                <td class="py-2.5 px-2"><span class="bg-green-100 text-green-800 text-[10px] sm:text-xs px-2 py-1 rounded font-semibold">Masuk</span></td>
                <td class="py-2.5 px-2">+50</td>
                <td class="py-2.5 px-2 text-gray-500">10:32</td>
            </tr>`;
        return;
    }

    tbody.innerHTML = state.riwayatScan.map(r => {
        const badgeClass = r.jenis === "Masuk" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
        const tanda = r.jenis === "Masuk" ? "+" : "-";
        return `
            <tr class="border-b ${r.sku === skuHighlight ? 'bg-yellow-100' : ''}">
                <td class="py-2.5 px-2 font-mono text-blue-600">${escapeHtml(r.sku)}</td>
                <td class="py-2.5 px-2"><span class="${badgeClass} text-[10px] sm:text-xs font-semibold px-2 py-1 rounded">${r.jenis}</span></td>
                <td class="py-2.5 px-2">${tanda}${r.qty}</td>
                <td class="py-2.5 px-2 text-gray-500">${r.waktu}</td>
            </tr>`;
    }).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- 3. Logika Kanban Board Produksi ---
const warnaTahap = {
    potong: { border: 'border-blue-500', btn: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200' },
    jahit: { border: 'border-yellow-500', btn: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border-yellow-200' },
    qc: { border: 'border-red-500', btn: 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200' },
    packing: { border: 'border-green-500', btn: '' }
};

function buatCardOrder(order, tahap) {
    const card = document.createElement('div');
    card.dataset.orderId = order.id;
    const w = warnaTahap[tahap];

    let buttonHtml;
    if (tahap === 'packing') {
        buttonHtml = `<button onclick="selesaiProduksi(this, 'packing')" class="btn-action w-full bg-green-500 hover:bg-green-600 text-white text-xs py-1.5 rounded font-bold transition shadow-sm"><i class="fas fa-check"></i> Masuk Gudang</button>`;
    } else {
        const tujuan = { potong: 'jahit', jahit: 'qc', qc: 'packing' }[tahap];
        const labelTujuan = tujuan.charAt(0).toUpperCase() + tujuan.slice(1);
        buttonHtml = `<button onclick="geserTahap(this, '${tahap}', '${tujuan}')" class="btn-action w-full ${w.btn} border text-xs py-1.5 rounded font-semibold transition shadow-sm">Geser ke ${labelTujuan} &rarr;</button>`;
    }

    const penugasan = order.assigned_to
        ? `<p class="text-[10px] text-gray-400 mb-1"><i class="fas fa-user-team mr-1"></i>${escapeHtml(order.assigned_to)}</p>` : '';

    card.className = `order-card bg-white p-3 rounded-md shadow-sm border-l-4 ${w.border} mb-2 transition-all duration-300`;
    card.innerHTML = `
        <p class="font-bold text-sm text-gray-800">${escapeHtml(order.orderId || order.id)}</p>
        <p class="text-xs text-gray-500 mb-1">${escapeHtml(order.nama)}</p>
        ${penugasan}
        ${buttonHtml}`;
    return card;
}

function renderKanban() {
    ['potong', 'jahit', 'qc', 'packing'].forEach(tahap => {
        const container = document.getElementById(`container-${tahap}`);
        if (!container) return;
        container.innerHTML = '';
        const orders = state.orderKanban[tahap] || [];
        if (orders.length === 0) {
            container.innerHTML = `<p class="empty-msg text-xs text-center text-gray-400 py-6 italic border-2 border-dashed border-gray-200 rounded">Kosong</p>`;
        } else {
            orders.forEach(o => container.appendChild(buatCardOrder(o, tahap)));
        }
        const badge = document.getElementById(`badge-${tahap}`);
        if (badge) badge.textContent = orders.length;
    });
}

function geserTahap(btnElement, tahapSekarang, tahapTujuan) {
    const card = btnElement.closest('.order-card');
    if (!card) return;
    const orderId = card.dataset.orderId;

    // Update state
    const idx = state.orderKanban[tahapSekarang].findIndex(o => o.id === orderId);
    if (idx === -1) return;
    const [order] = state.orderKanban[tahapSekarang].splice(idx, 1);
    order.tahap = tahapTujuan;
    state.orderKanban[tahapTujuan].push(order);
    simpanState();

    // Sinkron ke Supabase (kolom stage pada tabel orders)
    sinkronStage(order, tahapTujuan);

    renderKanban();
}

async function sinkronStage(order, tahapBaru) {
    if (!window.db) return;
    try {
        if (order.dbId) {
            await window.db.update('orders', order.dbId, { stage: tahapBaru });
        } else if (window.db.isRemote()) {
            // Kartu lama hasil migrasi lokal -> buat barisnya di cloud
            const m = (order.nama || "").match(/\((\d+)\s*pcs\)/i);
            const row = await window.db.insert('orders', {
                code: order.orderId, product_name: order.nama,
                qty: m ? parseInt(m[1]) : 1, stage: tahapBaru
            });
            if (row && !row._local) { order.dbId = row.id; simpanState(); }
        } else {
            // Offline: kartu tanpa dbId belum ada di cloud -> antrekan pembuatan order
            const m = (order.nama || "").match(/\((\d+)\s*pcs\)/i);
            window.db.enqueue({ type: 'insert', table: 'orders', row: {
                code: order.orderId, product_name: order.nama,
                qty: m ? parseInt(m[1]) : 1, stage: tahapBaru
            }});
        }
    } catch (e) { console.warn('Sinkron stage gagal:', e); }
}

function selesaiProduksi(btnElement, tahapSekarang) {
    const card = btnElement.closest('.order-card');
    if (!card) return;
    const orderId = card.dataset.orderId;
    const order = (state.orderKanban[tahapSekarang] || []).find(o => o.id === orderId);

    if (confirm(`Apakah order ${orderId} sudah selesai dipacking dan masuk ke stok gudang?`)) {
        const idx = state.orderKanban[tahapSekarang].findIndex(o => o.id === orderId);
        if (idx !== -1) state.orderKanban[tahapSekarang].splice(idx, 1);

        // Tambah estimasi stok barang jadi dari jumlah order (angka dalam nama, mis. "(75 pcs)")
        let qtyOrder = 0;
        if (order) {
            const m = order.nama.match(/\((\d+)\s*pcs\)/i);
            if (m) { qtyOrder = parseInt(m[1]); state.stokBarangJadi += qtyOrder; }
        }

        state.totalOrderAktif = Math.max(0, state.totalOrderAktif - 1);
        simpanState();

        // Sinkron ke Supabase: stage 'selesai' + catat stok masuk barang jadi
        // (saat offline operasi otomatis diantrekan oleh db.js)
        if (window.db) {
            (async () => {
                if (order && order.dbId) await window.db.update('orders', order.dbId, { stage: 'selesai' }).catch(() => {});
                if (qtyOrder > 0) {
                    await window.db.insert('stock_movements', {
                        sku: order ? order.orderId : 'PRODUKSI',
                        direction: 'masuk', category: 'barang_jadi',
                        qty: qtyOrder, scanned_by: 'owner',
                        note: `Penyelesaian produksi ${orderId}`
                    }).catch(() => {});
                }
            })();
        }

        renderKanban();
        renderDashboard();
        showToast(`Order ${orderId} selesai & masuk stok gudang${qtyOrder ? ` (+${qtyOrder} pcs)` : ''}.`, 'sukses');
    }
}

function tambahOrder() {
    const modal = document.getElementById('modal-order');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('order-nama').focus();
}

function tutupModalOrder() {
    const modal = document.getElementById('modal-order');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('form-order-baru').reset();
}

// Tutup modal jika area latar gelap diklik
document.getElementById('modal-order').addEventListener('click', (e) => {
    if (e.target.id === 'modal-order') tutupModalOrder();
});

document.getElementById('form-order-baru').addEventListener('submit', (e) => {
    e.preventDefault();
    const nama = document.getElementById('order-nama').value.trim();
    const jumlah = parseInt(document.getElementById('order-jumlah').value);
    const pekerjaEl = document.getElementById('order-pekerja');
    const pekerja = pekerjaEl ? pekerjaEl.value.trim() : '';
    if (!nama || !jumlah || jumlah <= 0) {
        showToast("Mohon isi nama produk dan jumlah yang valid.", "peringatan");
        return;
    }

    const orderCode = `ORD-${String(state.nextOrderId).padStart(3, '0')}`;
    state.nextOrderId++;
    const card = {
        id: cryptoId(), dbId: null, orderId: orderCode,
        nama: `${nama} (${jumlah} pcs)`, assigned_to: pekerja, tahap: 'potong'
    };
    state.orderKanban.potong.push(card);
    state.totalOrderAktif++;

    simpanState();

    // Simpan ke Supabase (tabel orders) — kolom siap untuk portal karyawan.
    // Saat offline, operasi diantrekan dan disinkronkan begitu koneksi pulih.
    if (window.db) {
        window.db.insert('orders', {
            code: orderCode, product_name: `${nama} (${jumlah} pcs)`,
            qty: jumlah, stage: 'potong',
            assigned_to: pekerja || null, notes: null
        }).then(row => {
            if (row && !row._local) { card.dbId = row.id; simpanState(); }
        }).catch(() => {});
    }

    renderKanban();
    renderDashboard();
    tutupModalOrder();
    showToast(`Order ${orderCode} dibuat & masuk tahap Potong.`, 'sukses');
});

// --- 4. Logika Dashboard ---
function renderDashboard() {
    const elStok = document.getElementById('dashboard-stok-jadi');
    if (elStok) elStok.textContent = state.stokBarangJadi.toLocaleString('id-ID');

    const elOrder = document.getElementById('dashboard-order-aktif');
    if (elOrder) elOrder.innerHTML = `${state.totalOrderAktif} <span class="text-xs font-normal">batch</span>`;

    const formatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    const elSaldo = document.getElementById('dashboard-saldo');
    if (elSaldo) elSaldo.textContent = formatter.format(state.saldo);
}

// --- 5. Logika Form Keuangan ---
const formatRupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

function renderKeuangan() {
    const tbody = document.getElementById('tabel-keuangan');
    if (!tbody) return;

    tbody.innerHTML = state.transaksiKeuangan.map(t => {
        const masuk = t.nominal >= 0;
        return `
            <tr class="border-b">
                <td class="py-2.5 px-2">${escapeHtml(t.tgl)}</td>
                <td class="py-2.5 px-2 font-medium">${escapeHtml(t.kategori)}</td>
                <td class="py-2.5 px-2 text-right ${masuk ? 'text-green-600' : 'text-red-600'} font-bold">${masuk ? '+' : '-'} ${formatRupiah.format(Math.abs(t.nominal))}</td>
            </tr>`;
    }).join('');

    document.getElementById('total-saldo').textContent = formatRupiah.format(state.saldo);
}

document.getElementById('form-keuangan').addEventListener('submit', function (e) {
    e.preventDefault();

    const jenis = document.querySelector('input[name="jenis_uang"]:checked').value;
    const kategori = document.getElementById('kategori-keuangan').value;
    const tanggalInput = document.getElementById('tgl-keuangan').value;
    const jumlah = parseInt(document.getElementById('jumlah-keuangan').value);

    if (!jumlah || isNaN(jumlah) || jumlah <= 0) {
        alert("Jumlah harus berupa angka lebih dari 0.");
        return;
    }
    if (!tanggalInput) {
        alert("Tanggal belum dipilih.");
        return;
    }

    const dateObj = new Date(tanggalInput + 'T00:00:00'); // hindari pergeseran zona waktu
    const namaBulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
    const tglFormatted = `${dateObj.getDate()} ${namaBulan[dateObj.getMonth()]} ${dateObj.getFullYear()}`;

    const nominal = jenis === "Pemasukan" ? jumlah : -jumlah;
    state.saldo += nominal;
    const transaksiBaru = { tgl: tglFormatted, kategori: kategori, nominal: nominal };
    state.transaksiKeuangan.unshift(transaksiBaru);
    if (state.transaksiKeuangan.length > 200) state.transaksiKeuangan.pop();

    simpanState();

    // Simpan arus kas ke Supabase (tabel finance_transactions).
    // Saat offline, operasi diantrekan dan disinkronkan begitu koneksi pulih.
    if (window.db) {
        window.db.insert('finance_transactions', {
            txn_date: tanggalInput,          // format YYYY-MM-DD
            category: kategori,
            amount: nominal,
            description: null,
            recorded_by: 'owner'
        }).then(row => { if (row && !row._local) { transaksiBaru.dbId = row.id; simpanState(); } })
          .catch(() => {});
    }

    renderKeuangan();
    renderDashboard();
    showToast(`Transaksi ${jenis} ${formatRupiah.format(jumlah)} tersimpan.`, 'sukses');

    // Beri sorotan singkat pada baris baru
    const firstRow = document.getElementById('tabel-keuangan').firstElementChild;
    if (firstRow) {
        firstRow.classList.add('bg-yellow-50');
        setTimeout(() => firstRow.classList.remove('bg-yellow-50'), 1500);
    }

    document.getElementById('jumlah-keuangan').value = "";
});

// --- 6. Export Excel (CSV) ---
document.getElementById('export-excel').addEventListener('click', () => {
    const header = ["Tanggal", "Kategori", "Nominal"];
    const rows = state.transaksiKeuangan.map(t => [t.tgl, t.kategori, t.nominal]);
    const csvContent = "\uFEFF" + [header, ...rows]
        .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
        .join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arus-kas-konveksi-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});
