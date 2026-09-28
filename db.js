// ============================================================
// db.js — Lapisan Database (Supabase + fallback Offline)
// ------------------------------------------------------------
// Semua operasi data aplikasi melewati modul ini, sehingga:
//   * Jika SUPABASE_CONFIG diisi & SDK tersedia -> pakai Supabase.
//   * Jika belum / offline -> otomatis fallback ke localStorage,
//     dan perubahan diantrekan (queue) untuk disinkronkan nanti.
// API yang dipakai app.js:
//   db.isRemote        -> boolean, mode aktif
//   db.loadAll()       -> memuat seluruh data awal (array tabel)
//   db.insert(table,row)      -> tambah baris
//   db.update(table,id,patch) -> ubah baris
//   db.delete(table,id)       -> hapus baris
//   db.subscribe(cb)   -> realtime: panggil cb saat data berubah
// ============================================================

const DB_TABLES = ["orders", "stock_movements", "finance_transactions", "app_settings"];
const SYNC_QUEUE_KEY = "konveksi_sync_queue_v1";

let _client = null;
let _mode = "offline";
let _channel = null;

// ---------- Deteksi & inisialisasi ----------
function isConfigValid(cfg) {
    return !!(cfg && cfg.url && cfg.anonKey &&
        /^https?:\/\//.test(cfg.url) &&
        !cfg.url.includes("YOUR-PROJECT") &&
        !cfg.anonKey.includes("YOUR-ANON"));
}

function initDB() {
    const cfg = window.SUPABASE_CONFIG;
    if (isConfigValid(cfg) && typeof window.supabase !== "undefined" && window.supabase.createClient) {
        try {
            _client = window.supabase.createClient(cfg.url, cfg.anonKey);
            _mode = "supabase";
            console.info("[db] Terhubung ke Supabase:", cfg.url);
        } catch (e) {
            console.warn("[db] Gagal membuat klien Supabase, pakai offline:", e);
            _client = null; _mode = "offline";
        }
    } else {
        console.info("[db] Mode OFFLINE (localStorage). Isi supabase-config.js untuk sinkronisasi cloud.");
    }
    return _mode;
}

function getDBClient() { return _client; }
function isRemote()   { return _mode === "supabase"; }

// ---------- Antrean sinkronisasi utk mode offline ----------
function enqueue(op) {
    try {
        const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]");
        q.push({ ...op, ts: Date.now() });
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q.slice(-200)));
    } catch (_) {}
}

async function flushQueue() {
    if (_mode !== "supabase") return 0;
    let q = [];
    try { q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]"); } catch (_) {}
    if (!q.length) return 0;

    const sisa = [];
    for (const op of q) {
        try {
            if (op.type === "insert") await _client.from(op.table).insert(op.row);
            else if (op.type === "update") await _client.from(op.table).update(op.patch).eq("id", op.id);
            else if (op.type === "delete") await _client.from(op.table).delete().eq("id", op.id);
        } catch (e) { sisa.push(op); }
    }
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(sisa));
    return q.length - sisa.length;
}

// ---------- CRUD seragam ----------
async function dbInsert(table, row) {
    if (_mode === "supabase") {
        const { data, error } = await _client.from(table).insert(row).select().single();
        if (error) { console.error(`[db] insert ${table}:`, error.message); enqueue({ type: "insert", table, row }); return null; }
        return data;
    }
    enqueue({ type: "insert", table, row });
    return { ...row, id: row.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "local-" + Date.now() + "-" + Math.random().toString(36).slice(2)), _local: true };
}

async function dbUpdate(table, id, patch) {
    if (_mode === "supabase") {
        const { data, error } = await _client.from(table).update(patch).eq("id", id).select().single();
        if (error) console.error(`[db] update ${table}:`, error.message);
        return data;
    }
    enqueue({ type: "update", table, id, patch });
    return { id, ...patch, _local: true };
}

async function dbDelete(table, id) {
    if (_mode === "supabase") {
        const { error } = await _client.from(table).delete().eq("id", id);
        if (error) console.error(`[db] delete ${table}:`, error.message);
        return !error;
    }
    enqueue({ type: "delete", table, id });
    return true;
}

async function dbSelect(table, orderCol = "created_at") {
    if (_mode === "supabase") {
        const { data, error } = await _client.from(table)
            .select("*").order(orderCol, { ascending: false }).limit(500);
        if (error) { console.error(`[db] select ${table}:`, error.message); return null; }
        return data || [];
    }
    return null; // pemanggil memakai cache lokal
}

// ---------- Muat seluruh data awal ----------
async function loadAll() {
    if (_mode !== "supabase") return null;
    const out = {};
    for (const t of DB_TABLES) {
        const rows = await dbSelect(t, t === "finance_transactions" ? "txn_date" : "created_at");
        if (rows === null) return null;   // gagal -> fallback lokal
        out[t] = rows;
    }
    // Sinkronkan antrean tertunda setelah koneksi berhasil
    const n = await flushQueue();
    if (n > 0) console.info(`[db] ${n} operasi tertunda berhasil disinkronkan.`);
    return out;
}

// ---------- Realtime subscription ----------
function subscribe(onChange) {
    if (_mode !== "supabase" || !_client.realtime) return;
    _channel = _client.channel("konveksi-live");
    DB_TABLES.forEach(t => {
        _channel.on("postgres_changes",
            { event: "*", schema: "public", table: t },
            payload => onChange(t, payload.eventType || payload.event, payload));
    });
    _channel.subscribe((status) => {
        const badge = document.getElementById("sync-status");
        if (badge) {
            if (status === "SUBSCRIBED") { badge.textContent = "● Live (Supabase)"; badge.className = "text-xs font-semibold text-emerald-600"; }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { badge.textContent = "● Offline"; badge.className = "text-xs font-semibold text-amber-600"; }
        }
    });
}

window.db = {
    initDB, getDBClient, isRemote,
    insert: dbInsert, update: dbUpdate, del: dbDelete, select: dbSelect,
    loadAll, subscribe, flushQueue, enqueue,
    get mode() { return _mode; },
};
