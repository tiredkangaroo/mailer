const express = require('express');
const db = require('../db');
const gmail = require('../gmail');

const router = express.Router();

function requireAuth(req, res, next) {
  const email = req.signedCookies.gm;
  const token = db.getToken();
  if (!email || !token || token.email !== email) {
    return res.status(401).json({ error: 'Not authenticated with Google.' });
  }
  next();
}

router.get('/settings', (req, res) => {
  res.json({ from_name: db.getSetting('from_name') || '' });
});

// Save the sender's friendly display name. Stored locally (used in the From
// header) and, when authenticated, synced to the account's primary "Send mail
// as" display name so Gmail renders it reliably.
router.put('/settings', requireAuth, async (req, res) => {
  const fromName = String((req.body && req.body.from_name) || '').trim();
  db.setSetting('from_name', fromName);

  let gmail_display_name = null;
  let warning = null;

  if (fromName) {
    try {
      const updated = await gmail.updatePrimaryDisplayName(fromName);
      gmail_display_name = (updated && updated.displayName) || fromName;
    } catch (err) {
      warning = 'Saved locally, but could not update Gmail: ' + (err.message || String(err));
    }
  }

  res.json({ from_name: fromName, gmail_display_name, warning });
});

module.exports = router;
