const cron = require("node-cron");
const pool = require("../db/pool");
const { fetchRatesServerSide, computeSnapshot } = require("../lib/rates");

async function takeDailySnapshot() {
  console.log("⏰ Running daily snapshot...");
  try {
    const rates = await fetchRatesServerSide();
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }); // YYYY-MM-DD

    const { rows } = await pool.query("SELECT username, data, history FROM kanz_users");
    for (const row of rows) {
      try {
        const data = row.data || {};
        const history = row.history || [];
        const snap = computeSnapshot(data, rates, todayStr);

        const idx = history.findIndex((h) => h.date === todayStr);
        if (idx >= 0) history[idx] = snap; else history.push(snap);

        await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [JSON.stringify(history), row.username]);
      } catch (err) {
        console.error("Snapshot failed for", row.username, err.message);
      }
    }
    console.log("✓ Daily snapshot done for", rows.length, "users");
  } catch (err) {
    console.error("takeDailySnapshot error:", err.message);
  }
}

/** بيشغّل المهمة الساعة 3 صباحًا بتوقيت القاهرة كل يوم */
function scheduleDailySnapshot() {
  cron.schedule("0 3 * * *", takeDailySnapshot, { timezone: "Africa/Cairo" });
  console.log("✓ Daily snapshot cron scheduled — 3 AM Cairo time");
}

module.exports = { scheduleDailySnapshot, takeDailySnapshot };
