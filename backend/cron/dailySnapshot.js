const cron = require("node-cron");
const pool = require("../db/pool");
const { fetchRatesServerSide, computeSnapshot } = require("../lib/rates");

/** Takes a wealth snapshot for every user and appends/updates it in their history. */
async function takeDailySnapshot() {
  const rates = await fetchRatesServerSide();
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }); // YYYY-MM-DD

  const { rows } = await pool.query("SELECT username, data, history FROM kanz_users");
  let count = 0;

  for (const row of rows) {
    try {
      const snapshot = computeSnapshot(row.data || {}, rates, todayStr);
      const history = row.history || [];
      const idx = history.findIndex((h) => h.date === todayStr);
      idx >= 0 ? (history[idx] = snapshot) : history.push(snapshot);

      await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [
        JSON.stringify(history),
        row.username,
      ]);
      count++;
    } catch (err) {
      console.error(`Snapshot failed for ${row.username}:`, err.message);
    }
  }
  console.log(`✓ Daily snapshot done for ${count}/${rows.length} users`);
}

/** Only used when running as a persistent server (local dev / Docker). Not used on Vercel. */
function scheduleDailySnapshot() {
  cron.schedule("0 3 * * *", takeDailySnapshot, { timezone: "Africa/Cairo" });
  console.log("✓ Daily snapshot cron scheduled — 3 AM Cairo time");
}

module.exports = { scheduleDailySnapshot, takeDailySnapshot };
