/**
 * ZULFA / SILIH-TERNAK — Secure Google Apps Script Backend
 * Role: admin + user
 *
 * IMPORTANT:
 * 1) Isi SPREADSHEET_ID.
 * 2) Deploy sebagai Web App: Execute as Me, Who has access: Anyone.
 * 3) URL /exec dimasukkan ke const API_URL di script.js.
 *
 * Keamanan:
 * - Password SHA-256 + salt per user.
 * - Session token acak, hanya hash token yang disimpan.
 * - Session memiliki masa berlaku.
 * - Semua operasi data/server memerlukan session.
 * - Hak akses admin/user divalidasi di server, bukan hanya di UI.
 * - Endpoint bootstrap tidak lagi membocorkan password/user sensitif.
 * - LockService dipakai saat perubahan database untuk mencegah race condition.
 */

const SPREADSHEET_ID = '1VH3kLmDCg5A3qlRyUDVp27m8euU6usXrzJt_sp8uAbY';
const SESSION_HOURS = 8;

const SHEETS = {
  Users: ['id','username','passwordHash','salt','nama','perusahaan','role','active','createdAt','updatedAt'],
  Sessions: ['id','userId','tokenHash','expiresAt','createdAt'],
  Data: [
    'id','Timestamp','Daerah Tujuan','Jenis Permohonan','Surat Permohonan',
    'Surat Izin','Sertifikat Kesehatan Hewan KH 11','Nama Perusahaan Pengirim',
    'Nama Pengirim','Nama Perusahaan Penerima/Nama Penerima','Jumlah ternak (ekor)',
    'Pelabuhan Muat','Pelabuhan Tujuan','createdAt','updatedAt','createdBy'
  ],
  Mutations: ['id','type','rowId','payload','createdAt','updatedAt','updatedBy'],
  ShipSchedules: ['id','shipCode','date','route','status','note','updatedAt','updatedBy'],
  AuditLogs: ['id','userId','username','action','target','detail','createdAt']
};

