const nodemailer = require("nodemailer");
const env = require("../config/env");

let cachedTransporter = null;

function getTransporter() {
  if (!env.smtp.host) return null;
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465, // 465 = implicit TLS; 587/25 use STARTTLS instead
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return cachedTransporter;
}

/**
 * Sends the password-reset OTP by email. If SMTP isn't configured (e.g. in
 * local dev), the code is logged instead of thrown away, so the reset flow
 * stays fully testable without a real mail account — see config/env.js.
 * Returns true only if an actual send was attempted.
 */
async function sendOtpEmail(to, otp) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`sendOtpEmail: SMTP not configured — OTP for ${to} is ${otp} (would expire in 10 minutes)`);
    return false;
  }

  await transporter.sendMail({
    from: env.smtp.from,
    to,
    subject: "Kanz — Your password reset code",
    text: `Your Kanz password reset code is ${otp}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto">
        <p>Your Kanz password reset code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${otp}</p>
        <p style="color:#666;font-size:13px">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });
  return true;
}

module.exports = { sendOtpEmail };
