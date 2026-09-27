// --- Inisialisasi awal saat halaman selesai dimuat ---
document.addEventListener("DOMContentLoaded", () => {
    // Set default tanggal pada form keuangan ke hari ini
    const tglKeuanganEl = document.getElementById('tgl-keuangan');
    if(tglKeuanganEl) {
        tglKeuanganEl.valueAsDate = new Date();
    }
    
    // Inisialisasi Scanner Scanner
    html5QrCode = new Html5Qrcode("reader");
    
    // Default menu yang aktif awal
    switchTab('dashboard'); 
});

// --- 1. Logika Navigasi Tab ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden'); 
        el.classList.remove('block', 'flex');
    });
    
    const targetTab = document.getElementById(tabId);
    targetTab.classList.remove('hidden');
    if(tabId === 'produksi') {
        targetTab.classList.add('flex', 'flex-col');
    } else {
        targetTab.classList.add('block');
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('text-blue-700', 'border-t-2', 'border-l-4', 'border-blue-700');
        btn.classList.add('text-gray-500', 'border-transparent');
    });

    const activeBtn = document.querySelector(`button[onclick="switchTab('${tabId}')"]`);
    if(activeBtn) {
        activeBtn.classList.remove('text-gray-500', 'border-transparent');
        if (window.innerWidth >= 768) {
            activeBtn.classList.add('text-blue-700', 'border-l-4', 'border-blue-700');
        } else {
            activeBtn.classList.add('text-blue-700', 'border-t-2', 'border-blue-700');
        }
    }

    // Matikan kamera otomatis jika pindah menu
    if(tabId !== 'stok' && typeof isScanning !== 'undefined' && isScanning) {
        stopScanner();
    }
}

// --- 2. Logika Scanner Barcode ---
let html5QrCode;
let isScanning = false;
let lastScannedSku = "";

function startScanner() {
    const btnStartScan = document.getElementById('btn-start-scan');
    const placeholder = document.getElementById('kamera-placeholder');
    const scanLine = document.getElementById('scan-line');
    const resultContainer = document.getElementById('scan-result-container');
    const btnSimpanStok = document.getElementById('btn-simpan-stok');

    const config = { fps: 10, qrbox: { width: 200, height: 200 }, aspectRatio: 1.0 };
    
    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess)
    .then(() => {
        isScanning = true;
        placeholder.classList.add('hidden');
        scanLine.style.display = 'block';
        
        btnStartScan.innerHTML = '<i class="fas fa-stop mr-1"></i> Berhenti';
        btnStartScan.classList.replace('bg-blue-600', 'bg-red-600');
        btnStartScan.classList.replace('hover:bg-blue-700', 'hover:bg-red-700');
        
        resultContainer.classList.add('hidden');
        btnSimpanStok.disabled = true;
        btnSimpanStok.classList.add('opacity-50', 'cursor-not-allowed');
    }).catch((err) => { 
        alert("Gagal akses kamera."); 
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
        });
    }
}

document.getElementById('btn-start-scan').addEventListener('click', () => { 
    isScanning ? stopScanner() : startScanner(); 
});

function onScanSuccess(decodedText) {
    if(window.navigator && window.navigator.vibrate) navigator.vibrate(100);
    
    lastScannedSku = decodedText;
    document.getElementById('scanned-sku').innerText = lastScannedSku;
    document.getElementById('scan-result-container').classList.remove('hidden');
    
    const btnSimpanStok = document.getElementById('btn-simpan-stok');
    btnSimpanStok.disabled = false;
    btnSimpanStok.classList.remove('opacity-50', 'cursor-not-allowed');
    
    stopScanner();
    document.getElementById('btn-start-scan').innerHTML = '<i class="fas fa-redo mr-1"></i> Scan Ulang';
}

document.getElementById('btn-simpan-stok').addEventListener('click', () => {
    const selectEl = document.getElementById('jenis-transaksi');
    const jenisFull = selectEl.options[selectEl.selectedIndex].text;
    const jenisKata = jenisFull.split(' ')[0];
    const waktu = new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'});
    
    let badgeClass = jenisKata === "Masuk" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
    
    const newRow = document.createElement('tr');
    newRow.className = "border-b bg-yellow-100 transition-colors duration-1000";
    newRow.innerHTML = `
        <td class="py-2.5 px-2 font-mono text-blue-600">${lastScannedSku}</td>
        <td class="py-2.5 px-2"><span class="${badgeClass} text-[10px] sm:text-xs font-semibold px-2 py-1 rounded">${jenisKata}</span></td>
        <td class="py-2.5 px-2 text-gray-500">${waktu}</td>
    `;
    
    document.getElementById('tabel-riwayat').prepend(newRow);
    setTimeout(() => newRow.classList.remove('bg-yellow-100'), 1500);

    const btnSimpanStok = document.getElementById('btn-simpan-stok');
    document.getElementById('scan-result-container').classList.add('hidden');
    btnSimpanStok.disabled = true;
    btnSimpanStok.classList.add('opacity-50', 'cursor-not-allowed');
    
    startScanner();
});

