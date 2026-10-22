/* Mailer frontend */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const state = {
  auth: { authenticated: false, email: null },
  settings: { from_name: '' },
  view: 'list',
  current: null,
  compose: { mode: 'new', id: null, recipients: [], customFields: [] },
  pollTimer: null,
};

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderTemplate(source, data) {
  return String(source || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const k = key.trim();
    const v = data[k];
    return v === undefined || v === null ? match : String(v);
  });
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(msg, type) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

/* ---------------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------------- */

async function loadAuth() {
  try {
    state.auth = await api('/auth/status');
  } catch {
    state.auth = { authenticated: false, email: null };
  }
  renderAuth();
}

async function loadSettings() {
  try {
    state.settings = await api('/api/settings');
  } catch {
    state.settings = { from_name: '' };
  }
  renderAuth();
}

function renderAuth() {
  const area = $('auth-area');
  if (state.auth.authenticated) {
    const initial = (state.auth.email || '?')[0].toUpperCase();
    area.innerHTML = `
      <div class="signed-in">
        <label class="from-name">
          <span class="account">From name</span>
          <input id="f-from-name" type="text" placeholder="Your name" value="${esc(state.settings.from_name)}" />
          <button class="btn ghost sm" id="btn-save-from-name">Save</button>
        </label>
        <span class="avatar">${esc(initial)}</span>
        <span class="account">${esc(state.auth.email)}</span>
        <button class="btn ghost sm" id="btn-logout">Sign out</button>
      </div>`;
    $('btn-logout').addEventListener('click', async () => {
      await api('/auth/logout', { method: 'POST' });
      await loadAuth();
      toast('Signed out');
    });
    $('btn-save-from-name').addEventListener('click', saveFromName);
    $('f-from-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveFromName(); }
    });
  } else {
    area.innerHTML = `<a class="btn primary" href="/auth/google">Sign in with Google</a>`;
  }
}

