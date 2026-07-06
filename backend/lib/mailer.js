const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("⚠ إعدادات SMTP ناقصة في .env — تنبيهات الإيميل مش هتشتغل لحد ما تضيفها.");
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendMail(to, subject, text) {
  const t = getTransporter();
  if (!t) return false;
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  return true;
}

module.exports = { sendMail };
