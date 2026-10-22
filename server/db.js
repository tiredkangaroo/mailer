const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cc TEXT NOT NULL DEFAULT '',
  bcc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | sending | sent | partial
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',        -- JSON object of custom template fields
  send_status TEXT NOT NULL DEFAULT 'not_sent',  -- not_sent | sent | failed
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  UNIQUE(email_id, email)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expiry_date INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_recipients_email_id ON recipients(email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
`);

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

const listEmailsStmt = db.prepare(`
  SELECT e.id, e.subject, e.body, e.cc, e.bcc, e.status, e.sent_at, e.created_at, e.updated_at,
         COUNT(r.id) AS total,
         COALESCE(SUM(CASE WHEN r.send_status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
         COALESCE(SUM(CASE WHEN r.send_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN r.send_status = 'not_sent' THEN 1 ELSE 0 END), 0) AS not_sent
  FROM emails e
  LEFT JOIN recipients r ON r.email_id = e.id
  GROUP BY e.id
  ORDER BY e.created_at DESC
`);

const getEmailStmt = db.prepare('SELECT * FROM emails WHERE id = ?');

function listEmails() {
  return listEmailsStmt.all();
}

function getEmail(id) {
  return getEmailStmt.get(id);
}

function createEmail({ subject, body, cc, bcc }) {
  const ts = now();
  const res = db
    .prepare(
      'INSERT INTO emails (subject, body, cc, bcc, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(subject || '', body || '', cc || '', bcc || '', 'draft', ts, ts);
  return getEmail(Number(res.lastInsertRowid));
}

function updateEmail(id, { subject, body, cc, bcc }) {
  db.prepare('UPDATE emails SET subject = ?, body = ?, cc = ?, bcc = ?, updated_at = ? WHERE id = ?').run(
    subject,
    body,
    cc,
    bcc,
    now(),
    id
  );
  return getEmail(id);
}

function deleteEmail(id) {
  db.prepare('DELETE FROM emails WHERE id = ?').run(id);
}

function setEmailStatus(id, status) {
  db.prepare('UPDATE emails SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
}

function setEmailSentAt(id) {
  db.prepare('UPDATE emails SET sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?').run(
    now(),
    now(),
    id
  );
}

function recomputeEmailStatus(id) {
  const counts = countByStatus(id);
  let status;
  if (counts.total > 0 && counts.sent === counts.total) status = 'sent';
  else if (counts.sent > 0) status = 'partial';
  else status = 'draft';

  if (counts.sent > 0) {
    db.prepare('UPDATE emails SET status = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?').run(
      status,
      now(),
      now(),
      id
    );
  } else {
    db.prepare('UPDATE emails SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  }
}

// Recover any email left in "sending" after a crash/restart.
function recoverSending() {
  const stuck = db.prepare("SELECT id FROM emails WHERE status = 'sending'").all();
  for (const row of stuck) recomputeEmailStatus(row.id);
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

const getRecipientsStmt = db.prepare('SELECT * FROM recipients WHERE email_id = ? ORDER BY id ASC');

function getRecipients(emailId) {
  return getRecipientsStmt.all(emailId);
}

function replaceRecipients(emailId, recipients) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM recipients WHERE email_id = ?').run(emailId);
    const insert = db.prepare(
      'INSERT INTO recipients (email_id, email, name, data, send_status) VALUES (?, ?, ?, ?, ?)'
    );
    for (const r of recipients) {
      insert.run(
        emailId,
        r.email,
        r.name || '',
        JSON.stringify(r.data || {}),
        'not_sent'
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function countByStatus(emailId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN send_status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
              COALESCE(SUM(CASE WHEN send_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN send_status = 'not_sent' THEN 1 ELSE 0 END), 0) AS not_sent
       FROM recipients WHERE email_id = ?`
    )
    .get(emailId);
  return {
    total: Number(row.total),
    sent: Number(row.sent),
    failed: Number(row.failed),
    not_sent: Number(row.not_sent),
  };
}

function markRecipientSent(recipientId, gmailMessageId, gmailThreadId) {
  db.prepare(
    `UPDATE recipients
     SET send_status = 'sent', gmail_message_id = ?, gmail_thread_id = ?, error = NULL, attempts = attempts + 1, sent_at = ?
     WHERE id = ?`
  ).run(gmailMessageId, gmailThreadId, now(), recipientId);
}

function markRecipientFailed(recipientId, error) {
  db.prepare(
    `UPDATE recipients
     SET send_status = 'failed', error = ?, attempts = attempts + 1
     WHERE id = ?`
  ).run(error ? String(error).slice(0, 2000) : 'Unknown error', recipientId);
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

const getAttachmentsStmt = db.prepare('SELECT * FROM attachments WHERE email_id = ? ORDER BY id ASC');
const getAttachmentStmt = db.prepare('SELECT * FROM attachments WHERE id = ?');

function getAttachments(emailId) {
  return getAttachmentsStmt.all(emailId);
}

function getAttachment(id) {
  return getAttachmentStmt.get(id);
}

function addAttachment({ email_id, filename, stored_name, mime_type, size }) {
  const res = db
    .prepare(
      'INSERT INTO attachments (email_id, filename, stored_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(email_id, filename, stored_name, mime_type, size, now());
  return getAttachment(Number(res.lastInsertRowid));
}

function deleteAttachment(id) {
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// OAuth token (single-user)
// ---------------------------------------------------------------------------

const getTokenStmt = db.prepare('SELECT * FROM tokens WHERE id = 1');

function getToken() {
  return getTokenStmt.get();
}

function upsertToken({ email, access_token, refresh_token, expiry_date }) {
  db.prepare(
    `INSERT INTO tokens (id, email, access_token, refresh_token, expiry_date, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expiry_date = excluded.expiry_date,
       updated_at = excluded.updated_at`
  ).run(email, access_token || null, refresh_token || null, expiry_date || null, now());
}

function clearToken() {
  db.prepare('DELETE FROM tokens WHERE id = 1').run();
}

// ---------------------------------------------------------------------------
// Settings (key/value)
// ---------------------------------------------------------------------------

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value === null || value === undefined ? null : String(value));
}

module.exports = {
  listEmails,
  getEmail,
  createEmail,
  updateEmail,
  deleteEmail,
  setEmailStatus,
  setEmailSentAt,
  recomputeEmailStatus,
  recoverSending,
  getRecipients,
  replaceRecipients,
  countByStatus,
  markRecipientSent,
  markRecipientFailed,
  getAttachments,
  getAttachment,
  addAttachment,
  deleteAttachment,
  getToken,
  upsertToken,
  clearToken,
  getSetting,
  setSetting,
};
