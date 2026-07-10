const cron = require("node-cron");
const pool = require("../db/pool");
const { fetchRatesServerSide, computeSnapshot } = require("../lib/rates");

// Cap on item_history length per user, same rationale as the 730-day cap on
// `history` in routes/data.js: keeps the JSONB column (and any GET response)
// bounded even for an account that's been running for years. At one entry
// per item per day, this covers ~54 items x 5 years, or fewer items for longer.
const MAX_ITEM_HISTORY = 100000;

/**
 * Applies each item's APY as daily-compounded growth to its quantity, and
 * appends one item_history entry per (itemId, date). `apy` values live in
 * `data.apy` (percent per year, set by the user next to the item in the UI).
 * Idempotent: if an entry for (itemId, todayStr) already exists, that item is
 * skipped — so re-running the cron twice in the same target hour (the route
 * fires hourly and just checks the Cairo hour, see routes/cron.js) can never
 * double-apply a day's growth.
 *
 * Returns { data, itemHistory } — the possibly-updated `data` (with new qty
 * values) and the possibly-updated item_history array, or null if nothing
 * changed for this user (no apy set on anything, or already applied today).
 */
function applyItemGrowth(data, itemHistory, todayStr) {
  const apy = (data && data.apy) || {};
  const qty = (data && data.qty) || {};
  const ids = Object.keys(apy).filter((id) => apy[id] > 0 && qty[id] > 0);
  if (ids.length === 0) return null;

  let changed = false;
  const nextQty = { ...qty };
  const nextHistory = [...itemHistory];

  for (const id of ids) {
    if (nextHistory.some((e) => e.itemId === id && e.date === todayStr)) continue; // already applied today

    const before = nextQty[id];
    // Daily-compounded rate that reaches `apy`% over 365 days.
    const dailyRate = Math.pow(1 + apy[id] / 100, 1 / 365) - 1;
    const after = before * (1 + dailyRate);

    nextQty[id] = after;
    nextHistory.push({ itemId: id, date: todayStr, before, after, delta: after - before, apy: apy[id] });
    changed = true;
  }

  if (!changed) return null;

  nextHistory.sort((a, b) => (a.date === b.date ? a.itemId.localeCompare(b.itemId) : a.date.localeCompare(b.date)));
  const trimmed = nextHistory.length > MAX_ITEM_HISTORY ? nextHistory.slice(-MAX_ITEM_HISTORY) : nextHistory;

  return { data: { ...data, qty: nextQty }, itemHistory: trimmed };
}

/** Takes a wealth snapshot for every user and appends/updates it in their history. */
async function takeDailySnapshot() {
  const rates = await fetchRatesServerSide();
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }); // YYYY-MM-DD

  const { rows } = await pool.query("SELECT username, data, history, item_history FROM kanz_users");
  let count = 0;

  for (const row of rows) {
    try {
      // Apply per-item APY growth first, so today's aggregate snapshot below
      // already reflects any interest credited today.
      const grown = applyItemGrowth(row.data || {}, row.item_history || [], todayStr);
      const data = grown ? grown.data : row.data || {};

      const snapshot = computeSnapshot(data, rates, todayStr);
      const history = row.history || [];
      const idx = history.findIndex((h) => h.date === todayStr);
      idx >= 0 ? (history[idx] = snapshot) : history.push(snapshot);

      if (grown) {
        await pool.query("UPDATE kanz_users SET data = $1, history = $2, item_history = $3 WHERE username = $4", [
          JSON.stringify(data),
          JSON.stringify(history),
          JSON.stringify(grown.itemHistory),
          row.username,
        ]);
      } else {
        await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [
          JSON.stringify(history),
          row.username,
        ]);
      }
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

module.exports = { scheduleDailySnapshot, takeDailySnapshot, applyItemGrowth };
