/* =========================================================
   ZULFA / SILIH-TERNAK - FRONTEND
   File: script.js
   Backend Google Apps Script:
   1. Buat Web App dari Code.gs
   2. Salin URL /exec ke API_URL di bawah
   3. Jika API_URL kosong, aplikasi tetap menggunakan
      Google Sheet CSV + localStorage seperti versi awal.
   ========================================================= */

const API_URL = 'https://script.google.com/macros/s/AKfycbx2wL-vcxTZXzIxenRixETEpdAxOfPxc64UDQD8Mdo0lwOHNXOY96IMCkiHmwHQ1QAJ8w/exec'; // Backend utama
const DISKUSI_API_URL = 'https://script.google.com/macros/s/AKfycbyhrD4Bg_n-iJS3tF00vyDbuXlT80u4GB8x72XDz4kLV_kxqUIcv0zbH0Xk-GKIM2cx/exec'; // Isi dengan URL /exec Apps Script khusus database diskusi
const USE_GOOGLE_APPS_SCRIPT = Boolean(API_URL);
const USE_DISKUSI_APPS_SCRIPT = Boolean(DISKUSI_API_URL);
const SESSION_KEY = 'silih_session';
const USER_KEY = 'silih_user';
const SESSION_TIMEOUT_FALLBACK_MS = 8 * 60 * 60 * 1000;

/* Utility backend siap pakai untuk tahap integrasi berikutnya. */
let __loadingCount = 0;
let __loadingTimer = null;

function setGlobalLoading(on, title = 'Memproses...', subtitle = 'Mohon tunggu sebentar') {
  const el = $('globalLoader');
  if (!el) return;
  if (on) {
    __loadingCount++;
    clearTimeout(__loadingTimer);
    el.classList.remove('hidden');
    $('globalLoaderTitle').textContent = title;
    $('globalLoaderSubtitle').textContent = subtitle;
    document.body.classList.add('async-loading');
  } else {
    __loadingCount = Math.max(0, __loadingCount - 1);
    if (__loadingCount === 0) {
      __loadingTimer = setTimeout(() => {
        el.classList.add('hidden');
        document.body.classList.remove('async-loading');
      }, 120);
    }
  }
}

async function diskusiRequest(action, payload = {}) {
  if (!USE_DISKUSI_APPS_SCRIPT) return null;
  const session = localStorage.getItem(SESSION_KEY) || '';
  const loadingMessages = {
    bootstrap: ['Memuat diskusi...', 'Mengambil percakapan dari database diskusi'],
    saveThread: ['Menyimpan diskusi...', 'Memproses pertanyaan Anda'],
    deleteThread: ['Menghapus diskusi...', 'Memproses perubahan database diskusi'],
    saveReply: ['Mengirim balasan...', 'Memproses balasan Anda'],
    deleteReply: ['Menghapus balasan...', 'Memproses perubahan database diskusi']
  };
  const msg = loadingMessages[action] || ['Memproses diskusi...', 'Mohon tunggu sebentar'];
  setGlobalLoading(true, msg[0], msg[1]);
  try {
    const response = await fetch(DISKUSI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: session, ...payload })
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (_) { throw new Error('Respons server diskusi tidak valid. Pastikan URL /exec benar.'); }
    if (!response.ok || result.ok === false) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  } finally {
    setGlobalLoading(false);
  }
}

async function apiRequest(action, payload = {}) {
  if (!USE_GOOGLE_APPS_SCRIPT) return null;
  const session = localStorage.getItem(SESSION_KEY) || '';
  const loadingMessages = {
    login: ['Memverifikasi akun...', 'Menghubungkan ke server keamanan'],
    register: ['Membuat akun...', 'Menyiapkan akun pengguna'],
    bootstrap: ['Memuat data...', 'Mengambil data terbaru dari server'],
    updateProfile: ['Menyimpan profil...', 'Memperbarui data diri Anda'],
    changePassword: ['Mengamankan akun...', 'Memperbarui password'],
    saveData: ['Menyimpan data...', 'Data sedang dikirim ke database'],
    deleteData: ['Menghapus data...', 'Memproses perubahan database'],
    setVerified: ['Memperbarui status...', 'Menyimpan perubahan'],
    saveThread: ['Menyimpan diskusi...', 'Memproses pesan Anda']
  };
  const msg = loadingMessages[action] || ['Memproses...', 'Mohon tunggu sebentar'];
  setGlobalLoading(true, msg[0], msg[1]);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: session, ...payload })
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (_) { throw new Error('Respons server tidak valid. Pastikan URL /exec benar.'); }
    if (!response.ok || result.ok === false) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  } finally {
    setGlobalLoading(false);
  }
}

/* ============== STATE & AUTH ============== */
const STATE = {
  raw: [],
  filtered: [],
  currentPage: 1,
  pageSize: 25,
  threadFilter: 'all',
  threads: [],
  charts: {},
  user: null
};

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTj9fD4wEmclrF78Y0H9fCeTXt10LQoiUByfukD-zdit4gyKgfmNwt6ccLiSNo1aA/pub?output=csv';

const ALLOWED_FIELDS = [
  'Timestamp',
  'Daerah Tujuan',
  'Jenis Permohonan',
  'Surat Permohonan',
  'Surat Izin',
  'Sertifikat Kesehatan Hewan KH 11',
  'Nama Perusahaan Pengirim',
  'Nama Pengirim',
  'Nama Perusahaan Penerima/Nama Penerima',
  'Jumlah ternak (ekor)',
  'Pelabuhan Muat',
  'Pelabuhan Tujuan'
];

const SHIPS = [
  { code: 'CN 1', name: 'Cahaya Nusantara I', capacity: 550, type: 'Kapal Pengangkut Sapi', status: 'Aktif', route: 'Kupang → Wini → Tanjung Priuk → Kupang', flag: 'Indonesia', lastMaintenance: 'Des 2025' },
  { code: 'CN 2', name: 'Cahaya Nusantara II', capacity: 550, type: 'Kapal Pengangkut Sapi', status: 'Aktif', route: 'Kupang → Wini → Samarinda → Kupang', flag: 'Indonesia', lastMaintenance: 'Des 2025' },
  { code: 'CN 3', name: 'Cahaya Nusantara III', capacity: 550, type: 'Kapal Pengangkut Sapi', status: 'Aktif', route: 'Kupang → Wini → Samarinda → Kupang', flag: 'Indonesia', lastMaintenance: 'Des 2025' },
  { code: 'CN 4', name: 'Cahaya Nusantara IV', capacity: 550, type: 'Kapal Pengangkut Sapi', status: 'Aktif', route: 'Bima → Sape → Tanjung Priuk → Bima', flag: 'Indonesia', lastMaintenance: 'Agust 2026' },
  { code: 'CN 5', name: 'Cahaya Nusantara V', capacity: 550, type: 'Kapal Pengangkut Sapi', status: 'Aktif', route: 'Kwandang → Tarakan → Balikpapan → Kupang → Banjarmasin → Kwandang', flag: 'Indonesia', lastMaintenance: 'Agu 2026' },
  { code: 'CN 6', name: 'Cahaya Nusantara VI', capacity: 550, type: 'Kapal Pengangkut Sapi', status: 'Aktif', route: 'Kupang → Wini → Banjarmasin → Kupang', flag: 'Indonesia', lastMaintenance: 'Des 2025' }
];

