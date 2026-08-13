const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRRG9d7D89t-4ReyUrRhK1Z5ElORXnwmqL_ubOOmmCjG3MelmEFuvZeE8E48F-mUfYXf57W4RCobsHH/pub?gid=1062946909&single=true&output=csv';
const dataBody = document.getElementById('dataBody');
const form = document.getElementById('discussionForm');
const messageList = document.getElementById('messageList');

function parseCsv(csvText) {
  const rows = csvText.trim().split(/\r?\n/);
  return rows.map((row) => {
    const values = [];
    let current = '';
    let insideQuotes = false;
    for (let i = 0; i < row.length; i += 1) {
      const char = row[i];
      if (char === '"') {
        if (insideQuotes && row[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  });
}

function normalizeHeader(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function renderData(rows) {
  if (rows.length <= 1) {
    dataBody.innerHTML = '<tr><td colspan="10" class="loading">Tidak ada data.</td></tr>';
    return;
  }

  const headers = rows[0].map((col) => normalizeHeader(col));
  const wanted = [
    'timestamp',
    'daerah tujuan',
    'nomor surat',
    'nomor surat izin',
    'nama perusahaan pengirim',
    'nama pengirim',
    'nama perusahaan penerima',
    'jumlah ternak',
    'pelabuhan muat',
    'pelabuhan tujuan'
  ];

  const indexes = wanted.map((field) => headers.indexOf(field));
  if (indexes.some((idx) => idx === -1)) {
    dataBody.innerHTML = '<tr><td colspan="10" class="loading">Kolom tidak ditemukan dalam spreadsheet.</td></tr>';
    return;
  }

  dataBody.innerHTML = '';
  rows.slice(1).forEach((row) => {
    const cells = indexes.map((idx) => row[idx] ?? '');
    const tr = document.createElement('tr');
    cells.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    dataBody.appendChild(tr);
  });
}

async function loadSpreadsheet() {
  try {
    const response = await fetch(sheetUrl);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    const text = await response.text();
    const rows = parseCsv(text);
    renderData(rows);
  } catch (error) {
    dataBody.innerHTML = `<tr><td colspan="10" class="loading">Gagal memuat data: ${error.message}</td></tr>`;
    console.error(error);
  }
}

function loadMessages() {
  const stored = localStorage.getItem('dashboardMessages');
  return stored ? JSON.parse(stored) : [];
}

function saveMessages(messages) {
  localStorage.setItem('dashboardMessages', JSON.stringify(messages));
}

function renderMessages() {
  const messages = loadMessages();
  if (messages.length === 0) {
    messageList.innerHTML = '<div class="message"><div class="message-header"><strong>Belum ada pertanyaan</strong></div><p>Silakan kirim pertanyaan menggunakan formulir di atas.</p></div>';
    return;
  }

  messageList.innerHTML = '';
  messages.reverse().forEach((item) => {
    const article = document.createElement('article');
    article.className = 'message';
    article.innerHTML = `
      <div class="message-header">
        <strong>${item.name}</strong>
        <span class="message-time">${item.time}</span>
      </div>
      <p>${item.question}</p>
    `;
    messageList.appendChild(article);
  });
}

function formatTime(date) {
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('name').value.trim();
  const question = document.getElementById('question').value.trim();
  if (!name || !question) return;

  const messages = loadMessages();
  messages.push({
    name,
    question,
    time: formatTime(new Date())
  });
  saveMessages(messages);
  renderMessages();
  form.reset();
});

loadSpreadsheet();
renderMessages();
