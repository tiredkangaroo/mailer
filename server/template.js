// Simple {{ variable }} templating engine.

function renderTemplate(source, data) {
  return String(source || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const k = key.trim();
    const val = data[k];
    return val === undefined || val === null ? match : String(val);
  });
}

// Build the template data object for a recipient row.
function recipientData(recipient) {
  let data = {};
  try {
    data = JSON.parse(recipient.data || '{}');
  } catch {
    data = {};
  }
  return { name: recipient.name || '', email: recipient.email, ...data };
}

module.exports = { renderTemplate, recipientData };