const SHIP_AVATAR_COLORS = [
  ['#f97316','#ea580c'], ['#0ea5e9','#0284c7'], ['#22c55e','#16a34a'],
  ['#8b5cf6','#7c3aed'], ['#eab308','#ca8a04'], ['#ef4444','#dc2626']
];

/* ============== UTILITIES ============== */
function $(id) { return document.getElementById(id); }
function normalize(str) { return String(str || '').trim().toLowerCase(); }

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showToast(title, msg, type = 'info') {
  const t = $('toast');
  t.className = 'toast show ' + type;
  $('toastTitle').textContent = title;
  $('toastMsg').textContent = msg;
  const icon = $('toastIcon');
  const icons = { success: 'check-circle-2', error: 'alert-circle', info: 'info' };
  icon.setAttribute('data-lucide', icons[type] || 'info');
  lucide.createIcons();
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast ' + type; }, 3800);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

/* ============== DATA MUTATIONS ============== */
function getMutations() {
  return JSON.parse(localStorage.getItem('silih_mutations') || '{"verified": [], "deleted": [], "edited": {}}');
}

function saveMutations(mut) {
  localStorage.setItem('silih_mutations', JSON.stringify(mut));
}

function getRowId(row) {
  return (row['Timestamp'] || '') + '|' + (row['Nama Perusahaan Pengirim'] || '') + '|' + (row['Surat Permohonan'] || '');
}

/* ============== AUTHENTICATION ============== */
function setSession(user, token) {
  STATE.user = user;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (token) localStorage.setItem(SESSION_KEY, token);
}

function clearSession() {
  STATE.user = null;
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('silih_bootstrap_cache');
}

async function initAuth() {
  const savedUser = localStorage.getItem(USER_KEY);
  const token = localStorage.getItem(SESSION_KEY);
  if (!savedUser || !token) return showLogin();
  try {
    STATE.user = JSON.parse(savedUser);
    showApp();
  } catch (err) {
    clearSession();
    showLogin();
  }
}
function switchAuthView(view) {
  const login = $('loginFormContainer');
  const register = $('registerFormContainer');
  if (!login || !register) return;

  if (view === 'register') {
    login.classList.add('hidden');
    register.classList.remove('hidden');
    $('registerError')?.classList.add('hidden');
    setTimeout(() => $('regNama')?.focus(), 50);
  } else {
    register.classList.add('hidden');
    login.classList.remove('hidden');
    $('loginError')?.classList.add('hidden');
    setTimeout(() => $('loginUsername')?.focus(), 50);
  }

  if (window.lucide) window.lucide.createIcons();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = $('loginUsername').value.trim();
  const p = $('loginPassword').value;
  $('loginError').classList.add('hidden');

  try {
    if (!USE_GOOGLE_APPS_SCRIPT) {
      // Mode demo hanya untuk preview. Untuk produksi, wajib gunakan backend GAS.
      if (u === 'admin' && p === 'admin123') {
        setSession({ username:'admin', nama:'Administrator', perusahaan:'Dinas Peternakan NTT', role:'admin' }, 'demo');
        showApp();
        showToast('Mode Demo', 'Hubungkan API Google Apps Script untuk keamanan produksi.', 'info');
        return;
      }
      throw new Error('API belum dikonfigurasi. Untuk demo gunakan admin / admin123.');
    }
    const result = await apiRequest('login', { username: u, password: p });
    setSession(result.user, result.token);
    showApp();
    showToast('Login Berhasil', `Selamat datang, ${result.user.nama}!`, 'success');
  } catch (err) {
    $('loginError').textContent = err.message || 'Username atau password salah.';
    $('loginError').classList.remove('hidden');
  }
});

$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nama = $('regNama').value.trim();
  const perusahaan = $('regPerusahaan').value.trim();
  const username = $('regUsername').value.trim();
  const password = $('regPassword').value;
  $('registerError').classList.add('hidden');

  try {
    if (!USE_GOOGLE_APPS_SCRIPT) throw new Error('API belum dikonfigurasi. Registrasi tersedia setelah Google Apps Script terhubung.');
    const result = await apiRequest('register', { nama, perusahaan, username, password });
    setSession(result.user, result.token);
    showApp();
    showToast('Registrasi Berhasil', `Selamat datang, ${nama}!`, 'success');
  } catch (err) {
    $('registerError').textContent = err.message;
    $('registerError').classList.remove('hidden');
  }
});

$('createAdminForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!USE_GOOGLE_APPS_SCRIPT) throw new Error('API belum dikonfigurasi.');
    const result = await apiRequest('createUser', {
      nama: $('adminNama').value.trim(),
      username: $('adminUsername').value.trim(),
      password: $('adminPassword').value,
      perusahaan: 'Administrator',
      role: 'admin'
    });
    showToast('Admin Dibuat', `Akun ${result.user.username} berhasil dibuat.`, 'success');
    $('createAdminForm').reset();
  } catch (err) {
    showToast('Gagal', err.message, 'error');
  }
});

$('changePasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('newPassword').value !== $('newPassword2').value) {
    showToast('Gagal', 'Konfirmasi password baru tidak sama.', 'error'); return;
  }
  try {
    await apiRequest('changePassword', {
      oldPassword: $('oldPassword').value,
      newPassword: $('newPassword').value
    });
    $('changePasswordForm').reset();
    showToast('Berhasil', 'Password berhasil diubah. Silakan login kembali.', 'success');
    setTimeout(() => { clearSession(); showLogin(); }, 900);
  } catch (err) { showToast('Gagal', err.message, 'error'); }
});


$('profileForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const result = await apiRequest('updateProfile', {
      nama: $('profileNama').value.trim(),
      perusahaan: $('profilePerusahaan').value.trim()
    });
    if (result.user) {
      setSession(result.user, localStorage.getItem(SESSION_KEY));
      applyRoleUI();
    }
    showToast('Profil Tersimpan', 'Data diri berhasil diperbarui.', 'success');
  } catch (err) {
    showToast('Gagal menyimpan profil', err.message, 'error');
  }
});

function logout() {
  clearSession();
  showLogin();
  showToast('Logout Berhasil', 'Sesi Anda telah ditutup.', 'info');
}

function showLogin() {
  $('loginOverlay').style.display = 'flex';
  $('mainApp').style.display = 'none';
}

function showApp() {
  $('loginOverlay').style.display = 'none';
  $('mainApp').style.display = 'flex';
  applyRoleUI();
  loadCSV();
  updateDate();
}

function applyRoleUI() {
  if (!STATE.user) return;
  const isAdmin = STATE.user.role === 'admin';
  $('userName').textContent = STATE.user.nama;
  $('userRole').textContent = STATE.user.perusahaan || (isAdmin ? 'Administrator' : 'Pelaku Usaha');
  $('userAvatar').textContent = STATE.user.nama.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  if ($('profileUsername')) $('profileUsername').value = STATE.user.username || '';
  if ($('profileNama')) $('profileNama').value = STATE.user.nama || '';
  if ($('profilePerusahaan')) $('profilePerusahaan').value = STATE.user.perusahaan || '';
  if ($('profileHeadingName')) $('profileHeadingName').textContent = STATE.user.nama || 'Profil Pengguna';
  if ($('profileHeadingRole')) $('profileHeadingRole').textContent = STATE.user.role === 'admin' ? 'Administrator' : (STATE.user.perusahaan || 'Pelaku Usaha');
  if ($('profileAvatarLarge')) $('profileAvatarLarge').textContent = (STATE.user.nama || 'U').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();

  if (isAdmin) {
    $('btnAddData').classList.remove('hidden');
    $('thAction').classList.remove('hidden');
    $('navSistemContainer').classList.remove('hidden');
  } else {
    $('btnAddData').classList.add('hidden');
    $('thAction').classList.add('hidden');
    $('navSistemContainer').classList.add('hidden');
  }
  renderTable();
  renderThreads();
}

