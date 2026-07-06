const cron = require("node-cron");
const pool = require("../db/pool");
const { fetchRatesServerSide } = require("../lib/rates");
const { sendMail } = require("../lib/mailer");

async function checkPriceAlerts() {
  console.log("🔔 Checking price alerts...");
  try {
    const rates = await fetchRatesServerSide();
    const { rows } = await pool.query("SELECT username, data FROM kanz_users");

    for (const row of rows) {
      try {
        const data = row.data || {};
        const alerts = data.priceAlerts;
        if (!alerts || !alerts.email) continue;

        let changed = false;

        if (alerts.goldTarget > 0 && !alerts.goldFired && rates.goldUsdPerGram >= alerts.goldTarget) {
          await sendMail(
            alerts.email,
            "Kanz — تنبيه سعر الذهب",
            `سعر جرام الذهب وصل لـ $${rates.goldUsdPerGram.toFixed(2)} (كان هدفك $${alerts.goldTarget}).\n\nافتح تطبيق Kanz عشان تحدّث هدف جديد لو حبيت.`
          );
          alerts.goldFired = true;
          changed = true;
        }

        if (alerts.usdEgpTarget > 0 && !alerts.usdEgpFired && rates.egpPerUsd >= alerts.usdEgpTarget) {
          await sendMail(
            alerts.email,
            "Kanz — تنبيه سعر الدولار",
            `سعر الدولار وصل لـ ${rates.egpPerUsd.toFixed(2)} جنيه (كان هدفك ${alerts.usdEgpTarget} جنيه).\n\nافتح تطبيق Kanz عشان تحدّث هدف جديد لو حبيت.`
          );
          alerts.usdEgpFired = true;
          changed = true;
        }

        if (changed) {
          data.priceAlerts = alerts;
          await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [JSON.stringify(data), row.username]);
        }
      } catch (err) {
        console.error("checkPriceAlerts failed for", row.username, err.message);
      }
    }
  } catch (err) {
    console.error("checkPriceAlerts error:", err.message);
  }
}

/** بيفحص كل 3 ساعات */
function schedulePriceAlerts() {
  cron.schedule("0 */3 * * *", checkPriceAlerts);
  console.log("✓ Price alerts cron scheduled — every 3 hours");
}

module.exports = { schedulePriceAlerts, checkPriceAlerts };
