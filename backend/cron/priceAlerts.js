const cron = require("node-cron");
const pool = require("../db/pool");
const { fetchRatesServerSide } = require("../lib/rates");
const { sendMail } = require("../lib/mailer");

/** Emails users whose gold/USD price targets have just been reached (fires once per target). */
async function checkPriceAlerts() {
  const rates = await fetchRatesServerSide();
  const { rows } = await pool.query("SELECT username, data FROM kanz_users");

  for (const row of rows) {
    const alerts = row.data?.priceAlerts;
    if (!alerts?.email) continue;

    let changed = false;

    if (alerts.goldTarget > 0 && !alerts.goldFired && rates.goldUsdPerGram >= alerts.goldTarget) {
      await sendMail(
        alerts.email,
        "Kanz — Gold Price Alert",
        `Gold reached $${rates.goldUsdPerGram.toFixed(2)}/gram (your target was $${alerts.goldTarget}).`
      );
      alerts.goldFired = true;
      changed = true;
    }

    if (alerts.usdEgpTarget > 0 && !alerts.usdEgpFired && rates.egpPerUsd >= alerts.usdEgpTarget) {
      await sendMail(
        alerts.email,
        "Kanz — USD/EGP Price Alert",
        `USD reached ${rates.egpPerUsd.toFixed(2)} EGP (your target was ${alerts.usdEgpTarget}).`
      );
      alerts.usdEgpFired = true;
      changed = true;
    }

    if (changed) {
      const data = { ...row.data, priceAlerts: alerts };
      await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [JSON.stringify(data), row.username]);
    }
  }
}

/** Only used when running as a persistent server (local dev / Docker). Not used on Vercel. */
function schedulePriceAlerts() {
  cron.schedule("0 */3 * * *", checkPriceAlerts);
  console.log("✓ Price alerts cron scheduled — every 3 hours");
}

module.exports = { schedulePriceAlerts, checkPriceAlerts };