/* ============== NAVIGATION ============== */
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $('page-' + page).classList.add('active');
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.sidebar-link[data-page="${page}"]`)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window.innerWidth < 1024) toggleSidebar(false);
  if (page === 'kapal') renderShipCards();
}

function toggleSidebar(force) {
  const sb = document.querySelector('.sidebar');
  const ov = document.querySelector('.sidebar-overlay');
  const open = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  ov.classList.toggle('show', open);
}

document.querySelectorAll('.sidebar-link[data-page]').forEach(link => {
  link.addEventListener('click', () => navigate(link.dataset.page));
});
document.querySelectorAll('.cn-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    navigate('kapal');
    setTimeout(() => {
      const card = document.querySelector(`[data-ship-card="${btn.dataset.ship}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.borderColor = 'var(--primary-2)';
        card.style.boxShadow = '0 12px 40px -10px rgba(249,115,22,0.4)';
        setTimeout(() => { card.style.borderColor = ''; card.style.boxShadow = ''; }, 2000);
      }
    }, 300);
  });
});

/* ============== CSV LOADING ============== */
async function loadCSV(showToastFlag = false) {
  if (showToastFlag) showToast('Memuat data', 'Menghubungkan ke sumber data...', 'info');

  if (USE_GOOGLE_APPS_SCRIPT && localStorage.getItem(SESSION_KEY)) {
    try {
      const cached = localStorage.getItem('silih_bootstrap_cache');
      if (cached) {
        try {
          const c = JSON.parse(cached);
          const cachedUser = c.user && c.user.username;
          if (cachedUser && STATE.user && cachedUser === STATE.user.username) {
          STATE.raw = (c.data || []).map(row => ({...row, _id: row.id || getRowId(row)}));
          STATE.filtered = [...STATE.raw];
          populateFilters(); renderAll(); updateLastUpdate();
          }
        } catch (_) {}
      }
      const result = await apiRequest('bootstrap');
      if (result.user) setSession(result.user, localStorage.getItem(SESSION_KEY));
      try { localStorage.setItem('silih_bootstrap_cache', JSON.stringify({user: result.user, data: result.data || [], savedAt: Date.now()})); } catch (_) {}
      const verifiedMap = {};
      (result.mutations || []).forEach(m => {
        if (m.type === 'verified') verifiedMap[m.rowId] = String(m.payload).includes('"value":true');
      });
      STATE.raw = (result.data || []).map(row => {
        const copy = { ...row };
        copy._id = row.id || getRowId(row);
        copy.isVerified = verifiedMap[copy._id] === true;
        return copy;
      });
      STATE.filtered = [...STATE.raw];
      populateFilters();
      renderAll();
      if (USE_DISKUSI_APPS_SCRIPT) {
        try {
          const diskusi = await diskusiRequest('bootstrap');
          STATE.threads = ((diskusi && diskusi.threads) || []).map(normalizeThread);
          try { localStorage.setItem('silih_diskusi_cache', JSON.stringify({user: result.user, threads: STATE.threads, savedAt: Date.now()})); } catch (_) {}
        } catch (e) {
          console.error('Diskusi:', e);
          const cachedDiskusi = localStorage.getItem('silih_diskusi_cache');
          if (cachedDiskusi) { try { STATE.threads = JSON.parse(cachedDiskusi).threads || []; } catch (_) { STATE.threads = []; } }
          showToast('Diskusi belum tersinkron', e.message, 'error');
        }
      } else {
        loadThreads();
      }
      renderThreads();
      updateLastUpdate();
      if (showToastFlag) showToast('Data tersinkron', `${STATE.raw.length} entri berhasil dimuat dari server.`, 'success');
      return;
    } catch (e) {
      console.error(e);
      if (/Sesi|token|login|Unauthorized|tidak valid/i.test(e.message)) {
        clearSession(); showLogin();
      }
      showToast('Sinkronisasi gagal', e.message, 'error');
      return;
    }
  }

  // Fallback preview/legacy CSV.
  Papa.parse(CSV_URL, {
    download: true, header: true, skipEmptyLines: true,
    complete: function(results) {
      try {
        const sheetData = results.data.map(row => {
          const obj = {};
          ALLOWED_FIELDS.forEach(f => {
            const key = Object.keys(row).find(k => normalize(k) === normalize(f));
            obj[f] = key ? row[key] : '';
          });
          return obj;
        }).filter(r => r['Timestamp'] || r['Surat Permohonan'] || r['Nama Perusahaan Pengirim']);
        const localData = JSON.parse(localStorage.getItem('silih_manual_data') || '[]');
        let combinedData = [...localData, ...sheetData];
        const mut = getMutations();
        STATE.raw = combinedData.map(row => {
          row._id = getRowId(row);
          if (mut.edited[row._id]) Object.assign(row, mut.edited[row._id]);
          row.isVerified = mut.verified.includes(row._id);
          return row;
        }).filter(row => !mut.deleted.includes(row._id));
        STATE.filtered = [...STATE.raw];
        populateFilters(); renderAll(); updateLastUpdate();
      } catch (e) {
        showToast('Gagal memproses', 'Terjadi kesalahan saat memproses data.', 'error');
      }
    },
    error: function() { showToast('Gagal memuat', 'Tidak dapat terhubung ke sumber data.', 'error'); }
  });
}

function updateLastUpdate() {
  const now = new Date();
  const txt = now.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('lastUpdateBadge').textContent = 'Update: ' + txt;
}

function populateFilters() {
  const daerah = [...new Set(STATE.raw.map(r => r['Daerah Tujuan']).filter(Boolean))].sort();
  const muat = [...new Set(STATE.raw.map(r => r['Pelabuhan Muat']).filter(Boolean))].sort();
  const tujuan = [...new Set(STATE.raw.map(r => r['Pelabuhan Tujuan']).filter(Boolean))].sort();
  
  const fillSelect = (id, arr) => {
    const el = $(id);
    const val = el.value;
    el.innerHTML = '<option value="">Semua</option>' + arr.map(v => `<option value="${v}">${v}</option>`).join('');
    el.value = val;
  };
  fillSelect('filterDaerah', daerah);
  fillSelect('filterMuat', muat);
  fillSelect('filterTujuan', tujuan);
}

/* ============== RENDER DASHBOARD ============== */
function renderAll() {
  renderStats();
  renderRecent();
  renderTable();
  renderShipCards();
  renderThreads();
  if (Object.keys(STATE.charts).length) destroyCharts();
  renderCharts();
  $('navDataCount').textContent = STATE.raw.length;
}

function renderStats() {
  const total = STATE.raw.length;
  const ternak = STATE.raw.reduce((sum, r) => {
    const num = parseInt(String(r['Jumlah ternak (ekor)']).replace(/\D/g, '')) || 0;
    return sum + num;
  }, 0);
  const daerah = new Set(STATE.raw.map(r => r['Daerah Tujuan']).filter(Boolean)).size;
  
  animateCounter('statTotal', total);
  animateCounter('statTernak', ternak);
  animateCounter('statDaerah', daerah);
}