async function saveFromName() {
  const name = $('f-from-name').value.trim();
  try {
    const res = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ from_name: name }),
    });
    state.settings.from_name = res.from_name;
    if (res.warning) {
      toast(res.warning, 'error');
    } else if (res.gmail_display_name) {
      toast(`Sender name set to "${res.gmail_display_name}"`, 'success');
    } else {
      toast('Sender name cleared', 'success');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------------------------------------------------------------------
 * Navigation
 * ------------------------------------------------------------------------- */

function show(view) {
  state.view = view;
  ['list', 'compose', 'detail'].forEach((v) => $('view-' + v).classList.toggle('hidden', v !== view));
  window.scrollTo(0, 0);
}

async function showList() {
  show('list');
  await loadList();
}

/* ---------------------------------------------------------------------------
 * List view
 * ------------------------------------------------------------------------- */

async function loadList() {
  const emails = await api('/api/emails');
  state.emails = emails;
  renderList();

  const anySending = emails.some((e) => e.status === 'sending');
  if (anySending) startPoll(); else stopPoll();
}

function statusBadge(status) {
  const label = { draft: 'Draft', sending: 'Sending…', sent: 'Sent', partial: 'Partial' }[status] || status;
  return `<span class="badge ${esc(status)}">${esc(label)}</span>`;
}

function renderList() {
  const c = $('list-container');
  if (!state.emails.length) {
    c.innerHTML = `<div class="empty"><h2>No emails yet</h2><p>Create your first mail merge with templated messages.</p></div>`;
    return;
  }
  const rows = state.emails
    .map((e) => {
      const counts = [];
      if (e.sent) counts.push(`${e.sent} sent`);
      if (e.failed) counts.push(`${e.failed} failed`);
      if (e.not_sent) counts.push(`${e.not_sent} pending`);
      return `
      <div class="list-row" data-id="${e.id}">
        <div class="list-main">
          <div class="list-subject">${esc(e.subject || '(no subject)')}</div>
          <div class="list-meta">${esc(fmtDate(e.created_at))}${counts.length ? ' · ' + esc(counts.join(', ')) : ''}</div>
        </div>
        ${statusBadge(e.status)}
      </div>`;
    })
    .join('');
  c.innerHTML = `<div class="list-card">${rows}</div>`;
  c.querySelectorAll('.list-row').forEach((row) =>
    row.addEventListener('click', () => loadDetail(Number(row.dataset.id)))
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString();
}

/* ---------------------------------------------------------------------------
 * Compose view
 * ------------------------------------------------------------------------- */

function openCompose(email) {
  state.compose = {
    mode: email ? 'edit' : 'new',
    id: email ? email.id : null,
    recipients: email
      ? email.recipients.map((r) => ({ email: r.email, name: r.name || '', ...(r.data || {}) }))
      : [],
    customFields: [],
  };
  state.current = email || null;

  $('compose-title').textContent = email ? 'Edit email' : 'New email';
  $('f-subject').value = email ? email.subject : '';
  $('f-body').value = email ? email.body : '';
  $('f-cc').value = email ? email.cc : '';
  $('f-bcc').value = email ? email.bcc : '';

  syncTextareaFromRecipients();
  updateVarsAndPreview();
  renderAttachments();

  show('compose');
}

function syncTextareaFromRecipients() {
  $('f-recipients').value = state.compose.recipients
    .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
    .join('\n');
}

// Rebuild recipients from the textarea, preserving custom fields by email.
// If the textarea holds a JSON array of objects, it is parsed as JSON and
// treated as authoritative (full replace); otherwise it is parsed as a
// comma/newline-separated list, preserving custom fields for matching emails.
function syncRecipientsFromTextarea() {
  const text = $('f-recipients').value;
  const json = parseJSONRecipients(text);
  if (json) {
    state.compose.recipients = json;
  } else {
    const parsed = parseRecipientText(text);
    const old = new Map(state.compose.recipients.map((r) => [r.email, r]));
    state.compose.recipients = parsed.map((p) => {
      const { email, name, ...pCustom } = p;
      const prev = old.get(email);
      if (!prev) return { email, name, ...pCustom };
      const { email: _e, name: _n, ...prevCustom } = prev;
      return { email, name: name || prev.name || '', ...prevCustom, ...pCustom };
    });
  }
  updateVarsAndPreview();
}

function parseRecipientText(text) {
  const map = new Map();
  const items = String(text || '').split(/[\n,;]+/);
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    let name = '';
    let email = item;
    const m = item.match(/^(.*?)<([^>]+)>$/);
    if (m) { name = m[1].trim(); email = m[2].trim(); }
    email = email.toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    if (!map.has(email) || (name && !map.get(email).name)) {
      map.set(email, { email, name: name || (map.get(email)?.name || '') });
    }
  }
  return [...map.values()];
}

function computeCustomFields() {
  const fields = new Set();
  for (const r of state.compose.recipients) {
    for (const k of Object.keys(r)) {
      if (k !== 'email' && k !== 'name') fields.add(k);
    }
  }
  return [...fields].sort();
}

function updateVarsAndPreview() {
  state.compose.customFields = computeCustomFields();

  const vars = ['name', 'email', ...state.compose.customFields];
  $('var-list').innerHTML = vars.map((v) => `<li>{{ ${esc(v)} }}</li>`).join('');

  const count = state.compose.recipients.length;
  $('recipient-count').textContent = count ? `${count} recipient${count === 1 ? '' : 's'}` : '';

  const sample =
    state.compose.recipients[0] || { email: 'john@example.com', name: 'John Doe' };
  const previewData = { name: sample.name || 'John Doe', email: sample.email, ...sample };
  $('preview-subject').textContent = renderTemplate($('f-subject').value || '(no subject)', previewData);
  $('preview-body').textContent = renderTemplate($('f-body').value || '(empty body)', previewData);
  $('preview-note').textContent = count ? 'Preview using the first recipient.' : 'Preview using sample data.';
}

function renderAttachments() {
  const list = $('attachment-list');
  const atts = (state.current && state.current.attachments) || [];
  if (!atts.length) {
    list.innerHTML = '<li class="muted">No attachments.</li>';
    return;
  }
  list.innerHTML = atts
    .map(
      (a) => `
      <li class="attachment-item">
        <span class="name">${esc(a.filename)}</span>
        <span class="size">${esc(humanSize(a.size))}</span>
        ${
          state.compose.mode === 'edit' && (state.current.status === 'draft')
            ? `<button class="btn ghost sm" data-remove="${a.id}">Remove</button>`
            : ''
        }
      </li>`
    )
    .join('');
  list.querySelectorAll('[data-remove]').forEach((btn) =>
    btn.addEventListener('click', () => removeAttachment(Number(btn.dataset.remove)))
  );
}

function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function composePayload() {
  return {
    subject: $('f-subject').value,
    body: $('f-body').value,
    cc: $('f-cc').value,
    bcc: $('f-bcc').value,
    recipients: state.compose.recipients.map((r) => {
      const { email, name, ...custom } = r;
      return { email, name, ...custom };
    }),
  };
}

async function saveDraft() {
  const payload = composePayload();
  let email;
  if (state.compose.mode === 'new') {
    email = await api('/api/emails', { method: 'POST', body: JSON.stringify(payload) });
    state.compose.mode = 'edit';
    state.compose.id = email.id;
    $('compose-title').textContent = 'Edit email';
  } else {
    email = await api(`/api/emails/${state.compose.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }
  state.current = email;
  return email;
}

async function sendEmail(retry) {
  if (!state.auth.authenticated) {
    toast('Please sign in with Google first.', 'error');
    window.location.href = '/auth/google';
    return;
  }
  try {
    const email = await saveDraft();
    await api(`/api/emails/${email.id}/send`, {
      method: 'POST',
      body: JSON.stringify({ retry: !!retry }),
    });
    show('detail');
    await loadDetail(email.id);
    toast(retry ? 'Retrying failed recipients…' : 'Sending…');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* CSV import */
function csvToRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Normalize a CSV header into a template-safe variable name:
// lowercase, non-alphanumeric runs -> "_", trimmed of leading/trailing "_".
function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function importCSV(text) {
  const rows = csvToRows(text);
  if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row.');
  const headers = rows[0].map((h) => h.trim());

  // Identify special columns by their normalized name.
  const emailIdx = headers.findIndex((h) => slugify(h) === 'email');
  if (emailIdx === -1) throw new Error('CSV must include an "Email" column.');
  const nameIdx = headers.findIndex((h) => slugify(h) === 'name');

  // Remaining columns become template variables.
  const extra = [];
  const used = new Set(['email', 'name']);
  const counts = {};
  for (let i = 0; i < headers.length; i++) {
    if (i === emailIdx || i === nameIdx) continue;
    let key = slugify(headers[i]);
    if (!key) continue;
    if (used.has(key)) {
      counts[key] = (counts[key] || 1) + 1;
      key = `${key}_${counts[key]}`;
    }
    used.add(key);
    extra.push({ key, i });
  }

  const recipients = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const email = (rows[r][emailIdx] || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    const rec = { email, name: nameIdx >= 0 ? (rows[r][nameIdx] || '').trim() : '' };
    for (const { key, i } of extra) rec[key] = (rows[r][i] || '').trim();
    recipients.push(rec);
  }
  if (!recipients.length) throw new Error('No valid email rows found in CSV.');
  return recipients;
}

// Import recipients from a JSON array of objects, e.g.:
//   [ { "email": "a@x.com", "name": "A", "company": "Acme" }, ... ]
// "email"/"name" (case-insensitive) are recognized; every other key becomes a
// template variable (normalized to snake_case, like CSV headers).
function importJSONArray(data) {
  if (!Array.isArray(data)) throw new Error('JSON must be an array of objects.');

  const recipients = [];
  const seen = new Set();
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const norm = {};
    for (const [k, v] of Object.entries(item)) {
      const key = slugify(k);
      if (key) norm[key] = v;
    }

    const email = typeof norm.email === 'string' ? norm.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);

    const rec = { email, name: typeof norm.name === 'string' ? norm.name.trim() : '' };
    for (const [k, v] of Object.entries(norm)) {
      if (k === 'email' || k === 'name') continue;
      rec[k] = v;
    }
    recipients.push(rec);
  }

  if (!recipients.length) throw new Error('No valid recipients found in JSON.');
  return recipients;
}

// Detect a JSON array pasted into the textarea; returns null if it isn't one.
function parseJSONRecipients(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('[')) return null;
  let data;
  try {
    data = JSON.parse(t);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  return importJSONArray(data);
}

/* ---------------------------------------------------------------------------
 * Detail view
 * ------------------------------------------------------------------------- */

async function loadDetail(id) {
  const email = await api(`/api/emails/${id}`);
  state.current = email;
  renderDetail();
  if (email.status === 'sending') startPoll(); else stopPoll();
}

function renderDetail() {
  const e = state.current;
  if (!e) return;

  show('detail');
  $('detail-title').textContent = e.subject || '(no subject)';

  // Actions
  const actions = $('detail-actions');
  let html = '';
  if (e.status === 'draft') {
    html += `<button class="btn" id="act-edit">Edit</button>`;
    if (e.counts.not_sent > 0) html += `<button class="btn primary" id="act-send">Send</button>`;
    html += `<button class="btn danger" id="act-delete">Delete</button>`;
  } else if (e.status === 'sending') {
    html += `<span class="badge sending">Sending…</span>`;
  } else {
    if (e.counts.failed > 0) html += `<button class="btn primary" id="act-retry">Retry ${e.counts.failed} failed</button>`;
  }
  actions.innerHTML = html;

  const actEdit = $('act-edit');
  const actSend = $('act-send');
  const actDelete = $('act-delete');
  const actRetry = $('act-retry');
  if (actEdit) actEdit.addEventListener('click', () => openCompose(e));
  if (actSend) actSend.addEventListener('click', () => sendEmail(false));
  if (actDelete) actDelete.addEventListener('click', () => deleteEmail(e.id));
  if (actRetry) actRetry.addEventListener('click', () => sendEmail(true));

  let banner = '';
  if (e.status === 'sending') {
    banner = `<div class="banner warn">Sending in progress… this page updates automatically.</div>`;
  } else if (e.status === 'sent') {
    banner = `<div class="banner success">This email has been fully sent and is now immutable.</div>`;
  } else if (e.status === 'partial') {
    banner = `<div class="banner warn">Partially sent. This email is immutable — you can retry failed recipients.</div>`;
  }

  const attachments = e.attachments && e.attachments.length
    ? `<ul class="attachments-inline">${e.attachments
        .map(
          (a) =>
            `<li>📎 <a href="/api/emails/${e.id}/attachments/${a.id}/download">${esc(a.filename)}</a> <span class="muted">(${esc(humanSize(a.size))})</span></li>`
        )
        .join('')}</ul>`
    : '<span class="muted">None</span>';

  $('detail-container').innerHTML = `
    ${banner}
    <div class="detail-card">
      <h2>Message</h2>
      <div class="detail-meta">
        <div class="kv"><span class="k">Status</span> ${statusBadge(e.status)}</div>
        <div class="kv"><span class="k">Created</span> ${esc(fmtDate(e.created_at))}</div>
        ${e.sent_at ? `<div class="kv"><span class="k">Sent</span> ${esc(fmtDate(e.sent_at))}</div>` : ''}
        ${e.cc ? `<div class="kv"><span class="k">CC</span> ${esc(e.cc)}</div>` : ''}
        ${e.bcc ? `<div class="kv"><span class="k">BCC</span> ${esc(e.bcc)}</div>` : ''}
      </div>
      <div class="detail-body">${esc(e.body)}</div>
    </div>

    <div class="detail-card">
      <h2>Attachments</h2>
      ${attachments}
    </div>

    <div class="detail-card">
      <h2>Recipients (${e.counts.total})</h2>
      ${renderRecipientsTable(e)}
    </div>`;
}

function renderRecipientsTable(e) {
  if (!e.recipients.length) return '<p class="muted">No recipients.</p>';
  const rows = e.recipients
    .map((r) => {
      const statusLabel = { sent: 'Sent', failed: 'Failed', not_sent: 'Not sent' }[r.send_status] || r.send_status;
      const name = r.name ? `<div class="rec-name">${esc(r.name)}</div>` : '';
      const error = r.error ? `<div class="error-text">${esc(r.error)}</div>` : '';
      const gmail = r.gmail_url
        ? `<a class="btn sm" href="${esc(r.gmail_url)}" target="_blank" rel="noopener">Open in Gmail ↗</a>`
        : '';
      return `
        <tr>
          <td>
            <div class="rec-email">${esc(r.email)}</div>
            ${name}
          </td>
          <td><span class="badge ${esc(r.send_status)}">${esc(statusLabel)}</span></td>
          <td class="muted">${r.attempts || 0}</td>
          <td>${error}</td>
          <td>${gmail}</td>
        </tr>`;
    })
    .join('');
  return `
    <table class="recipients">
      <thead><tr><th>Recipient</th><th>Status</th><th>Attempts</th><th>Error</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function deleteEmail(id) {
  if (!confirm('Delete this draft? This cannot be undone.')) return;
  try {
    await api(`/api/emails/${id}`, { method: 'DELETE' });
    toast('Draft deleted');
    await showList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------------------------------------------------------------------
 * Attachments
 * ------------------------------------------------------------------------- */

async function addAttachment(files) {
  try {
    if (state.compose.mode === 'new') {
      await saveDraft();
    }
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/emails/${state.compose.id}/attachments`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
    }
    state.current = await api(`/api/emails/${state.compose.id}`);
    renderAttachments();
    toast('Attachment added');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeAttachment(attId) {
  try {
    await api(`/api/emails/${state.compose.id}/attachments/${attId}`, { method: 'DELETE' });
    state.current = await api(`/api/emails/${state.compose.id}`);
    renderAttachments();
    toast('Attachment removed');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------------------------------------------------------------------
 * Polling
 * ------------------------------------------------------------------------- */

function startPoll() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(async () => {
    try {
      if (state.view === 'detail' && state.current) {
        await loadDetail(state.current.id);
      } else if (state.view === 'list') {
        await loadList();
      } else {
        stopPoll();
      }
    } catch {
      /* ignore transient errors */
    }
  }, 2500);
}

function stopPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/* ---------------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------------- */

function init() {
  $('btn-new').addEventListener('click', () => openCompose(null));
  $('btn-back').addEventListener('click', showList);
  $('btn-back-2').addEventListener('click', showList);

  $('btn-save').addEventListener('click', async () => {
    try {
      await saveDraft();
      toast('Draft saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('btn-send').addEventListener('click', () => sendEmail(false));

  $('f-recipients').addEventListener('input', syncRecipientsFromTextarea);
  $('f-subject').addEventListener('input', updateVarsAndPreview);
  $('f-body').addEventListener('input', updateVarsAndPreview);

  $('btn-clear-recipients').addEventListener('click', () => {
    state.compose.recipients = [];
    state.compose.customFields = [];
    $('f-recipients').value = '';
    updateVarsAndPreview();
  });

  $('btn-import-csv').addEventListener('click', () => $('csv-input').click());
  $('csv-input').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state.compose.recipients = importCSV(reader.result);
        syncTextareaFromRecipients();
        updateVarsAndPreview();
        toast(`Imported ${state.compose.recipients.length} recipients from CSV`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        ev.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  $('btn-import-json').addEventListener('click', () => $('json-input').click());
  $('json-input').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state.compose.recipients = importJSONArray(JSON.parse(reader.result));
        syncTextareaFromRecipients();
        updateVarsAndPreview();
        toast(`Imported ${state.compose.recipients.length} recipients from JSON`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        ev.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  $('btn-add-attachment').addEventListener('click', () => $('attachment-input').click());
  $('attachment-input').addEventListener('change', (ev) => {
    if (ev.target.files.length) addAttachment([...ev.target.files]);
    ev.target.value = '';
  });

  loadAuth().then(loadSettings).then(loadList);
}

document.addEventListener('DOMContentLoaded', init);
