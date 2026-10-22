// Compose a raw RFC 2822 MIME message using nodemailer's stream transport,
// which yields the fully-encoded message (including attachments) as a Buffer.
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });

async function buildRawMime({ from, to, cc, bcc, subject, text, attachments }) {
  const mailOptions = {
    from,
    to,
    subject: subject || '',
    text: text || '',
  };

  if (cc) mailOptions.cc = cc;
  if (bcc) mailOptions.bcc = bcc;
  if (attachments && attachments.length) {
    mailOptions.attachments = attachments.map((a) => ({
      filename: a.filename,
      contentType: a.mime_type || 'application/octet-stream',
      content: a.content,
    }));
  }

  const info = await transporter.sendMail(mailOptions);
  // info.message is a Buffer containing the raw MIME message.
  return Buffer.from(info.message).toString('base64url');
}

module.exports = { buildRawMime };
