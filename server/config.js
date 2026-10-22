require('dotenv').config();
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'mailer.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// Scopes:
//  - gmail.send: send as the authenticated user
//  - gmail.settings.basic: update the primary "Send mail as" display name so the
//    sender's friendly name appears correctly on outgoing mail
//  - openid/email: identify the signed-in account (via the OIDC id_token), used as
//    the "from" address. These do NOT grant any mailbox read access.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'openid',
  'email',
];

module.exports = {
  PORT,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  SESSION_SECRET,
  DB_PATH,
  UPLOAD_DIR,
  SCOPES,
};
