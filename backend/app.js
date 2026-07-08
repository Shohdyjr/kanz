const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const env = require("./config/env");
const initDb = require("./db/init");

const app = express();
app.use(helmet());
app.use(express.json({ limit: "100kb" })); // small, generous cap — blocks oversized payload abuse
app.use(cors({ origin: env.frontendOrigin }));

// Lazy DB init: on Vercel the process is re-created per cold start, so we
// run initDb() once per instance (on first request) instead of at boot.
let dbReady = null;
app.use((req, res, next) => {
  dbReady ??= initDb();
  dbReady.then(() => next()).catch((err) => {
    console.error("initDb failed:", err);
    res.status(500).json({ ok: false, error: "dbInitFailed" });
  });
});

app.get("/", (req, res) => res.json({ ok: true, service: "kanz-backend" }));
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/favicon.ico", (req, res) => res.status(204).end()); // API only, no favicon — avoids noisy 404s in logs

app.use("/api/auth", require("./routes/auth"));
app.use("/api", require("./routes/data"));   // /api/data, /api/history, /api/alerts
app.use("/api", require("./routes/rates"));  // /api/historical-rate, /api/benchmark
app.use("/api/cron", require("./routes/cron"));

module.exports = app;
