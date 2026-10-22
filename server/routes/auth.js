const express = require('express');
const crypto = require('crypto');
const { CLIENT_ID, CLIENT_SECRET } = require('../config');
const gmail = require('../gmail');
const db = require('../db');

const router = express.Router();

router.get('/google', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res
      .status(500)
      .send(
        'Missing Google OAuth credentials. Copy .env.example to .env and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
      );
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(gmail.getAuthUrl(state));
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?auth_error=' + encodeURIComponent(error));
  if (!code) return res.redirect('/?auth_error=' + encodeURIComponent('No authorization code received.'));

  const expected = req.signedCookies.oauth_state;
  res.clearCookie('oauth_state');
  if (!state || state !== expected) {
    return res.status(400).send('OAuth state mismatch. Please try signing in again.');
  }

  try {
    const email = await gmail.exchangeCode(code);
    res.cookie('gm', email, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    res.redirect('/?auth_error=' + encodeURIComponent(err.message));
  }
});

router.get('/status', (req, res) => {
  const email = req.signedCookies.gm;
  const token = db.getToken();
  const authenticated = Boolean(email && token && token.email === email);
  res.json({ authenticated, email: authenticated ? email : null });
});

router.post('/logout', (req, res) => {
  res.clearCookie('gm');
  db.clearToken();
  res.json({ ok: true });
});

module.exports = router;
