/**
 * ZULFA / SILIH-TERNAK — BACKEND DISKUSI TERPISAH
 *
 * Database diskusi berdiri sendiri dari Spreadsheet utama.
 *
 * SETUP:
 * 1. Buat Google Spreadsheet baru khusus diskusi.
 * 2. Masukkan ID spreadsheet ke SPREADSHEET_DISKUSI_ID.
 * 3. Deploy sebagai Web App: Execute as Me, Who has access: Anyone.
 * 4. Masukkan URL /exec hasil deployment ke DISKUSI_API_URL pada script.js.
 *
 * Catatan keamanan:
 * - Token sesi dibuat oleh backend utama.
 * - Backend diskusi membaca sesi dari Spreadsheet utama hanya untuk memvalidasi identitas,
 *   tetapi TIDAK menulis tabel/data diskusi ke Spreadsheet utama.
 * - Semua data Threads dan log diskusi disimpan di Spreadsheet Diskusi.
 */

const SPREADSHEET_DISKUSI_ID = '1gCbaPuElYt88oLaX9pvjJiqstsQ6_i0K4bLObD7K5Fc';
const SPREADSHEET_UTAMA_ID = '1VH3kLmDCg5A3qlRyUDVp27m8euU6usXrzJt_sp8uAbY';
const DISKUSI_SESSION_HOURS = 8;

const DISKUSI_SHEETS = {
  Threads: ['id','nama','perusahaan','kategori','pesan','timestamp','createdBy','replies'],
  DiskusiLogs: ['id','userId','username','action','target','detail','createdAt']
};

function getDiskusiSS_() {
  if (!SPREADSHEET_DISKUSI_ID || SPREADSHEET_DISKUSI_ID.indexOf('ISI_') === 0) {
    throw new Error('SPREADSHEET_DISKUSI_ID belum diisi.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_DISKUSI_ID);
}

function getUtamaSS_() {
  return SpreadsheetApp.openById(SPREADSHEET_UTAMA_ID);
}

function getDiskusiSheet_(name) {
  const ss = getDiskusiSS_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,DISKUSI_SHEETS[name].length).setValues([DISKUSI_SHEETS[name]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function jsonDiskusi_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return jsonDiskusi_({ok:true,service:'ZULFA DISKUSI',time:new Date().toISOString()});
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');
    if (action === 'health') return jsonDiskusi_({ok:true,service:'ZULFA DISKUSI',time:new Date().toISOString()});

    const session = requireDiskusiSession_(body.token);
    switch (action) {
      case 'bootstrap': return jsonDiskusi_(bootstrapDiskusi_(session));
      case 'saveThread': return jsonDiskusi_(saveThreadDiskusi_(body, session));
      case 'deleteThread': requireDiskusiAdmin_(session); return jsonDiskusi_(deleteThreadDiskusi_(body, session));
      case 'saveReply': return jsonDiskusi_(saveReplyDiskusi_(body, session));
      case 'deleteReply': requireDiskusiAdmin_(session); return jsonDiskusi_(deleteReplyDiskusi_(body, session));
      default: return jsonDiskusi_({ok:false,error:'Action diskusi tidak dikenal.'});
    }
  } catch (err) {
    return jsonDiskusi_({ok:false,error:String(err.message || err)});
  }
}

function bootstrapDiskusi_(session) {
  Object.keys(DISKUSI_SHEETS).forEach(getDiskusiSheet_);
  return {ok:true,user:safeDiskusiUser_(session.user),threads:readDiskusiObjects_('Threads')};
}

function readDiskusiObjects_(sheetName) {
  const sh = getDiskusiSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(r => r.some(v => v !== '')).map(row => {
    const obj = {};
    headers.forEach((h,i) => obj[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]);
    if (sheetName === 'Threads' && typeof obj.replies === 'string') {
      try { obj.replies = JSON.parse(obj.replies || '[]'); } catch (_) { obj.replies = []; }
    }
    return obj;
  });
}

function findDiskusiRowById_(sheetName,id) {
  const sh = getDiskusiSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  for (let i=1;i<values.length;i++) if (String(values[i][0]) === String(id)) return i+1;
  return null;
}

function appendDiskusiObject_(sheetName,obj) {
  const sh = getDiskusiSheet_(sheetName);
  const headers = DISKUSI_SHEETS[sheetName];
  sh.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
}

function upsertDiskusiObject_(sheetName,obj) {
  const sh = getDiskusiSheet_(sheetName);
  const headers = DISKUSI_SHEETS[sheetName];
  const row = findDiskusiRowById_(sheetName,obj.id);
  const values = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  if (row) sh.getRange(row,1,1,headers.length).setValues([values]);
  else sh.appendRow(values);
}

function deleteDiskusiObject_(sheetName,id) {
  const sh = getDiskusiSheet_(sheetName);
  const row = findDiskusiRowById_(sheetName,id);
  if (row) { sh.deleteRow(row); return true; }
  return false;
}

function hashDiskusi_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value || ''),Utilities.Charset.UTF_8);
  return bytes.map(b => { const v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
}

function safeDiskusiUser_(u) {
  return {id:u.id,username:u.username,nama:u.nama,perusahaan:u.perusahaan,role:u.role,active:String(u.active)!=='false'};
}

/** Validasi token terhadap sesi yang diterbitkan backend utama. */
function requireDiskusiSession_(token) {
  if (!token || token === 'demo') throw new Error('Sesi tidak valid. Silakan login kembali.');

  const ss = getUtamaSS_();
  const sessions = ss.getSheetByName('Sessions');
  const users = ss.getSheetByName('Users');
  if (!sessions || !users) throw new Error('Database autentikasi utama belum siap.');

  const sessionValues = sessions.getDataRange().getValues();
  const tokenHash = hashDiskusi_(token);
  const now = Date.now();
  let found = null;
  for (let i=1;i<sessionValues.length;i++) {
    const row = sessionValues[i];
    if (String(row[2]) === tokenHash && new Date(row[3]).getTime() > now) {
      found = {id:row[0],userId:row[1],expiresAt:row[3]};
      break;
    }
  }
  if (!found) throw new Error('Sesi telah berakhir. Silakan login kembali.');

  const userValues = users.getDataRange().getValues();
  const headers = userValues[0].map(String);
  let user = null;
  for (let i=1;i<userValues.length;i++) {
    if (String(userValues[i][0]) === String(found.userId)) {
      user = {};
      headers.forEach((h,j) => user[h] = userValues[i][j]);
      break;
    }
  }
  if (!user || String(user.active) === 'false') throw new Error('Akun tidak aktif.');
  return {session:found,user};
}

function requireDiskusiAdmin_(session) {
  if (session.user.role !== 'admin') throw new Error('Akses ditolak. Fitur ini hanya untuk administrator.');
}

function saveThreadDiskusi_(body,session) {
  const source = Object.assign({},body.thread || {});
  const now = new Date().toISOString();
  const t = {
    id: String(source.id || Utilities.getUuid()),
    nama: session.user.nama,
    perusahaan: String(source.perusahaan || session.user.perusahaan || ''),
    kategori: String(source.kategori || 'Umum'),
    pesan: String(source.pesan || '').trim(),
    timestamp: source.timestamp || now,
    createdBy: session.user.username,
    replies: JSON.stringify(Array.isArray(source.replies) ? source.replies : [])
  };
  if (!t.pesan) return {ok:false,error:'Pertanyaan tidak boleh kosong.'};
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    upsertDiskusiObject_('Threads',t);
    logDiskusi_(session,'saveThread',t.id,'Membuat/memperbarui diskusi');
  } finally { lock.releaseLock(); }
  t.replies = JSON.parse(t.replies);
  return {ok:true,thread:t};
}