function animateCounter(id, target) {
  const el = $(id);
  const duration = 1000;
  const start = parseInt(el.textContent.replace(/\D/g, '')) || 0;
  const startTime = performance.now();
  function step(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * ease).toLocaleString('id-ID');
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderRecent() {
  const recent = [...STATE.raw].slice(0, 5);
  if (!recent.length) {
    $('recentTableBody').innerHTML = `<tr><td colspan="4" class="text-center py-6" style="color: var(--muted);">Belum ada data</td></tr>`;
    return;
  }
  $('recentTableBody').innerHTML = recent.map(r => `
    <tr>
      <td class="font-mono text-xs">${formatDate(r['Timestamp'])}</td>
      <td>
        <p class="font-semibold text-xs">${escapeHtml(r['Nama Perusahaan Pengirim'] || '—')}</p>
        <p class="text-[11px]" style="color: var(--muted);">${escapeHtml(r['Nama Pengirim'] || '')}</p>
      </td>
      <td><span class="badge badge-violet">${escapeHtml(r['Daerah Tujuan'] || '—')}</span></td>
      <td class="text-right font-mono font-semibold" style="color: var(--primary);">${parseInt(String(r['Jumlah ternak (ekor)']).replace(/\D/g, '') || 0).toLocaleString('id-ID')}</td>
    </tr>
  `).join('');
}

/* ============== TABLE ============== */
function renderTable() {
  const search = normalize($('tableSearch').value);
  const fDaerah = $('filterDaerah').value;
  const fMuat = $('filterMuat').value;
  const fTujuan = $('filterTujuan').value;
  const isAdmin = STATE.user && STATE.user.role === 'admin';
  
  let data = STATE.raw.filter(r => {
    if (fDaerah && r['Daerah Tujuan'] !== fDaerah) return false;
    if (fMuat && r['Pelabuhan Muat'] !== fMuat) return false;
    if (fTujuan && r['Pelabuhan Tujuan'] !== fTujuan) return false;
    if (search) {
      const haystack = normalize(Object.values(r).join(' '));
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  
  STATE.filtered = data;
  STATE.pageSize = parseInt($('pageSize').value);
  const totalPages = Math.max(1, Math.ceil(data.length / STATE.pageSize));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  
  const start = (STATE.currentPage - 1) * STATE.pageSize;
  const pageData = data.slice(start, start + STATE.pageSize);
  
  $('tableInfo').textContent = `${data.length} entri`;
  $('paginationInfo').textContent = `Menampilkan ${pageData.length ? start + 1 : 0}–${start + pageData.length} dari ${data.length} entri`;
  
  if (!pageData.length) {
    $('dataTableBody').innerHTML = `<tr><td colspan="14" class="text-center py-12" style="color: var(--muted);">
      <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2"></i>Tidak ada data yang sesuai dengan filter
    </td></tr>`;
    lucide.createIcons();
  } else {
    $('dataTableBody').innerHTML = pageData.map((r) => {
      const verified = r.isVerified;
      const statusBadge = verified ? 
        `<span class="badge badge-success"><i data-lucide="check-circle" class="w-3 h-3"></i> Terverifikasi</span>` : 
        `<span class="badge badge-danger"><i data-lucide="alert-circle" class="w-3 h-3"></i> Belum Lengkap</span>`;
      
      const actionBtn = isAdmin ? `
        <div class="flex gap-1">
          <button onclick="toggleVerify('${r._id}')" class="text-[11px] font-semibold px-2 py-1 rounded-md" style="background: ${verified ? '#fee2e2' : '#dcfce7'}; color: ${verified ? 'var(--danger)' : 'var(--success)'};">
            ${verified ? 'Batal' : 'Verifikasi'}
          </button>
          <button onclick="openModal('edit','${r._id}')" class="text-[11px] font-semibold px-2 py-1 rounded-md btn-edit">
            <i data-lucide="edit" class="w-3 h-3"></i>
          </button>
          <button onclick="deleteData('${r._id}')" class="text-[11px] font-semibold px-2 py-1 rounded-md btn-danger">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>` : '';
      
      return `
      <tr>
        <td class="font-mono text-xs whitespace-nowrap">${formatDate(r['Timestamp'])}</td>
        <td><span class="badge badge-violet">${escapeHtml(r['Daerah Tujuan'] || '—')}</span></td>
        <td class="text-xs">${escapeHtml(r['Jenis Permohonan'] || '—')}</td>
        <td class="font-mono text-xs">${escapeHtml(r['Surat Permohonan'] || '—')}</td>
        <td class="font-mono text-xs">${escapeHtml(r['Surat Izin'] || '—')}</td>
        <td class="font-mono text-xs">${escapeHtml(r['Sertifikat Kesehatan Hewan KH 11'] || '—')}</td>
        <td><p class="font-semibold text-xs">${escapeHtml(r['Nama Perusahaan Pengirim'] || '—')}</p></td>
        <td class="text-xs">${escapeHtml(r['Nama Pengirim'] || '—')}</td>
        <td class="text-xs">${escapeHtml(r['Nama Perusahaan Penerima/Nama Penerima'] || '—')}</td>
        <td class="text-right font-mono font-bold" style="color: var(--primary);">${parseInt(String(r['Jumlah ternak (ekor)']).replace(/\D/g, '') || 0).toLocaleString('id-ID')}</td>
        <td><span class="badge badge-muted">${escapeHtml(r['Pelabuhan Muat'] || '—')}</span></td>
        <td><span class="badge badge-primary">${escapeHtml(r['Pelabuhan Tujuan'] || '—')}</span></td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      </tr>`;
    }).join('');
  }
  
  const ctrl = $('paginationControls');
  let html = '';
  const addBtn = (label, page, disabled, active) => {
    html += `<button onclick="goToPage(${page})" ${disabled ? 'disabled' : ''} class="px-3 py-1.5 rounded-md text-xs font-semibold transition ${active ? '' : 'hover:bg-orange-50'}" style="${active ? 'background: var(--primary); color: #ffffff;' : 'color: var(--muted);' + (disabled ? ' opacity: 0.4; cursor: not-allowed;' : '')}">${label}</button>`;
  };
  addBtn('<i data-lucide="chevron-left" class="w-3 h-3"></i>', STATE.currentPage - 1, STATE.currentPage === 1, false);
  
  const maxButtons = 5;
  let startPage = Math.max(1, STATE.currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);
  
  if (startPage > 1) { addBtn('1', 1, false, false); if (startPage > 2) html += `<span class="px-1 text-xs" style="color: var(--muted);">...</span>`; }
  for (let i = startPage; i <= endPage; i++) addBtn(i, i, false, i === STATE.currentPage);
  if (endPage < totalPages) { if (endPage < totalPages - 1) html += `<span class="px-1 text-xs" style="color: var(--muted);">...</span>`; addBtn(totalPages, totalPages, false, false); }
  
  addBtn('<i data-lucide="chevron-right" class="w-3 h-3"></i>', STATE.currentPage + 1, STATE.currentPage === totalPages, false);
  ctrl.innerHTML = html;
  lucide.createIcons();
}

async function toggleVerify(id) {
  const row = STATE.raw.find(r => r._id === id);
  const next = !(row && row.isVerified);
  if (USE_GOOGLE_APPS_SCRIPT) {
    try {
      await apiRequest('setVerified', { id, value: next });
      if (row) row.isVerified = next;
      renderTable();
      showToast('Status Diperbarui', next ? 'Data berhasil diverifikasi.' : 'Verifikasi dibatalkan.', 'success');
      return;
    } catch (e) { showToast('Gagal', e.message, 'error'); return; }
  }
  const mut = getMutations();
  if (next) mut.verified.push(id); else mut.verified = mut.verified.filter(v => v !== id);
  saveMutations(mut);
  if (row) row.isVerified = next;
  renderTable();
}

async function deleteData(id) {
  if (!confirm('Hapus data ini secara permanen?')) return;
  if (USE_GOOGLE_APPS_SCRIPT) {
    try {
      await apiRequest('deleteData', { id });
      STATE.raw = STATE.raw.filter(r => r._id !== id);
      STATE.filtered = [...STATE.raw];
      populateFilters(); renderAll();
      showToast('Data Dihapus', 'Data berhasil dihapus dari database.', 'success');
      return;
    } catch (e) { showToast('Gagal menghapus', e.message, 'error'); return; }
  }
  const mut = getMutations();
  if (!mut.deleted.includes(id)) mut.deleted.push(id);
  saveMutations(mut);
  let localData = JSON.parse(localStorage.getItem('silih_manual_data') || '[]');
  localData = localData.filter(r => getRowId(r) !== id);
  localStorage.setItem('silih_manual_data', JSON.stringify(localData));
  STATE.raw = STATE.raw.filter(r => r._id !== id);
  STATE.filtered = [...STATE.raw]; populateFilters(); renderAll();
  showToast('Data Dihapus', 'Data berhasil dihapus dari sistem.', 'success');
}

function goToPage(p) {
  STATE.currentPage = p;
  renderTable();
}

function handleGlobalSearch(val) {
  if ($('page-data').classList.contains('active')) {
    $('tableSearch').value = val;
    renderTable();
  } else if (val) {
    navigate('data');
    $('tableSearch').value = val;
    renderTable();
  }
}

/* ============== ADD/EDIT MODAL ============== */
function openModal(mode, id = null) {
  const modal = $('dataModal');
  const title = $('modalTitle');
  const icon = $('modalIcon');
  const submitBtn = $('modalSubmitBtn');
  const form = $('dataForm');

  form.reset();

  if (mode === 'edit') {
    title.textContent = 'Edit Data Pengiriman';
    icon.setAttribute('data-lucide', 'edit');
    submitBtn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Update Data';
    
    const row = STATE.raw.find(r => r._id === id);
    if (row) {
      $('editId').value = id;
      $('fTimestamp').value = new Date(row['Timestamp']).toISOString().slice(0, 16);
      $('fDaerah').value = row['Daerah Tujuan'] || '';
      $('fJenis').value = row['Jenis Permohonan'] || '';
      $('fSuratPermohonan').value = row['Surat Permohonan'] || '';
      $('fSuratIzin').value = row['Surat Izin'] || '';
      $('fKH11').value = row['Sertifikat Kesehatan Hewan KH 11'] || '';
      $('fPengirim').value = row['Nama Perusahaan Pengirim'] || '';
      $('fNamaPengirim').value = row['Nama Pengirim'] || '';
      $('fPenerima').value = row['Nama Perusahaan Penerima/Nama Penerima'] || '';
      $('fJumlah').value = parseInt(String(row['Jumlah ternak (ekor)']).replace(/\D/g, '')) || 0;
      $('fMuat').value = row['Pelabuhan Muat'] || '';
      $('fTujuan').value = row['Pelabuhan Tujuan'] || '';
    }
  } else {
    title.textContent = 'Tambah Data Pengiriman Baru';
    icon.setAttribute('data-lucide', 'plus-circle');
    submitBtn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Simpan Data';
    $('editId').value = '';
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    $('fTimestamp').value = now.toISOString().slice(0, 16);
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeModal() {
  $('dataModal').classList.add('hidden');
}

 $('dataForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('editId').value;
  const formData = {
    id: id || undefined,
    'Timestamp': $('fTimestamp').value,
    'Daerah Tujuan': $('fDaerah').value,
    'Jenis Permohonan': $('fJenis').value,
    'Surat Permohonan': $('fSuratPermohonan').value,
    'Surat Izin': $('fSuratIzin').value,
    'Sertifikat Kesehatan Hewan KH 11': $('fKH11').value,
    'Nama Perusahaan Pengirim': $('fPengirim').value,
    'Nama Pengirim': $('fNamaPengirim').value,
    'Nama Perusahaan Penerima/Nama Penerima': $('fPenerima').value,
    'Jumlah ternak (ekor)': $('fJumlah').value,
    'Pelabuhan Muat': $('fMuat').value,
    'Pelabuhan Tujuan': $('fTujuan').value
  };

  try {
    if (USE_GOOGLE_APPS_SCRIPT) {
      const result = await apiRequest('saveData', { data: formData });
      showToast(id ? 'Data Diperbarui' : 'Data Ditambahkan', 'Data berhasil disimpan ke Google Sheet.', 'success');
    } else {
      const localData = JSON.parse(localStorage.getItem('silih_manual_data') || '[]');
      if (id) {
        const idx = localData.findIndex(r => getRowId(r) === id);
        if (idx >= 0) localData[idx] = formData;
      } else localData.push(formData);
      localStorage.setItem('silih_manual_data', JSON.stringify(localData));
      showToast(id ? 'Data Diperbarui' : 'Data Ditambahkan', 'Data tersimpan pada mode lokal.', 'success');
    }
    closeModal();
    loadCSV();
  } catch (err) { showToast('Gagal menyimpan', err.message, 'error'); }
});


/* ============== SHIP CARDS & JADWAL ============== */
function getShipSchedules() {
  return JSON.parse(localStorage.getItem('silih_jadwal') || '{}');
}

function saveShipSchedules(data) {
  localStorage.setItem('silih_jadwal', JSON.stringify(data));
}

function renderShipCards() {
  const schedules = getShipSchedules();
  const isAdmin = STATE.user && STATE.user.role === 'admin';
  
  $('shipCardsGrid').innerHTML = SHIPS.map((s, i) => {
    const c = SHIP_AVATAR_COLORS[i];
    const statusBadge = s.status === 'Aktif' ? 'badge-success' : 'badge-warning';
    const jadwal = schedules[s.code] || 'Belum ada jadwal';
    
    return `
    <div class="ship-card" data-ship-card="${s.code}">
      <div class="ship-banner p-5 pb-4">
        <div class="flex items-start justify-between relative z-10">
          <div class="flex items-center gap-3">
            <div class="avatar" style="background: linear-gradient(135deg, ${c[0]}, ${c[1]}); width: 44px; height: 44px; font-size: 14px;">${s.code.split(' ')[1]}</div>
            <div>
              <h3 class="font-display text-base font-bold">${s.code}</h3>
              <p class="text-[11px]" style="color: var(--muted);">${s.name}</p>
            </div>
          </div>
          <span class="badge ${statusBadge}"><span class="pulse-dot" style="width:6px;height:6px;"></span> ${s.status}</span>
        </div>
        <div class="mt-3 flex items-center gap-2 text-[11px] relative z-10" style="color: var(--muted);">
          <i data-lucide="route" class="w-3.5 h-3.5"></i> ${s.route}
        </div>
      </div>
      <div class="p-5">
        <div class="p-2.5 rounded-lg mb-4" style="background: var(--surface-2);">
          <p class="text-[10px] uppercase tracking-wider" style="color: var(--muted);">Kapasitas</p>
          <p class="font-display font-bold text-lg" style="color: ${c[0]};">${s.capacity} <span class="text-[10px] font-normal" style="color: var(--muted-2);">ekor</span></p>
        </div>
        
        <div class="mt-4 p-3 rounded-lg" style="background: #fff7ed; border: 1px dashed var(--border);">
          <div class="flex items-center justify-between mb-1">
            <p class="text-[10px] uppercase tracking-wider font-semibold" style="color: var(--primary);">
              <i data-lucide="calendar-clock" class="w-3 h-3 inline-block mr-1"></i> Jadwal Keberangkatan
            </p>
            ${isAdmin ? `<button onclick="openJadwalModal('${s.code}')" class="text-[10px] font-semibold flex items-center gap-1" style="color: var(--accent);">
              <i data-lucide="edit-3" class="w-3 h-3"></i> Edit
            </button>` : ''}
          </div>
          <p class="text-xs font-medium" style="color: var(--text);">${escapeHtml(jadwal)}</p>
        </div>

        <div class="space-y-2 text-xs mt-4">
          <div class="flex justify-between py-1.5 border-b" style="border-color: var(--border-soft);">
            <span style="color: var(--muted);">Tipe Kapal</span>
            <span class="font-medium text-right">${s.type}</span>
          </div>
          <div class="flex justify-between py-1.5 border-b" style="border-color: var(--border-soft);">
            <span style="color: var(--muted);">Bendera</span>
            <span class="font-medium">${s.flag}</span>
          </div>
          <div class="flex justify-between py-1.5">
            <span style="color: var(--muted);">Maintenance Terakhir</span>
            <span class="font-medium">${s.lastMaintenance}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  lucide.createIcons();
}

let currentEditShipCode = null;
function openJadwalModal(shipCode) {
  currentEditShipCode = shipCode;
  const schedules = getShipSchedules();
  $('jadwalShipName').textContent = `Kapal: ${shipCode}`;
  $('jadwalInput').value = schedules[shipCode] || '';
  $('jadwalModal').classList.remove('hidden');
  lucide.createIcons();
}

function closeJadwalModal() {
  $('jadwalModal').classList.add('hidden');
}

function saveJadwal() {
  if (!currentEditShipCode) return;
  const val = $('jadwalInput').value.trim();
  const schedules = getShipSchedules();
  schedules[currentEditShipCode] = val;
  saveShipSchedules(schedules);
  closeJadwalModal();
  renderShipCards();
  showToast('Jadwal Diperbarui', `Jadwal ${currentEditShipCode} berhasil disimpan.`, 'success');
}

/* ============== DISCUSSION ============== */
function loadThreads() {
  const saved = localStorage.getItem('silih_threads');
  if (saved) {
    STATE.threads = JSON.parse(saved);
  } else {
    STATE.threads = [
      { id: Date.now() - 86400000, nama: 'Hendra Wijaya', perusahaan: 'PT Sumber Makmur Ternak', kategori: 'Perizinan', pesan: 'Mohon informasi prosedur perpanjangan surat izin pengiriman ternak antar pulau. Apakah bisa diajukan secara online melalui sistem ini?', timestamp: new Date(Date.now() - 86400000).toISOString(), replies: [{ nama: 'Admin SILIH-TERNAK', pesan: 'Untuk perpanjangan surat izin, saat ini masih melalui kantor dinas. Sistem online akan tersedia segera.', timestamp: new Date(Date.now() - 80000000).toISOString() }] },
      { id: Date.now() - 172800000, nama: 'Siti Aminah', perusahaan: 'CV Berkah Peternakan', kategori: 'Teknis', pesan: 'Berapa kapasitas maksimal muatan CN 4 untuk pengiriman sapi? Apakah ada standar kandang khusus selama perjalanan?', timestamp: new Date(Date.now() - 172800000).toISOString(), replies: [] },
      { id: Date.now() - 259200000, nama: 'Bambang Sutrisno', perusahaan: 'PT Nusantara Livestock', kategori: 'Pelabuhan', pesan: 'Apakah ada jadwal keberangkatan tetap kapal CN 1 rute Kupang - Surabaya setiap bulannya?', timestamp: new Date(Date.now() - 259200000).toISOString(), replies: [{ nama: 'Operator CN 1', pesan: 'Jadwal keberangkatan CN 1 setiap tanggal 5, 15, dan 25. Mohon konfirmasi minimal H-3 sebelum keberangkatan.', timestamp: new Date(Date.now() - 230000000).toISOString() }] }
    ];
    saveThreads();
  }
}

function saveThreads() { localStorage.setItem('silih_threads', JSON.stringify(STATE.threads)); }

function normalizeThread(t) {
  if (!t) return t;
  let replies = t.replies;
  if (typeof replies === 'string') { try { replies = JSON.parse(replies); } catch (_) { replies = []; } }
  if (!Array.isArray(replies)) replies = [];
  return {
    ...t,
    id: t.id || Date.now(),
    nama: t.nama || t.author || 'Pengguna',
    perusahaan: t.perusahaan || '',
    kategori: t.kategori || 'Umum',
    pesan: t.pesan || t.title || '',
    timestamp: t.timestamp || t.createdAt || new Date().toISOString(),
    replies
  };
}

function renderThreads() {
  const normalizedThreads = STATE.threads.map(normalizeThread);
  STATE.threads = normalizedThreads;
  const filtered = STATE.threadFilter === 'all' ? normalizedThreads : normalizedThreads.filter(t => t.kategori === STATE.threadFilter);
  $('threadCount').textContent = filtered.length;
  $('navDiskusiCount').textContent = STATE.threads.length;
  
  const isAdmin = STATE.user && STATE.user.role === 'admin';
  
  if (!filtered.length) {
    $('threadList').innerHTML = `
      <div class="card p-8 text-center">
        <i data-lucide="message-square-off" class="w-10 h-10 mx-auto mb-3" style="color: var(--muted-2);"></i>
        <p class="text-sm font-semibold mb-1">Belum ada diskusi</p>
        <p class="text-xs" style="color: var(--muted);">Jadilah yang pertama mengajukan pertanyaan</p>
      </div>`;
    lucide.createIcons();
    return;
  }
  
  const kategoriColors = { 'Umum': 'badge-primary', 'Perizinan': 'badge-accent', 'Teknis': 'badge-violet', 'Pelabuhan': 'badge-success', 'Ternak': 'badge-warning' };
  
  $('threadList').innerHTML = filtered.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(t => {
    const initials = t.nama.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
    // ID diskusi dari Apps Script berupa UUID/string, bukan angka.
    // Gunakan hash sederhana agar warna avatar tetap konsisten.
    const idText = String(t.id || '');
    let colorHash = 0;
    for (let i = 0; i < idText.length; i++) {
      colorHash = ((colorHash << 5) - colorHash) + idText.charCodeAt(i);
      colorHash |= 0;
    }
    const colorIdx = Math.abs(colorHash) % SHIP_AVATAR_COLORS.length;
    const c = SHIP_AVATAR_COLORS[colorIdx];
    return `
    <div class="thread-item p-4">
      <div class="flex items-start gap-3">
        <div class="avatar" style="background: linear-gradient(135deg, ${c[0]}, ${c[1]});">${initials}</div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2 mb-1">
            <p class="font-semibold text-sm">${escapeHtml(t.nama)}</p>
            ${t.perusahaan ? `<span class="text-[11px]" style="color: var(--muted);">• ${escapeHtml(t.perusahaan)}</span>` : ''}
            <span class="badge ${kategoriColors[t.kategori] || 'badge-muted'} ml-auto">${t.kategori}</span>
          </div>
          <p class="text-xs mb-2" style="color: var(--muted-2);">${formatDate(t.timestamp)}</p>
          <p class="text-sm leading-relaxed mb-3">${escapeHtml(t.pesan)}</p>
          
          ${t.replies && t.replies.length ? `
            <div class="ml-2 pl-4 space-y-2" style="border-left: 2px solid var(--border);">
              ${t.replies.map((r, rIdx) => `
                <div class="flex items-start gap-2">
                  <div class="avatar" style="background: var(--surface-2); color: var(--primary); width: 28px; height: 28px; font-size: 11px;">${r.nama[0]}</div>
                  <div class="flex-1">
                    <div class="flex items-center gap-2 mb-0.5">
                      <p class="font-semibold text-xs">${escapeHtml(r.nama)}</p>
                      <span class="badge badge-primary text-[9px]">Admin</span>
                      ${isAdmin ? `<button class="ml-auto text-[10px] font-semibold" style="color: var(--danger);" onclick='deleteReply(${JSON.stringify(String(t.id))}, ${rIdx})' title="Hapus Balasan"><i data-lucide="trash-2" class="w-3 h-3"></i></button>` : ''}
                    </div>
                    <p class="text-[11px] mb-1" style="color: var(--muted-2);">${formatDate(r.timestamp)}</p>
                    <p class="text-xs leading-relaxed">${escapeHtml(r.pesan)}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          <div class="flex items-center gap-3 mt-3 pt-3" style="border-top: 1px solid var(--border-soft);">
            ${isAdmin ? `
              <button class="text-[11px] font-semibold flex items-center gap-1.5" style="color: var(--primary);" onclick='toggleReply(${JSON.stringify(String(t.id))})'>
                <i data-lucide="reply" class="w-3.5 h-3.5"></i> Balas
              </button>
              <button class="text-[11px] font-semibold flex items-center gap-1.5" style="color: var(--danger);" onclick='deleteThread(${JSON.stringify(String(t.id))})'>
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Hapus
              </button>
            ` : ''}
            <button class="text-[11px] font-semibold flex items-center gap-1.5" style="color: var(--muted);">
              <i data-lucide="thumbs-up" class="w-3.5 h-3.5"></i> Bermanfaat
            </button>
          </div>
          
          <div id="reply-form-${escapeHtml(String(t.id))}" class="hidden mt-3">
            <textarea id="reply-text-${escapeHtml(String(t.id))}" rows="2" placeholder="Tulis balasan sebagai Admin..." class="input-field w-full px-3 py-2 rounded-lg text-xs resize-none"></textarea>
            <div class="flex gap-2 mt-2">
              <button onclick='submitReply(${JSON.stringify(String(t.id))})' class="btn-primary px-3 py-1.5 rounded-md text-xs">Kirim Balasan</button>
              <button onclick='toggleReply(${JSON.stringify(String(t.id))})' class="btn-ghost px-3 py-1.5 rounded-md text-xs">Batal</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  lucide.createIcons();
}

async function deleteThread(id) {
  if (!confirm('Hapus pesan diskusi ini?')) return;
  try {
    if (USE_DISKUSI_APPS_SCRIPT) {
      await diskusiRequest('deleteThread', { id });
      STATE.threads = STATE.threads.filter(t => String(t.id) !== String(id));
    } else {
      STATE.threads = STATE.threads.filter(t => t.id !== id);
      saveThreads();
    }
    renderThreads();
    showToast('Dihapus', 'Pesan diskusi telah dihapus.', 'success');
  } catch (e) { showToast('Gagal menghapus', e.message, 'error'); }
}

async function deleteReply(threadId, replyIdx) {
  if (!confirm('Hapus balasan ini?')) return;
  const thread = STATE.threads.find(t => String(t.id) === String(threadId));
  if (!thread || !thread.replies) return;
  try {
    if (USE_DISKUSI_APPS_SCRIPT) {
      const result = await diskusiRequest('deleteReply', { id: threadId, replyIndex: replyIdx });
      if (result.thread) { const i = STATE.threads.findIndex(t => String(t.id) === String(threadId)); if (i >= 0) STATE.threads[i] = normalizeThread(result.thread); }
    } else {
      thread.replies.splice(replyIdx, 1);
      saveThreads();
    }
    renderThreads();
    showToast('Dihapus', 'Balasan telah dihapus.', 'success');
  } catch (e) { showToast('Gagal menghapus', e.message, 'error'); }
}

function toggleReply(id) {
  const form = $(`reply-form-${id}`);
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) $(`reply-text-${id}`).focus();
}

async function submitReply(id) {
  const text = $(`reply-text-${id}`).value.trim();
  if (!text) return;
  try {
    if (USE_DISKUSI_APPS_SCRIPT) {
      const result = await diskusiRequest('saveReply', { id, reply: { pesan: text } });
      if (result.thread) { const i = STATE.threads.findIndex(t => String(t.id) === String(id)); if (i >= 0) STATE.threads[i] = normalizeThread(result.thread); }
    } else {
      const thread = STATE.threads.find(t => t.id === id);
      if (!thread) return;
      thread.replies = thread.replies || [];
      thread.replies.push({ nama: STATE.user.nama, pesan: text, timestamp: new Date().toISOString() });
      saveThreads();
    }
    renderThreads();
    showToast('Balasan terkirim', 'Balasan Anda telah ditambahkan ke diskusi', 'success');
  } catch (e) { showToast('Gagal mengirim', e.message, 'error'); }
}

function filterThread(cat, btn) {
  STATE.threadFilter = cat;
  document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderThreads();
}

 $('diskusiForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const nama = $('formNama').value.trim();
  const perusahaan = $('formPerusahaan').value.trim();
  const kategori = $('formKategori').value;
  const pesan = $('formPesan').value.trim();
  if (!nama || !pesan) { showToast('Lengkapi form', 'Nama dan pertanyaan wajib diisi', 'error'); return; }
  try {
    if (USE_DISKUSI_APPS_SCRIPT) {
      const result = await diskusiRequest('saveThread', { thread: { nama, perusahaan, kategori, pesan, replies: [] } });
      if (result.thread) STATE.threads.unshift(normalizeThread(result.thread));
    } else {
      STATE.threads.push({ id: Date.now(), nama, perusahaan, kategori, pesan, timestamp: new Date().toISOString(), replies: [] });
      saveThreads();
    }
    renderThreads();
    $('diskusiForm').reset();
    showToast('Pertanyaan terkirim', 'Pertanyaan Anda telah dipublikasikan di panel diskusi', 'success');
  } catch (e) { showToast('Gagal menyimpan', e.message, 'error'); }
});

/* ============== CHARTS ============== */
function destroyCharts() {
  Object.values(STATE.charts).forEach(c => c && c.destroy());
  STATE.charts = {};
}

function renderCharts() {
  Chart.defaults.color = '#78716c';
  Chart.defaults.font.family = 'Plus Jakarta Sans';
  Chart.defaults.borderColor = '#ffedd5';
  
  const byDate = {};
  STATE.raw.forEach(r => {
    const d = new Date(r['Timestamp']);
    if (isNaN(d)) return;
    const key = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    byDate[key] = (byDate[key] || 0) + 1;
  });
  const dateKeys = Object.keys(byDate).slice(-7);
  
  STATE.charts.trend = new Chart($('chartTrend'), {
    type: 'line',
    data: {
      labels: dateKeys,
      datasets: [{
        label: 'Pengiriman',
        data: dateKeys.map(k => byDate[k]),
        borderColor: '#ea580c',
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280);
          g.addColorStop(0, 'rgba(234,88,12,0.35)');
          g.addColorStop(1, 'rgba(234,88,12,0)');
          return g;
        },
        fill: true, tension: 0.4, borderWidth: 2.5,
        pointBackgroundColor: '#ea580c', pointBorderColor: '#ffffff',
        pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#ffedd5' }, ticks: { precision: 0 } }, x: { grid: { display: false } } } }
  });
  
  const byDaerah = {};
  STATE.raw.forEach(r => { if (r['Daerah Tujuan']) byDaerah[r['Daerah Tujuan']] = (byDaerah[r['Daerah Tujuan']] || 0) + 1; });
  const topDaerah = Object.entries(byDaerah).sort((a,b) => b[1] - a[1]).slice(0, 6);
  
  STATE.charts.daerah = new Chart($('chartDaerah'), {
    type: 'doughnut',
    data: {
      labels: topDaerah.map(d => d[0]),
      datasets: [{
        data: topDaerah.map(d => d[1]),
        backgroundColor: ['#ea580c', '#0284c7', '#16a34a', '#7c3aed', '#ca8a04', '#dc2626'],
        borderColor: '#ffffff', borderWidth: 3
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } } }
  });
  
  const byPengirim = {};
  STATE.raw.forEach(r => { if (r['Nama Perusahaan Pengirim']) byPengirim[r['Nama Perusahaan Pengirim']] = (byPengirim[r['Nama Perusahaan Pengirim']] || 0) + 1; });
  const topPengirim = Object.entries(byPengirim).sort((a,b) => b[1] - a[1]).slice(0, 8);
  
  STATE.charts.pengirim = new Chart($('chartPengirim'), {
    type: 'bar',
    data: {
      labels: topPengirim.map(p => p[0].length > 20 ? p[0].substring(0, 18) + '…' : p[0]),
      datasets: [{
        data: topPengirim.map(p => p[1]),
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 400, 0);
          g.addColorStop(0, '#ea580c');
          g.addColorStop(1, '#7c3aed');
          return g;
        },
        borderRadius: 6, barThickness: 18
      }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: '#ffedd5' }, ticks: { precision: 0 } }, y: { grid: { display: false } } } }
  });
  
  const byMuat = {};
  const byTujuan = {};
  STATE.raw.forEach(r => {
    if (r['Pelabuhan Muat']) byMuat[r['Pelabuhan Muat']] = (byMuat[r['Pelabuhan Muat']] || 0) + 1;
    if (r['Pelabuhan Tujuan']) byTujuan[r['Pelabuhan Tujuan']] = (byTujuan[r['Pelabuhan Tujuan']] || 0) + 1;
  });
  const allPorts = [...new Set([...Object.keys(byMuat), ...Object.keys(byTujuan)])].slice(0, 8);
  
  STATE.charts.pelabuhan = new Chart($('chartPelabuhan'), {
    type: 'bar',
    data: {
      labels: allPorts,
      datasets: [
        { label: 'Muat', data: allPorts.map(p => byMuat[p] || 0), backgroundColor: '#ea580c', borderRadius: 5, barThickness: 14 },
        { label: 'Tujuan', data: allPorts.map(p => byTujuan[p] || 0), backgroundColor: '#0284c7', borderRadius: 5, barThickness: 14 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { y: { beginAtZero: true, grid: { color: '#ffedd5' }, ticks: { precision: 0 } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
  });
  
  const volDaerah = {};
  STATE.raw.forEach(r => {
    if (r['Daerah Tujuan']) {
      const num = parseInt(String(r['Jumlah ternak (ekor)']).replace(/\D/g, '')) || 0;
      volDaerah[r['Daerah Tujuan']] = (volDaerah[r['Daerah Tujuan']] || 0) + num;
    }
  });
  const topVol = Object.entries(volDaerah).sort((a,b) => b[1] - a[1]).slice(0, 10);
  
  STATE.charts.volDaerah = new Chart($('chartVolumeDaerah'), {
    type: 'bar',
    data: {
      labels: topVol.map(d => d[0]),
      datasets: [{
        label: 'Total Ternak',
        data: topVol.map(d => d[1]),
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 320);
          g.addColorStop(0, '#ea580c');
          g.addColorStop(1, 'rgba(234,88,12,0.2)');
          return g;
        },
        borderRadius: 6, barThickness: 22
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#ffedd5' }, ticks: { callback: v => v.toLocaleString('id-ID') } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
  });
  
  const total = STATE.raw.length;
  const ternak = STATE.raw.reduce((s,r) => s + (parseInt(String(r['Jumlah ternak (ekor)']).replace(/\D/g, '')) || 0), 0);
  const avgTernak = total ? Math.round(ternak / total) : 0;
  const topCompany = topPengirim.length ? topPengirim[0][0] : '—';
  const topDaerahName = topDaerah.length ? topDaerah[0][0] : '—';
  
  $('statsSummary').innerHTML = [
    { label: 'Total Entri', value: total.toLocaleString('id-ID'), icon: 'database', color: 'var(--primary)' },
    { label: 'Total Ternak', value: ternak.toLocaleString('id-ID'), icon: 'bug', color: 'var(--success)' },
    { label: 'Rata-rata Ternak/Entri', value: avgTernak.toLocaleString('id-ID'), icon: 'bar-chart-2', color: 'var(--accent)' },
    { label: 'Pengirim Teratas', value: topCompany.length > 22 ? topCompany.substring(0,20) + '…' : topCompany, icon: 'award', color: 'var(--violet)' },
    { label: 'Daerah Tujuan Teratas', value: topDaerahName, icon: 'map-pin', color: 'var(--warning)' }
  ].map(item => `
    <div class="p-3 rounded-lg flex items-center gap-3" style="background: var(--surface-2); border: 1px solid var(--border-soft);">
      <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background: ${item.color}20;">
        <i data-lucide="${item.icon}" class="w-4 h-4" style="color: ${item.color};"></i>
      </div>
      <div class="min-w-0">
        <p class="text-[10px] uppercase tracking-wider" style="color: var(--muted);">${item.label}</p>
        <p class="font-display font-bold text-sm truncate">${item.value}</p>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

/* ============== EXPORT ============== */
function exportCSV() {
  if (!STATE.filtered.length) { showToast('Tidak ada data', 'Tidak ada data untuk diekspor', 'error'); return; }
  const exportData = STATE.filtered.map(r => {
    const cleanRow = {};
    ALLOWED_FIELDS.forEach(f => cleanRow[f] = r[f] || '');
    return cleanRow;
  });
  const csv = Papa.unparse(exportData);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pengiriman_ternak_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Export berhasil', `${STATE.filtered.length} entri diunduh sebagai CSV`, 'success');
}

/* ============== INIT ============== */
function updateDate() {
  const d = new Date();
  $('currentDate').textContent = d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

initAuth();
lucide.createIcons();
setInterval(updateDate, 60000);