// --- 3. Logika Kanban Board Produksi ---
let totalOrderAktif = 4;

function geserTahap(btnElement, tahapSekarang, tahapTujuan) {
    const card = btnElement.closest('.order-card');
    const containerTujuan = document.getElementById(`container-${tahapTujuan}`);

    const emptyMsg = containerTujuan.querySelector('.empty-msg');
    if(emptyMsg) emptyMsg.remove();

    if (tahapTujuan === 'jahit') {
        btnElement.className = "btn-action w-full bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200 text-xs py-1.5 rounded font-semibold transition shadow-sm";
        btnElement.innerHTML = 'Geser ke QC &rarr;';
        btnElement.setAttribute('onclick', "geserTahap(this, 'jahit', 'qc')");
        card.className = "order-card bg-white p-3 rounded-md shadow-sm border-l-4 border-yellow-500 mb-2 transition-all duration-300";
    } 
    else if (tahapTujuan === 'qc') {
        btnElement.className = "btn-action w-full bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 text-xs py-1.5 rounded font-semibold transition shadow-sm";
        btnElement.innerHTML = 'Geser ke Packing &rarr;';
        btnElement.setAttribute('onclick', "geserTahap(this, 'qc', 'packing')");
        card.className = "order-card bg-white p-3 rounded-md shadow-sm border-l-4 border-red-500 mb-2 transition-all duration-300";
    } 
    else if (tahapTujuan === 'packing') {
        btnElement.className = "btn-action w-full bg-green-500 hover:bg-green-600 text-white text-xs py-1.5 rounded font-bold transition shadow-sm";
        btnElement.innerHTML = '<i class="fas fa-check"></i> Masuk Gudang';
        btnElement.setAttribute('onclick', "selesaiProduksi(this, 'packing')");
        card.className = "order-card bg-white p-3 rounded-md shadow-sm border-l-4 border-green-500 mb-2 transition-all duration-300";
    }

    containerTujuan.appendChild(card);

    updateCounter(tahapSekarang);
    updateCounter(tahapTujuan);
}

function selesaiProduksi(btnElement, tahapSekarang) {
    if(confirm("Apakah Anda yakin order ini sudah selesai dipacking dan masuk ke stok gudang?")) {
        const card = btnElement.closest('.order-card');
        card.remove(); 
        
        totalOrderAktif--;
        document.getElementById('dashboard-order-aktif').innerHTML = `${totalOrderAktif} <span class="text-xs font-normal">batch</span>`;
        
        updateCounter(tahapSekarang);
        alert('Order selesai dan berhasil dipindahkan ke stok gudang!');
    }
}

function updateCounter(tahap) {
    const container = document.getElementById(`container-${tahap}`);
    const cards = container.querySelectorAll('.order-card');
    const badge = document.getElementById(`badge-${tahap}`);
    badge.innerText = cards.length;

    if (cards.length === 0 && !container.querySelector('.empty-msg')) {
        container.innerHTML = `<p class="empty-msg text-xs text-center text-gray-400 py-6 italic border-2 border-dashed border-gray-200 rounded">Kosong</p>`;
    }
}

function tambahOrder() {
    alert('Simulasi: Form penambahan order baru akan muncul di sini.');
}

// --- 4. Logika Form Keuangan ---
let saldoSaatIni = 12500000; 

document.getElementById('form-keuangan').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const jenis = document.querySelector('input[name="jenis_uang"]:checked').value;
    const kategori = document.getElementById('kategori-keuangan').value;
    const tanggalInput = document.getElementById('tgl-keuangan').value;
    const jumlah = parseInt(document.getElementById('jumlah-keuangan').value);
    
    if(!jumlah || isNaN(jumlah)) return;

    const dateObj = new Date(tanggalInput);
    const namaBulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
    const tglFormatted = `${dateObj.getDate()} ${namaBulan[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    const formatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    
    let htmlNominal = "";
    if(jenis === "Pemasukan") {
        saldoSaatIni += jumlah;
        htmlNominal = `<td class="py-2.5 px-2 text-right text-green-600 font-bold">+ ${formatter.format(jumlah)}</td>`;
    } else {
        saldoSaatIni -= jumlah;
        htmlNominal = `<td class="py-2.5 px-2 text-right text-red-600 font-bold">- ${formatter.format(jumlah)}</td>`;
    }

    const newRow = document.createElement('tr');
    newRow.className = "border-b bg-yellow-50 transition-colors duration-1000";
    newRow.innerHTML = `
        <td class="py-2.5 px-2">${tglFormatted}</td>
        <td class="py-2.5 px-2 font-medium">${kategori}</td>
        ${htmlNominal}
    `;
    
    document.getElementById('tabel-keuangan').prepend(newRow);
    document.getElementById('total-saldo').innerText = formatter.format(saldoSaatIni);
    
    setTimeout(() => newRow.classList.remove('bg-yellow-50'), 1500);

    document.getElementById('jumlah-keuangan').value = "";
});
