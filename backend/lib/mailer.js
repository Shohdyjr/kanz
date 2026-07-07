const nodemailer = require("nodemailer");
const env = require("../config/env");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) return null;

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
  return transporter;
}

/** Sends a plain-text email. Returns false silently if SMTP isn't configured. */
async function sendMail(to, subject, text) {
  const t = getTransporter();
  if (!t) return false;
  await t.sendMail({ from: env.smtp.from, to, subject, text });
  return true;
}

module.exports = { sendMail };
