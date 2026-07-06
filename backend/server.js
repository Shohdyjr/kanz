require("dotenv").config();
const express = require("express");
const cors = require("cors");

const initDb = require("./db/init");
const authRoutes = require("./routes/auth");
const dataRoutes = require("./routes/data");
const ratesRoutes = require("./routes/rates");
const { scheduleDailySnapshot } = require("./cron/dailySnapshot");
const { schedulePriceAlerts } = require("./cron/priceAlerts");

const app = express();
app.use(express.json());

// CORS: بنسمح بس لرابط الواجهة الأمامية بتاعتك (حطه في .env)
const allowedOrigin = process.env.FRONTEND_ORIGIN || "*";
app.use(cors({ origin: allowedOrigin }));

app.get("/", (req, res) => res.json({ ok: true, service: "kanz-backend" }));
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api", dataRoutes);   // /api/data, /api/history, /api/alerts
app.use("/api", ratesRoutes);  // /api/historical-rate, /api/benchmark

const PORT = process.env.PORT || 3000;

async function start() {
  await initDb();
  scheduleDailySnapshot();
  schedulePriceAlerts();
  app.listen(PORT, () => console.log(`✓ Kanz backend running on port ${PORT}`));
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
