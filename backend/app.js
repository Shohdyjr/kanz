require("dotenv").config();
const express = require("express");
const cors = require("cors");

const initDb = require("./db/init");
const authRoutes = require("./routes/auth");
const dataRoutes = require("./routes/data");
const ratesRoutes = require("./routes/rates");
const cronRoutes = require("./routes/cron");

const app = express();
app.use(express.json());

// CORS: بنسمح بس لرابط الواجهة الأمامية بتاعتك (حطه في .env / Environment Variables)
const allowedOrigin = process.env.FRONTEND_ORIGIN || "*";
app.use(cors({ origin: allowedOrigin }));

// ── تأكيد إن قاعدة البيانات جاهزة قبل أي طلب ──
// في بيئة serverless (Vercel) الكود بينفّذ من الصفر كل شوية (Cold Start)، فبنتأكد
// إن initDb() اتنفذت مرة واحدة بس لكل نسخة تشغيل (مش هتتكرر مع كل طلب).
let dbReadyPromise = null;
app.use((req, res, next) => {
  if (!dbReadyPromise) dbReadyPromise = initDb();
  dbReadyPromise
    .then(() => next())
    .catch((err) => {
      console.error("initDb failed:", err);
      res.status(500).json({ ok: false, error: "dbInitFailed" });
    });
});

app.get("/", (req, res) => res.json({ ok: true, service: "kanz-backend" }));
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api", dataRoutes);   // /api/data, /api/history, /api/alerts
app.use("/api", ratesRoutes);  // /api/historical-rate, /api/benchmark
app.use("/api/cron", cronRoutes); // /api/cron/daily-snapshot, /api/cron/price-alerts

module.exports = app;
