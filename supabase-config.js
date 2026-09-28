// ============================================================
// Konfigurasi Supabase — Konveksi App
// ------------------------------------------------------------
// 1. Buat proyek di https://supabase.com (gratis).
// 2. Buka: Project Settings -> API, salin Project URL & anon public key.
// 3. Isi kedua nilai di bawah ini (atau set via variabel lingkungan
//    pada hosting, mis. Vercel/Netlify: SUPABASE_URL, SUPABASE_ANON_KEY).
// 4. Jalankan skema database di supabase-schema.sql pada
//    Supabase Dashboard -> SQL Editor (sekali saja).
//
// Jika dibiarkan kosong, aplikasi berjalan dalam MODE OFFLINE
// (data disimpan di localStorage) dan dapat disinkronkan nanti.
// ============================================================

window.SUPABASE_CONFIG = window.SUPABASE_CONFIG || {
    url: "https://YOUR-PROJECT.supabase.co",   // <-- ganti dengan Project URL
    anonKey: "YOUR-ANON-PUBLIC-KEY",           // <-- ganti dengan anon public key
};

// Optional: jika ingin memakai environment variables saat build/hosting
(function () {
    try {
        const envUrl = typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL;
        const envKey = typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY;
        if (envUrl) window.SUPABASE_CONFIG.url = envUrl;
        if (envKey) window.SUPABASE_CONFIG.anonKey = envKey;
    } catch (_) { /* abaikan di browser murni */ }
})();
