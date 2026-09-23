ZULFA / SILIH-TERNAK — V2
===========================

ISI ZIP
-------
index.html   -> antarmuka utama
style.css    -> CSS
script.js    -> frontend + autentikasi + integrasi API
Code.gs      -> backend Google Apps Script dengan role admin/user
README.txt   -> panduan instalasi

PENYEMPURNAAN UTAMA
-------------------
1. Login server-side: user dan admin tidak lagi diverifikasi dari localStorage saat API aktif.
2. Session token dengan masa berlaku 8 jam.
3. Password di-hash SHA-256 + salt per akun.
4. Hak akses dicek di backend:
   - admin: kelola data, verifikasi, hapus, jadwal, akun admin/user.
   - user: login, melihat data, diskusi, balas diskusi, ganti password.
5. Bootstrap/data tidak lagi dibuka melalui GET publik.
6. Admin dapat membuat akun admin baru dari menu Pengaturan.
7. Registrasi publik membuat role user saja.
8. Ada fitur ganti password.
9. Perubahan database memakai LockService untuk mengurangi konflik saat banyak pengguna menyimpan data bersamaan.
10. AuditLogs mencatat aktivitas penting.
11. Frontend memakai Google Apps Script sebagai sumber utama ketika API_URL diisi.
12. Fallback CSV/localStorage tetap tersedia untuk preview, tetapi jangan dipakai sebagai mode produksi.

SETUP GOOGLE SHEET + APPS SCRIPT
--------------------------------
1. Buat Google Spreadsheet baru.
2. Extensions > Apps Script.
3. Paste Code.gs dari ZIP ini.
4. Ganti:
   const SPREADSHEET_ID = '1VH3kLmDCg5A3qlRyUDVp27m8euU6usXrzJt_sp8uAbY';
   dengan ID spreadsheet Anda.
5. Save.
6. Deploy > New deployment > Web app.
7. Execute as: Me.
8. Who has access: Anyone.
9. Copy URL yang berakhiran /exec.
10. Buka script.js dan isi:
    const API_URL = 'URL_WEB_APP_ANDA';
11. Upload ulang seluruh website.

LOGIN AWAL
----------
Saat pertama kali backend digunakan, sistem otomatis membuat:
username: admin
password: admin123

SEGERA setelah login:
- buka Pengaturan;
- gunakan "Keamanan Akun" untuk mengganti password admin;
- buat akun admin tambahan bila diperlukan.

CATATAN PENTING
---------------
- Jangan mengandalkan role yang hanya disembunyikan di HTML/JavaScript. V2 sudah melakukan pengecekan role di Code.gs.
- Untuk penggunaan nyata, sebaiknya batasi akses Spreadsheet hanya kepada pengelola yang berwenang.
- "Who has access: Anyone" pada Web App berarti URL endpoint dapat diakses publik, tetapi operasi aplikasi tetap membutuhkan session token.
- Jika API_URL kosong, aplikasi masuk mode preview/demo. Mode tersebut tidak cocok untuk produksi.

REKOMENDASI PENGEMBANGAN LANJUT
--------------------------------
Prioritas berikutnya:
A. Dashboard admin dengan statistik harian/bulanan dan grafik.
B. Manajemen akun user: daftar user, aktif/nonaktif, reset password.
C. Status proses permohonan: Diajukan -> Diverifikasi -> Disetujui -> Ditolak -> Selesai.
D. Nomor tiket/ID permohonan otomatis agar setiap pengajuan mudah dilacak.
E. Upload dokumen ke Google Drive, bukan menyimpan file besar di Sheet.
F. Notifikasi ketika status permohonan berubah.
G. Filter laporan berdasarkan tanggal, daerah, pelabuhan, perusahaan, dan status.
H. Export PDF/Excel/CSV.
I. Audit trail lengkap untuk semua perubahan.
J. Backup otomatis Google Sheet.


V3.1 - PERBAIKAN PROFIL & LOADING
---------------------------------
1. Menu "Profil Saya" tersedia untuk Admin dan User.
2. User dapat mengedit Nama Lengkap dan Nama Perusahaan/Instansi.
3. Username tetap readonly untuk menjaga identitas akun.
4. Endpoint updateProfile ditambahkan di Code.gs.
5. Loading overlay animasi muncul saat login, bootstrap, simpan, update, dan operasi API lainnya.
6. Data bootstrap terakhir di-cache di browser untuk menampilkan tampilan awal lebih cepat, lalu disegarkan dari server.
7. Startup tidak lagi melakukan bootstrap dua kali.
8. Pemanggilan loadThreads lokal dan bootstrap server ganda dihilangkan.
9. Cache dibatasi berdasarkan username dan dibersihkan saat logout.
10. Jangan lupa redeploy Code.gs setelah perubahan backend dan gunakan URL /exec terbaru.

BACKEND DISKUSI TERPISAH
------------------------
Mulai versi ini, Panel Diskusi Pelaku Usaha menggunakan backend dan Google Sheet terpisah.

FILE:
- Diskusi.gs -> backend khusus diskusi
- Code.gs -> backend utama tanpa tabel/fungsi Threads
- script.js -> memakai DISKUSI_API_URL untuk komunikasi diskusi

SETUP DATABASE DISKUSI:
1. Buat Google Spreadsheet baru, khusus Panel Diskusi.
2. Extensions > Apps Script.
3. Paste isi Diskusi.gs.
4. Ganti:
   const SPREADSHEET_DISKUSI_ID = 'ISI_ID_GOOGLE_SHEET_DISKUSI';
   dengan ID Spreadsheet Diskusi.
5. Pastikan SPREADSHEET_UTAMA_ID sama dengan ID spreadsheet utama pada Code.gs.
6. Deploy > New deployment > Web app.
7. Execute as: Me.
8. Who has access: Anyone.
9. Copy URL /exec.
10. Di script.js isi:
    const DISKUSI_API_URL = 'URL_WEB_APP_DISKUSI_ANDA';
11. Redeploy/update website.

SHEET YANG DIBUAT OTOMATIS DI DATABASE DISKUSI:
- Threads
- DiskusiLogs

Catatan:
Diskusi.gs hanya membaca Users dan Sessions dari database utama untuk validasi login.
Data Threads, balasan, dan log diskusi TIDAK disimpan di database utama.
Jadi database diskusi dapat dikelola/backup secara terpisah tanpa mencampur tabel utama.


PERBAIKAN DISKUSI v3
--------------------
Perbaikan utama:
- ID thread dari Apps Script sekarang didukung sebagai UUID/string.
- Warna avatar tidak lagi menghitung UUID sebagai angka.
- Tombol Balas/Hapus/Kirim Balasan aman menggunakan UUID.
- Render Panel Diskusi tidak lagi berhenti/error ketika membaca data dari Spreadsheet Diskusi.
- Database tetap terpisah melalui Diskusi.gs.
