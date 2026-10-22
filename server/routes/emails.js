const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const db = require('../db');
const gmail = require('../gmail');
const { parseRecipientText, normalizeRecipients } = require('../recipients');
const { renderTemplate, recipientData } = require('../template');
const { buildRawMime } = require('../mail');
const { UPLOAD_DIR } = require('../config');

const router = express.Router();
const inFlight = new Set();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  const email = req.signedCookies.gm;
  const token = db.getToken();
  if (!email || !token || token.email !== email) {
    return res.status(401).json({ error: 'Not authenticated with Google. Sign in to send email.' });
  }
  req.gmailUser = email;
  next();
}

function gmailUrl(messageId) {
  return messageId ? `https://mail.google.com/mail/u/0/#sent/${messageId}` : null;
}

function recipientJson(r) {
  let data = {};
  try {
    data = JSON.parse(r.data || '{}');
  } catch {
    data = {};
  }
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    data,
    send_status: r.send_status,
    gmail_message_id: r.gmail_message_id,
    gmail_thread_id: r.gmail_thread_id,
    gmail_url: gmailUrl(r.gmail_message_id),
    error: r.error,
    attempts: r.attempts,
    sent_at: r.sent_at,
  };
}

function emailJson(email) {
  if (!email) return null;
  const recipients = db.getRecipients(email.id).map(recipientJson);
  const attachments = db.getAttachments(email.id).map((a) => ({
    id: a.id,
    filename: a.filename,
    mime_type: a.mime_type,
    size: a.size,
  }));
  const counts = db.countByStatus(email.id);
  return { ...email, recipients, attachments, counts };
}

// ---------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------

router.get('/emails', (req, res) => {
  res.json(db.listEmails());
});

router.get('/emails/:id', (req, res) => {
  const email = db.getEmail(Number(req.params.id));
  if (!email) return res.status(404).json({ error: 'Email not found.' });
  res.json(emailJson(email));
});

// ---------------------------------------------------------------------------
// Create / update / delete (drafts only for update/delete)
// ---------------------------------------------------------------------------

router.post('/emails', (req, res) => {
  const { subject, body, cc, bcc, recipientsText, recipients } = req.body || {};
  const email = db.createEmail({ subject, body, cc, bcc });

  const recs =
    recipients && Array.isArray(recipients) && recipients.length > 0
      ? normalizeRecipients(recipients)
      : parseRecipientText(recipientsText);

  if (recs.length) db.replaceRecipients(email.id, recs);
  res.status(201).json(emailJson(db.getEmail(email.id)));
});

router.patch('/emails/:id', (req, res) => {
  const email = db.getEmail(Number(req.params.id));
  if (!email) return res.status(404).json({ error: 'Email not found.' });
  if (email.status !== 'draft') {
    return res.status(400).json({ error: 'This email has already been sent and is immutable.' });
  }

  const { subject, body, cc, bcc, recipientsText, recipients } = req.body || {};
  db.updateEmail(email.id, {
    subject: subject !== undefined ? subject : email.subject,
    body: body !== undefined ? body : email.body,
    cc: cc !== undefined ? cc : email.cc,
    bcc: bcc !== undefined ? bcc : email.bcc,
  });

  if (recipients !== undefined || recipientsText !== undefined) {
    const recs =
      recipients && Array.isArray(recipients)
        ? normalizeRecipients(recipients)
        : parseRecipientText(recipientsText);
    db.replaceRecipients(email.id, recs);
  }

  res.json(emailJson(db.getEmail(email.id)));
});

