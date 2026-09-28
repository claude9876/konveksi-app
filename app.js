// ============================================================
// Konveksi App - Logika Utama
// Semua data disimpan di localStorage agar tetap tersimpan
// setelah halaman ditutup / browser dibuka ulang.
// ============================================================

// --- State Global ---
let html5QrCode = null;
let isScanning = false;
let lastScannedSku = "";

const STORAGE_KEY = "konveksi_app_v2";

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
            { id: "ORD-001", nama: "Diora Pants (100 pcs)" },
            { id: "ORD-002", nama: "Sakura Dress (50 pcs)" }
        ],
        jahit: [
            { id: "ORD-003", nama: "Kemeja Flanel (200 pcs)" }
        ],
        qc: [],
        packing: [
            { id: "ORD-004", nama: "Celana Chino (75 pcs)" }
        ]
    }
};

let state = muatState();

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
document.addEventListener("DOMContentLoaded", () => {
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

    // Render seluruh data dari state (localStorage)
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
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('block', 'flex');
    });

    const targetTab = document.getElementById(tabId);
    if (!targetTab) return;
    targetTab.classList.remove('hidden');
    if (tabId === 'produksi') {
        targetTab.classList.add('flex', 'flex-col');
    } else {
        targetTab.classList.add('block');
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('text-blue-700', 'font-semibold', 'border-t-2', 'border-l-4', 'border-blue-700');
        btn.classList.add('text-gray-500', 'border-transparent');
    });

    const activeBtn = document.querySelector(`button[onclick="switchTab('${tabId}')"]`);
    if (activeBtn) {
        activeBtn.classList.remove('text-gray-500', 'border-transparent');
        activeBtn.classList.add('text-blue-700', 'font-semibold');
        if (window.innerWidth >= 768) {
            activeBtn.classList.add('border-l-4', 'border-blue-700');
        } else {
            activeBtn.classList.add('border-t-2', 'border-blue-700');
        }
    }

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
    document.getElementById('scanned-sku').innerText = lastScannedSku;
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
        alert("Jumlah harus berupa angka lebih dari 0.");
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
    renderDashboard();
    renderRiwayatScan(lastScannedSku);

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

    card.className = `order-card bg-white p-3 rounded-md shadow-sm border-l-4 ${w.border} mb-2 transition-all duration-300`;
    card.innerHTML = `
        <p class="font-bold text-sm text-gray-800">${escapeHtml(order.id)}</p>
        <p class="text-xs text-gray-500 mb-2">${escapeHtml(order.nama)}</p>
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
        if (badge) badge.innerText = orders.length;
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
    state.orderKanban[tahapTujuan].push(order);
    simpanState();

    renderKanban();
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
        if (order) {
            const m = order.nama.match(/\((\d+)\s*pcs\)/i);
            if (m) state.stokBarangJadi += parseInt(m[1]);
        }

        state.totalOrderAktif = Math.max(0, state.totalOrderAktif - 1);
        simpanState();

        renderKanban();
        renderDashboard();
        alert(`Order ${orderId} selesai dan berhasil dipindahkan ke stok gudang!`);
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
    if (!nama || !jumlah || jumlah <= 0) {
        alert("Mohon isi nama produk dan jumlah yang valid.");
        return;
    }

    const orderId = `ORD-${String(state.nextOrderId).padStart(3, '0')}`;
    state.nextOrderId++;
    state.orderKanban.potong.push({ id: orderId, nama: `${nama} (${jumlah} pcs)` });
    state.totalOrderAktif++;

    simpanState();
    renderKanban();
    renderDashboard();
    tutupModalOrder();
});

// --- 4. Logika Dashboard ---
function renderDashboard() {
    const elStok = document.getElementById('dashboard-stok-jadi');
    if (elStok) elStok.innerText = state.stokBarangJadi.toLocaleString('id-ID');

    const elOrder = document.getElementById('dashboard-order-aktif');
    if (elOrder) elOrder.innerHTML = `${state.totalOrderAktif} <span class="text-xs font-normal">batch</span>`;

    const formatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    const elSaldo = document.getElementById('dashboard-saldo');
    if (elSaldo) elSaldo.innerText = formatter.format(state.saldo);
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

    document.getElementById('total-saldo').innerText = formatRupiah.format(state.saldo);
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
    state.transaksiKeuangan.unshift({ tgl: tglFormatted, kategori: kategori, nominal: nominal });
    if (state.transaksiKeuangan.length > 200) state.transaksiKeuangan.pop();

    simpanState();
    renderKeuangan();
    renderDashboard();

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
