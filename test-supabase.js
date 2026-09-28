// Tes integrasi Supabase: mode offline (fallback) + mode remote (client palsu)
const { JSDOM } = require('jsdom');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('PASS:', msg); } else { fail++; console.log('FAIL:', msg); } };

async function jalankanTes(cfgSupabase, label, ops) {
    const html = fs.readFileSync('index.html', 'utf8')
        .replace(/<script src="https:[^"]*"><\/script>/g, '')   // buang CDN
        .replace(/<script defer src="[^"]*"><\/script>/g, '')
        .replace(/<script>\s*tailwind.config[\s\S]*?<\/script>/, '');
    const { VirtualConsole } = require('jsdom');
    const vc = new VirtualConsole(); // diamkan log jsdom
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/', virtualConsole: vc, storageQuota: 10_000_000 });
    const { window } = dom;
    // Isolasi antar skenario tes: bersihkan localStorage bawaan jsdom (per-origin)
    try { window.localStorage.clear(); } catch (_) {}
    window.confirm = () => true;
    window.alert = () => {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener(){}, addEventListener(){} }));
    window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
    window.navigator.vibrate = () => {};
    
    if (cfgSupabase) window.SUPABASE_CONFIG = cfgSupabase;

    // Mock supabase SDK bila diperlukan
    const calls = [];
    if (cfgSupabase) {
        window.supabase = {
            createClient: () => ({
                from: (table) => ({
                    select: (...a) => ({ order: () => ({ limit: async () => ({ data: (mockData[table] || []), error: null }) }) }),
                    insert: (row) => { calls.push(['insert', table, row]); return { select: () => ({ single: async () => ({ data: { ...row, id: 'srv-' + table + '-' + calls.length }, error: null }) }) }; },
                    update: (patch) => { calls.push(['update', table, patch]); return { eq: async () => ({ select: () => ({ single: async () => ({ data: { id: 'x', ...patch }, error: null }) }) }) }; },
                    delete: () => { calls.push(['delete', table]); return { eq: async () => ({ error: null }) }; },
                }),
                channel: () => ({ on: () => ({ subscribe: (cb) => cb && cb('SUBSCRIBED') }) }),
                auth: {},
            }),
        };
    }

    const mockData = {
        orders: [
            { id: 'db1', code: 'ORD-100', product_name: 'Hoodie (30 pcs)', qty: 30, stage: 'jahit', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
            { id: 'db2', code: 'ORD-101', product_name: 'Kemeja (10 pcs)', qty: 10, stage: 'selesai', created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
        ],
        stock_movements: [
            { id: 'm1', sku: 'BRG-JD-001', direction: 'masuk', category: 'barang_jadi', qty: 50, created_at: '2026-09-03T08:00:00Z' },
            { id: 'm2', sku: 'BRG-JD-001', direction: 'keluar', category: 'barang_jadi', qty: 20, created_at: '2026-09-04T08:00:00Z' },
        ],
        finance_transactions: [
            { id: 'f1', txn_date: '2026-09-05', category: 'Penjualan Tokopedia', amount: 1000000 },
            { id: 'f2', txn_date: '2026-09-06', category: 'Beli Kain', amount: -400000 },
        ],
        app_settings: [],
    };

    let code = ['supabase-config.js', 'db.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n;(function(){\n') + '\n})();'.repeat(2);
    // bungkus app.js juga dalam IIFE lalu expose state & fungsi penting ke window
    code = ['supabase-config.js', 'db.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n')
        + "\n;(function(){\n" + fs.readFileSync('app.js', 'utf8')
        + "\nwindow.__getState = () => state; window.__setState = (fn) => fn(state); window.tampilkanHasilSku = tampilkanHasilSku;\n})();";
    window.eval(code);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(r => setTimeout(r, 50));

    await ops(window, calls, label);
    dom.window.close();
}

(async () => {
    // ================= TES 1: MODE OFFLINE (config placeholder) =================
    await jalankanTes(null, 'offline', async (w, calls, label) => {
        const d = w.document;
        ok(w.db.mode === 'offline', label + ': db fallback ke offline dgn config placeholder');
        ok(d.getElementById('sync-status').textContent.includes('Offline'), label + ': badge status "Offline (lokal)"');

        // buat order baru -> tersimpan lokal & diantrekan utk sinkron nanti
        d.getElementById('order-nama').value = 'Kaos Polo';
        d.getElementById('order-jumlah').value = '12';
        d.getElementById('order-pekerja').value = 'bu-siti@konveksi.com';
        d.getElementById('form-order-baru').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
        await new Promise(r => setTimeout(r, 20));
        const st = JSON.parse(w.localStorage.getItem('konveksi_app_v2'));
        const card = st.orderKanban.potong.find(o => o.orderId === 'ORD-005');
        ok(!!card && card.nama === 'Kaos Polo (12 pcs)', label + ': ORD-005 dibuat di kanban potong');
        ok(card.assigned_to === 'bu-siti@konveksi.com', label + ': penugasan pekerja tersimpan di kartu');

        const q = JSON.parse(w.localStorage.getItem('konveksi_sync_queue_v1') || '[]');
        ok(q.some(op => op.type === 'insert' && op.table === 'orders' && op.row.code === 'ORD-005'), label + ': operasi offline diantrekan ke sync queue');

        // transaksi keuangan
        w.__setState(s => { s.saldo = 0; s.transaksiKeuangan = []; });
        d.querySelector('input[name="jenis_uang"][value="Pemasukan"]').checked = true;
        d.getElementById('kategori-keuangan').value = 'Penjualan Offline';
        d.getElementById('tgl-keuangan').value = '2026-09-28';
        d.getElementById('jumlah-keuangan').value = '750000';
        d.getElementById('form-keuangan').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
        await new Promise(r => setTimeout(r, 20));
        ok(w.__getState().saldo === 750000, label + ': saldo lokal bertambah setelah transaksi');
        const q2 = JSON.parse(w.localStorage.getItem('konveksi_sync_queue_v1'));
        ok(q2.some(op => op.table === 'finance_transactions' && Number(op.row.amount) === 750000), label + ': transaksi keuangan masuk antrean sinkron');
    });

    // ================= TES 2: MODE SUPABASE (client mock) =================
    const cfg = { url: 'https://demo-project.supabase.co', anonKey: 'eyJhbGciOi.test-key' };
    await jalankanTes(cfg, 'remote', async (w, calls, label) => {
        const d = w.document;
        ok(w.db.mode === 'supabase', label + ': db terdeteksi mode supabase dgn config valid');

        // Data cloud harus menggantikan state lokal
        ok(w.__getState().orderKanban.jahit.some(o => o.orderId === 'ORD-100' && o.dbId === 'db1'), label + ': order dari Supabase dimuat ke kanban (dengan dbId)');
        ok(!w.__getState().orderKanban.potong.concat(w.__getState().orderKanban.jahit, w.__getState().orderKanban.qc, w.__getState().orderKanban.packing).some(o => o.orderId === 'ORD-101'), label + ': order stage selesai tidak muncul di kanban');
        ok(w.__getState().stokBarangJadi === 30, label + ': stok barang jadi dihitung dari stock_movements cloud (50-20=30)');
        ok(w.__getState().saldo === 600000, label + ': saldo dihitung dari finance_transactions cloud (1jt-400rb)');
        ok(d.getElementById('dashboard-saldo').textContent.replace(/\D/g, '') === '600000', label + ': dashboard menampilkan saldo cloud');

        // Geser tahap -> UPDATE ke tabel orders via server id.
        // Catatan: kartu pertama dirender di luar viewport (jsdom tanpa layout),
        // jadi pilih tombol "Geser ke QC" secara spesifik.
        const btnQc = [...d.querySelectorAll('#container-jahit .btn-action')]
            .find(b => /qc/i.test(b.textContent));
        ok(!!btnQc, label + ': kartu hasil migrasi cloud dirender di kolom Jahit');
        btnQc.click();
        await new Promise(r => setTimeout(r, 30));
        ok(calls.some(c => c[0] === 'update' && c[1] === 'orders' && c[2].stage === 'qc'), label + ': geser tahap mengirim UPDATE stage ke Supabase');

        // Order baru -> INSERT ke orders dengan assigned_to
        d.getElementById('order-nama').value = 'Jaket';
        d.getElementById('order-jumlah').value = '8';
        d.getElementById('order-pekerja').value = 'pak-aji@konveksi.com';
        d.getElementById('form-order-baru').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
        await new Promise(r => setTimeout(r, 30));
        const ins = calls.find(c => c[0] === 'insert' && c[1] === 'orders');
        ok(ins && ins[2].code.startsWith('ORD-') && ins[2].qty === 8 && ins[2].assigned_to === 'pak-aji@konveksi.com', label + ': order baru di-INSERT ke Supabase lengkap dgn penugasan');

        // Scan stok manual -> INSERT stock_movements
        w.tampilkanHasilSku('SKU-CLOUD-9');
        d.getElementById('jenis-transaksi').value = 'MASUK_BARANGJADI';
        d.getElementById('jumlah-stok').value = '40';
        d.getElementById('btn-simpan-stok').click();
        await new Promise(r => setTimeout(r, 30));
        const mv = calls.find(c => c[0] === 'insert' && c[1] === 'stock_movements' && c[2].sku === 'SKU-CLOUD-9');
        ok(mv && mv[2].direction === 'masuk' && mv[2].category === 'barang_jadi' && mv[2].qty === 40, label + ': scan stok di-INSERT ke stock_movements');
        ok(w.__getState().stokBarangJadi === 70, label + ': stok bertambah lokal (30+40)');

        // Keuangan -> INSERT finance_transactions dgn txn_date ISO
        d.querySelector('input[name="jenis_uang"][value="Pengeluaran"]').checked = true;
        d.getElementById('kategori-keuangan').value = 'Listrik';
        d.getElementById('tgl-keuangan').value = '2026-09-28';
        d.getElementById('jumlah-keuangan').value = '150000';
        d.getElementById('form-keuangan').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
        await new Promise(r => setTimeout(r, 30));
        const ft = calls.find(c => c[0] === 'insert' && c[1] === 'finance_transactions');
        ok(ft && ft[2].txn_date === '2026-09-28' && Number(ft[2].amount) === -150000, label + ': pengeluaran di-INSERT dgn nominal negatif & tanggal ISO');
        ok(w.__getState().saldo === 450000, label + ': saldo lokal mengikuti (600rb-150rb)');
    });

    console.log(`\n=== HASIL: ${pass} PASS, ${fail} FAIL ===`);
    process.exit(fail ? 1 : 0);
})();