function deleteThreadDiskusi_(body,session) {
  const id = String(body.id || '');
  if (!id) return {ok:false,error:'ID diskusi kosong.'};
  const ok = deleteDiskusiObject_('Threads',id);
  logDiskusi_(session,'deleteThread',id,'Hapus diskusi');
  return {ok};
}

function saveReplyDiskusi_(body,session) {
  const id = String(body.id || '');
  const threads = readDiskusiObjects_('Threads');
  const t = threads.find(x => String(x.id) === id);
  if (!t) return {ok:false,error:'Thread tidak ditemukan.'};
  const replies = Array.isArray(t.replies) ? t.replies : [];
  const text = String((body.reply || {}).pesan || '').trim();
  if (!text) return {ok:false,error:'Balasan tidak boleh kosong.'};
  replies.push({nama:session.user.nama,pesan:text,role:session.user.role,timestamp:new Date().toISOString()});
  t.replies = JSON.stringify(replies);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    upsertDiskusiObject_('Threads',t);
    logDiskusi_(session,'saveReply',id,'Menambah balasan diskusi');
  } finally { lock.releaseLock(); }
  t.replies = replies;
  return {ok:true,thread:t};
}

function deleteReplyDiskusi_(body,session) {
  const id = String(body.id || '');
  const idx = Number(body.replyIndex);
  const t = readDiskusiObjects_('Threads').find(x => String(x.id) === id);
  if (!t) return {ok:false,error:'Thread tidak ditemukan.'};
  const replies = Array.isArray(t.replies) ? t.replies : [];
  if (idx < 0 || idx >= replies.length) return {ok:false,error:'Balasan tidak ditemukan.'};
  replies.splice(idx,1);
  t.replies = JSON.stringify(replies);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    upsertDiskusiObject_('Threads',t);
    logDiskusi_(session,'deleteReply',id,'Hapus balasan diskusi');
  } finally { lock.releaseLock(); }
  t.replies = replies;
  return {ok:true,thread:t};
}

function logDiskusi_(session,action,target,detail) {
  const u = session.user || {};
  appendDiskusiObject_('DiskusiLogs',{id:Utilities.getUuid(),userId:u.id||'',username:u.username||'',action,target:target||'',detail:detail||'',createdAt:new Date().toISOString()});
}