router.delete('/emails/:id', (req, res) => {
  const email = db.getEmail(Number(req.params.id));
  if (!email) return res.status(404).json({ error: 'Email not found.' });
  if (email.status !== 'draft') {
    return res.status(400).json({ error: 'Sent emails are immutable and cannot be deleted.' });
  }
  for (const a of db.getAttachments(email.id)) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, a.stored_name));
    } catch {}
  }
  db.deleteEmail(email.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Attachments (drafts only)
// ---------------------------------------------------------------------------

router.post('/emails/:id/attachments', upload.single('file'), (req, res) => {
  const email = db.getEmail(Number(req.params.id));
  if (!email) return res.status(404).json({ error: 'Email not found.' });
  if (email.status !== 'draft') {
    return res.status(400).json({ error: 'This email has already been sent and is immutable.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const att = db.addAttachment({
    email_id: email.id,
    filename: req.file.originalname,
    stored_name: req.file.filename,
    mime_type: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
  });
  res.status(201).json(att);
});

router.delete('/emails/:id/attachments/:attId', (req, res) => {
  const email = db.getEmail(Number(req.params.id));
  if (!email) return res.status(404).json({ error: 'Email not found.' });
  if (email.status !== 'draft') {
    return res.status(400).json({ error: 'This email has already been sent and is immutable.' });
  }
  const att = db.getAttachment(Number(req.params.attId));
  if (!att || att.email_id !== email.id) return res.status(404).json({ error: 'Attachment not found.' });
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, att.stored_name));
  } catch {}
  db.deleteAttachment(att.id);
  res.json({ ok: true });
});

router.get('/emails/:id/attachments/:attId/download', (req, res) => {
  const att = db.getAttachment(Number(req.params.attId));
  if (!att) return res.status(404).json({ error: 'Attachment not found.' });
  const filePath = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk.' });
  res.download(filePath, att.filename);
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

router.post('/emails/:id/send', requireAuth, (req, res) => {
  const email = db.getEmail(Number(req.params.id));
  if (!email) return res.status(404).json({ error: 'Email not found.' });
  if (email.status === 'sending') return res.status(409).json({ error: 'A send is already in progress.' });
  if (email.status === 'sent') return res.status(400).json({ error: 'All recipients have already been sent.' });

  const retry = Boolean(req.body && req.body.retry);
  const statuses = retry ? ['failed'] : ['not_sent'];
  const targets = db.getRecipients(email.id).filter((r) => statuses.includes(r.send_status));

  if (targets.length === 0) {
    const msg = retry ? 'No failed recipients to retry.' : 'No pending recipients to send.';
    return res.status(400).json({ error: msg });
  }

  db.setEmailStatus(email.id, 'sending');
  startSend(email.id, statuses);
  res.status(202).json({ ok: true, queued: targets.length });
});

function startSend(emailId, statuses) {
  if (inFlight.has(emailId)) return;
  inFlight.add(emailId);

  (async () => {
    try {
      const token = db.getToken();
      const fromEmail = token ? token.email : null;
      const fromName = db.getSetting('from_name');
      const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
      const attachments = db
        .getAttachments(emailId)
        .map((a) => {
          try {
            return {
              filename: a.filename,
              mime_type: a.mime_type,
              content: fs.readFileSync(path.join(UPLOAD_DIR, a.stored_name)),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const targets = db.getRecipients(emailId).filter((r) => statuses.includes(r.send_status));
      for (const r of targets) {
        const email = db.getEmail(emailId);
        const data = recipientData(r);
        const subject = renderTemplate(email.subject, data);
        const body = renderTemplate(email.body, data);
        const cc = renderTemplate(email.cc, data);
        const bcc = renderTemplate(email.bcc, data);

        try {
          const raw = await buildRawMime({
            from,
            to: r.email,
            cc,
            bcc,
            subject,
            text: body,
            attachments,
          });
          const { id, threadId } = await gmail.sendRaw(raw);
          db.markRecipientSent(r.id, id, threadId);
          db.setEmailSentAt(emailId);
        } catch (err) {
          db.markRecipientFailed(r.id, err.message || String(err));
        }
      }
    } finally {
      db.recomputeEmailStatus(emailId);
      inFlight.delete(emailId);
    }
  })();
}

module.exports = router;
