const env = require("./config/env");
const app = require("./app");
const { scheduleDailySnapshot } = require("./cron/dailySnapshot");

// Only used for local development or a persistent-server deployment (e.g. Docker).
// On Vercel, the daily snapshot runs via Vercel Cron instead — see vercel.json.
app.listen(env.port, () => {
  console.log(`✓ Kanz backend running on port ${env.port}`);
  scheduleDailySnapshot();
});
