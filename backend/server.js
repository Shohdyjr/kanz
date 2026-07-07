const env = require("./config/env");
const app = require("./app");
const { scheduleDailySnapshot } = require("./cron/dailySnapshot");
const { schedulePriceAlerts } = require("./cron/priceAlerts");

// Only used for local development or a persistent-server deployment (e.g. Docker).
// On Vercel, scheduling works differently — see vercel.json and routes/cron.js.
app.listen(env.port, () => {
  console.log(`✓ Kanz backend running on port ${env.port}`);
  scheduleDailySnapshot();
  schedulePriceAlerts();
});
