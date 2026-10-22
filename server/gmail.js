const { google } = require('googleapis');
const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, SCOPES } = require('./config');
const db = require('./db');

function oauth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function getAuthUrl(state) {
  return oauth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

// Decode the payload of an OpenID Connect id_token (a JWT) without verifying it —
// we only need the "email" claim here, and the token came directly from Google's
// token endpoint over TLS.
function decodeIdTokenPayload(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

// Exchange the authorization code, determine the account email, and store tokens.
async function exchangeCode(code) {
  const client = oauth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // The signed-in account's email comes from the id_token (openid/email scopes),
  // which does not require any Gmail read scope.
  let email = decodeIdTokenPayload(tokens.id_token).email || null;

  if (!email) {
    // Fallback: the userinfo endpoint, available with the openid scope.
    const { data } = await client.request({
      url: 'https://openidconnect.googleapis.com/v1/userinfo',
    });
    email = (data && data.email) || null;
  }

  if (!email) {
    throw new Error('Could not determine the signed-in email address.');
  }

  db.upsertToken({
    email,
    access_token: tokens.access_token || null,
    refresh_token: tokens.refresh_token || null,
    expiry_date: tokens.expiry_date || null,
  });

  return email;
}

// Return an authorized gmail client, refreshing + persisting tokens as needed.
async function getAuthorizedGmail() {
  const token = db.getToken();
  if (!token || !token.refresh_token) {
    const err = new Error('Not authenticated with Google. Sign in first.');
    err.status = 401;
    throw err;
  }

  const client = oauth2Client();
  client.setCredentials({
    refresh_token: token.refresh_token,
    access_token: token.access_token || undefined,
    expiry_date: token.expiry_date || undefined,
  });

  await client.getAccessToken(); // refreshes automatically when expired

  const c = client.credentials;
  db.upsertToken({
    email: token.email,
    access_token: c.access_token || null,
    refresh_token: c.refresh_token || token.refresh_token,
    expiry_date: c.expiry_date || null,
  });

  return google.gmail({ version: 'v1', auth: client });
}

// Send a raw (RFC 2822, base64url-encoded) message via the Gmail API.
async function sendRaw(rawBase64Url) {
  const gmailClient = await getAuthorizedGmail();
  const res = await gmailClient.users.messages.send({
    userId: 'me',
    requestBody: { raw: rawBase64Url },
  });
  return { id: res.data.id, threadId: res.data.threadId };
}

// Set the friendly display name for the account's primary "Send mail as" alias.
// Gmail uses this name for the "From:" header on outgoing mail, which is why a
// name set only in a raw message's From header may be overridden.
async function updatePrimaryDisplayName(displayName) {
  const gmailClient = await getAuthorizedGmail();
  const token = db.getToken();
  const res = await gmailClient.users.settings.sendAs.patch({
    userId: 'me',
    sendAsEmail: token.email,
    requestBody: { displayName },
  });
  return res.data;
}

module.exports = { getAuthUrl, exchangeCode, getAuthorizedGmail, sendRaw, updatePrimaryDisplayName };