function getSS_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf('ISI_') === 0) {
    throw new Error('SPREADSHEET_ID belum diisi.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(name) {
  const ss = getSS_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,SHEETS[name].length).setValues([SHEETS[name]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'health';
    if (action === 'health') return json_({ok:true, service:'ZULFA SILIH-TERNAK', time:new Date().toISOString()});
    // Semua data harus diambil melalui POST + session.
    return json_({ok:false, error:'Gunakan POST dan login terlebih dahulu.'});
  } catch(err) {
    return json_({ok:false,error:String(err.message || err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');

    if (action === 'login') return json_(login_(body));
    if (action === 'register') return json_(register_(body));

    const session = requireSession_(body.token);
    switch(action) {
      case 'bootstrap': return json_(bootstrap_(session));
      case 'createUser': requireAdmin_(session); return json_(createUser_(body, session));
      case 'listUsers': requireAdmin_(session); return json_({ok:true,users:listUsers_()});
      case 'setUserStatus': requireAdmin_(session); return json_(setUserStatus_(body,session));
      case 'changePassword': return json_(changePassword_(body,session));
      case 'updateProfile': return json_(updateProfile_(body,session));
      case 'saveData': requireAdmin_(session); return json_(saveData_(body,session));
      case 'deleteData': requireAdmin_(session); return json_(deleteData_(body,session));
      case 'setVerified': requireAdmin_(session); return json_(setVerified_(body,session));
      case 'saveSchedule': requireAdmin_(session); return json_(saveSchedule_(body,session));
      default: return json_({ok:false,error:'Action tidak dikenal.'});
    }
  } catch(err) {
    return json_({ok:false,error:String(err.message || err)});
  }
}

function bootstrap_(session) {
  Object.keys(SHEETS).forEach(getSheet_);
  cleanupSessions_();
  return {
    ok:true,
    user:safeUser_(session.user),
    data:readObjects_('Data'),
    mutations:readObjects_('Mutations'),
    users:session.user.role === 'admin' ? listUsers_() : [],
    schedules:readObjects_('ShipSchedules')
  };
}

function readObjects_(sheetName) {
  const sh=getSheet_(sheetName), values=sh.getDataRange().getValues();
  if(values.length<2) return [];
  const headers=values[0].map(String);
  return values.slice(1).filter(r=>r.some(v=>v!=='')).map(row=>{
    const obj={};
    headers.forEach((h,i)=>obj[h]=row[i] instanceof Date ? row[i].toISOString() : row[i]);
    return obj;
  });
}

function findRowById_(sheetName,id) {
  const sh=getSheet_(sheetName), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++) if(String(values[i][0])===String(id)) return i+1;
  return null;
}

function appendObject_(sheetName,obj) {
  const sh=getSheet_(sheetName), headers=SHEETS[sheetName];
  sh.appendRow(headers.map(h=>obj[h]!==undefined?obj[h]:''));
}

function upsertObject_(sheetName,obj) {
  const sh=getSheet_(sheetName), headers=SHEETS[sheetName];
  const row=findRowById_(sheetName,obj.id);
  const values=headers.map(h=>obj[h]!==undefined?obj[h]:'');
  if(row) sh.getRange(row,1,1,headers.length).setValues([values]);
  else sh.appendRow(values);
}

function deleteObject_(sheetName,id) {
  const sh=getSheet_(sheetName), row=findRowById_(sheetName,id);
  if(row){sh.deleteRow(row);return true;} return false;
}

function randomHex_(bytes) {
  const a=Utilities.getUuid().replace(/-/g,'');
  return a.slice(0,Math.max(16,bytes*2));
}

function hash_(value) {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value||''),Utilities.Charset.UTF_8);
  return bytes.map(b=>{const v=(b<0?b+256:b).toString(16);return v.length===1?'0'+v:v;}).join('');
}

function passwordHash_(password,salt){ return hash_(salt+'|'+String(password||'')); }

function safeUser_(u) {
  return {id:u.id,username:u.username,nama:u.nama,perusahaan:u.perusahaan,role:u.role,active:String(u.active)!=='false'};
}

function listUsers_() {
  return readObjects_('Users').map(safeUser_);
}

function findUser_(username) {
  const key=String(username||'').trim().toLowerCase();
  return readObjects_('Users').find(u=>String(u.username).trim().toLowerCase()===key);
}

function createUser_(body,session) {
  const username=String(body.username||'').trim();
  const nama=String(body.nama||'').trim();
  const perusahaan=String(body.perusahaan||'').trim();
  const password=String(body.password||'');
  const role=body.role==='admin'?'admin':'user';
  if(!/^[a-zA-Z0-9._-]{4,30}$/.test(username)) return {ok:false,error:'Username 4–30 karakter: huruf, angka, titik, garis bawah, atau strip.'};
  if(nama.length<2 || password.length<8) return {ok:false,error:'Nama wajib diisi dan password minimal 8 karakter.'};
  if(findUser_(username)) return {ok:false,error:'Username sudah digunakan.'};
  const salt=randomHex_(16);
  const user={id:Utilities.getUuid(),username,nama,perusahaan,role,active:true,salt,passwordHash:passwordHash_(password,salt),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  appendObject_('Users',user);
  audit_(session,'createUser',user.id,'Membuat akun '+role+' '+username);
  return {ok:true,user:safeUser_(user)};
}

function ensureFirstAdmin_() {
  const users=readObjects_('Users');
  if(users.length) return;
  const salt=randomHex_(16);
  appendObject_('Users',{id:Utilities.getUuid(),username:'admin',nama:'Administrator',perusahaan:'Dinas Peternakan NTT',role:'admin',active:true,salt,passwordHash:passwordHash_('admin123',salt),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
}

function login_(body) {
  ensureFirstAdmin_();
  const user=findUser_(body.username);
  if(!user || String(user.active)==='false') return {ok:false,error:'Username tidak ditemukan atau akun dinonaktifkan.'};
  if(passwordHash_(body.password,user.salt)!==String(user.passwordHash)) return {ok:false,error:'Username atau password salah.'};

  const token=Utilities.getUuid()+'-'+Utilities.getUuid();
  const now=new Date(), exp=new Date(now.getTime()+SESSION_HOURS*3600000);
  appendObject_('Sessions',{id:Utilities.getUuid(),userId:user.id,tokenHash:hash_(token),expiresAt:exp.toISOString(),createdAt:now.toISOString()});
  audit_(safeSession_(user),'login',user.id,'Login berhasil');
  return {ok:true,user:safeUser_(user),token,expiresAt:exp.toISOString()};
}

function safeSession_(user){ return {user:safeUser_(user)}; }

function requireSession_(token) {
  if(!token || token==='demo') throw new Error('Sesi tidak valid. Silakan login kembali.');
  const sessions=readObjects_('Sessions'), th=hash_(token), now=Date.now();
  const s=sessions.find(x=>String(x.tokenHash)===th && new Date(x.expiresAt).getTime()>now);
  if(!s) throw new Error('Sesi telah berakhir. Silakan login kembali.');
  const user=readObjects_('Users').find(u=>String(u.id)===String(s.userId));
  if(!user || String(user.active)==='false') throw new Error('Akun tidak aktif.');
  return {session:s,user};
}

function requireAdmin_(session) {
  if(session.user.role!=='admin') throw new Error('Akses ditolak. Fitur ini hanya untuk administrator.');
}

function cleanupSessions_() {
  const sh=getSheet_('Sessions'), vals=sh.getDataRange().getValues();
  if(vals.length<2) return;
  const now=Date.now();
  for(let i=vals.length-1;i>=1;i--) if(new Date(vals[i][3]).getTime()<now) sh.deleteRow(i+1);
}

function register_(body) {
  ensureFirstAdmin_();

  const username=String(body.username||'').trim();
  const nama=String(body.nama||'').trim();
  const perusahaan=String(body.perusahaan||'').trim();
  const password=String(body.password||'');

  if(!/^[a-zA-Z0-9._-]{4,30}$/.test(username)) {
    return {ok:false,error:'Username 4–30 karakter: huruf, angka, titik, garis bawah, atau strip.'};
  }
  if(nama.length<2) return {ok:false,error:'Nama lengkap minimal 2 karakter.'};
  if(perusahaan.length<2) return {ok:false,error:'Nama perusahaan minimal 2 karakter.'};
  if(password.length<8) return {ok:false,error:'Password minimal 8 karakter.'};
  if(findUser_(username)) return {ok:false,error:'Username sudah digunakan. Silakan pilih username lain.'};

  const lock=LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Cek ulang setelah lock agar dua pendaftaran bersamaan tidak membuat username ganda.
    if(findUser_(username)) return {ok:false,error:'Username sudah digunakan. Silakan pilih username lain.'};

    const salt=randomHex_(16);
    const now=new Date().toISOString();
    const user={
      id:Utilities.getUuid(),
      username,nama,perusahaan,
      role:'user',
      active:true,
      salt,
      passwordHash:passwordHash_(password,salt),
      createdAt:now,
      updatedAt:now
    };
    appendObject_('Users',user);

    // Setelah daftar berhasil, langsung buat sesi login agar pengguna tidak perlu login ulang.
    const token=Utilities.getUuid()+'-'+Utilities.getUuid();
    const exp=new Date(Date.now()+SESSION_HOURS*3600000);
    appendObject_('Sessions',{
      id:Utilities.getUuid(),
      userId:user.id,
      tokenHash:hash_(token),
      expiresAt:exp.toISOString(),
      createdAt:now
    });
    audit_({user},'register',user.id,'Pendaftaran Pelaku Usaha '+username);

    return {ok:true,user:safeUser_(user),token,expiresAt:exp.toISOString()};
  } finally {
    lock.releaseLock();
  }
}

function setUserStatus_(body,session) {
  const id=String(body.id||'');
  const users=readObjects_('Users');
  const u=users.find(x=>String(x.id)===id);
  if(!u) return {ok:false,error:'User tidak ditemukan.'};
  if(u.id===session.user.id && String(body.active)==='false') return {ok:false,error:'Anda tidak dapat menonaktifkan akun sendiri.'};
  u.active=Boolean(body.active); u.updatedAt=new Date().toISOString(); upsertObject_('Users',u);
  audit_(session,'setUserStatus',id,'active='+u.active);
  return {ok:true,user:safeUser_(u)};
}


function updateProfile_(body, session) {
  const nama = String(body.nama || '').trim();
  const perusahaan = String(body.perusahaan || '').trim();
  if (nama.length < 2) return {ok:false,error:'Nama lengkap minimal 2 karakter.'};
  if (nama.length > 100 || perusahaan.length > 150) return {ok:false,error:'Data profil terlalu panjang.'};

  const users = readObjects_('Users');
  const u = users.find(x => String(x.id) === String(session.user.id));
  if (!u) return {ok:false,error:'Akun tidak ditemukan.'};

  u.nama = nama;
  u.perusahaan = perusahaan;
  u.updatedAt = new Date().toISOString();
  upsertObject_('Users', u);

  audit_(session, 'updateProfile', u.id, 'Memperbarui data diri');
  return {ok:true, user:safeUser_(u)};
}

function changePassword_(body,session) {
  const oldPassword=String(body.oldPassword||''), newPassword=String(body.newPassword||'');
  if(newPassword.length<8) return {ok:false,error:'Password baru minimal 8 karakter.'};
  if(passwordHash_(oldPassword,session.user.salt)!==String(session.user.passwordHash)) return {ok:false,error:'Password lama salah.'};
  const u=readObjects_('Users').find(x=>String(x.id)===String(session.user.id));
  const salt=randomHex_(16); u.salt=salt; u.passwordHash=passwordHash_(newPassword,salt); u.updatedAt=new Date().toISOString(); upsertObject_('Users',u);
  audit_(session,'changePassword',u.id,'Password diubah');
  return {ok:true};
}

function saveData_(body,session) {
  const lock=LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const data=Object.assign({},body.data||{});
    data.id=String(data.id||Utilities.getUuid());
    data.updatedAt=new Date().toISOString(); data.createdAt=data.createdAt||data.updatedAt; data.createdBy=session.user.username;
    upsertObject_('Data',data);
    audit_(session,'saveData',data.id,'Simpan/perbarui data');
    return {ok:true,data};
  } finally { lock.releaseLock(); }
}

function deleteData_(body,session) {
  const id=String(body.id||''); if(!id) return {ok:false,error:'ID data kosong.'};
  const ok=deleteObject_('Data',id); audit_(session,'deleteData',id,'Hapus data'); return {ok};
}

function setVerified_(body,session) {
  const id=String(body.id||''), value=Boolean(body.value);
  const existing=readObjects_('Mutations').find(m=>String(m.type)==='verified'&&String(m.rowId)===id);
  const m={id:existing?existing.id:Utilities.getUuid(),type:'verified',rowId:id,payload:JSON.stringify({value}),createdAt:existing?existing.createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:session.user.username};
  upsertObject_('Mutations',m); audit_(session,'setVerified',id,'verified='+value); return {ok:true,id,verified:value};
}

function saveSchedule_(body,session) {
  const s=Object.assign({},body.schedule||{}); s.id=String(s.id||Utilities.getUuid()); s.updatedAt=new Date().toISOString(); s.updatedBy=session.user.username;
  upsertObject_('ShipSchedules',s); audit_(session,'saveSchedule',s.id,'Simpan jadwal kapal'); return {ok:true,schedule:s};
}

function audit_(session,action,target,detail) {
  const u=session.user||{};
  appendObject_('AuditLogs',{id:Utilities.getUuid(),userId:u.id||'',username:u.username||'',action,target:target||'',detail:detail||'',createdAt:new Date().toISOString()});
}
