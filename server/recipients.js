// Parsing of recipient input.
// Supports comma/newline separated addresses and the "Name <email>" format.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s) {
  return EMAIL_RE.test(String(s || '').trim());
}

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase();
}

// Parse a free-text list of recipients (comma/newline separated).
// Each entry may be "email" or "Name <email>".
function parseRecipientText(text) {
  const map = new Map();
  const items = String(text || '').split(/[\n,;]+/);
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;

    let name = '';
    let email = item;
    const m = item.match(/^(.*?)<([^>]+)>$/);
    if (m) {
      name = m[1].trim();
      email = m[2].trim();
    }

    email = normalizeEmail(email);
    if (!isValidEmail(email)) continue;

    if (!map.has(email)) {
      map.set(email, { email, name, data: {} });
    } else if (name && !map.get(email).name) {
      map.get(email).name = name;
    }
  }
  return [...map.values()];
}

// Normalize a header/key into a template-safe variable name:
// lowercase, non-alphanumeric runs -> "_", trimmed of leading/trailing "_".
function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Normalize a structured recipient array: [{ email, name?, ...customFields }].
// Unknown keys become the "data" template object, with keys slugified so they
// always work as {{ variables }} (e.g. "Company Name" -> "company_name").
function normalizeRecipients(input) {
  const map = new Map();
  for (const r of input || []) {
    if (!r || !r.email) continue;
    const email = normalizeEmail(r.email);
    if (!isValidEmail(email) || map.has(email)) continue;
    const { email: _email, name, ...rest } = r;
    const data = {};
    for (const [k, v] of Object.entries(rest || {})) {
      const key = slugify(k);
      if (key) data[key] = v;
    }
    map.set(email, { email, name: name || '', data });
  }
  return [...map.values()];
}

module.exports = { parseRecipientText, normalizeRecipients, isValidEmail, normalizeEmail };
