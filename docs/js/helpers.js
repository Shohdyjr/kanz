// ── Helpers ────────────────────────────────────────────
const fmtUsd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEgp = (n) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + (lang === "en" ? " EGP" : " ج.م");
const fmtNum = (n, d = 4) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function uid() {
  return "custom_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Adds a number of days to a date (YYYY-MM-DD) in local time, avoiding
// toISOString() which converts to UTC and can shift the day depending on
// the timezone offset (e.g. Cairo's UTC+2/+3 makes toISOString return the previous day)
function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d); // explicit local date, no timezone ambiguity
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return yyyy + "-" + mm + "-" + dd;
}

function priceFor(a) {
  if (!rates) return 0;
  switch (a.currency) {
    case "USD":
      return 1;
    case "EGP":
      return 1 / rates.egpPerUsd;
    case "EUR":
      return 1 / rates.eurPerUsd;
    case "SAR":
      return 1 / rates.sarPerUsd;
    case "GOLD":
      return rates.goldUsdPerGram;
  }
  return 0;
}

// ── Find the closest reference snapshot for a given time window (in days) ──
// Same "oldest snapshot within the window, else the closest one before it" logic
// used for both the growth percentage and chart filtering, so they stay consistent
function getGrowthCandidate(days) {
  if (!historyData || historyData.length === 0) return null;

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - days);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  let candidate = historyData.find((h) => h.date >= windowStartStr) || null;
  if (!candidate) {
    for (let i = historyData.length - 1; i >= 0; i--) {
      if (historyData[i].date < windowStartStr) {
        candidate = historyData[i];
        break;
      }
    }
  }
  return candidate;
}

// ── Compute the change % vs. the closest snapshot N days ago ─────────
function computeGrowth(days, currentTotal) {
  const candidate = getGrowthCandidate(days);
  if (!candidate || candidate.totalUsd === 0) return null;

  const diff = currentTotal - candidate.totalUsd;
  const pct = (diff / candidate.totalUsd) * 100;
  return { diff, pct };
}

// ── Compute the change % since a fixed date (e.g. start of year) ───
// Finds the closest snapshot with date >= sinceDate (closest to the start date)
function computeGrowthSince(sinceDate, currentTotal) {
  if (!historyData || historyData.length === 0) return null;

  let candidate = null;
  for (let i = 0; i < historyData.length; i++) {
    if (historyData[i].date >= sinceDate) {
      candidate = historyData[i];
      break;
    }
  }
  // If every snapshot predates the start date, there's no valid reference point
  if (!candidate || candidate.totalUsd === 0) return null;

  const diff = currentTotal - candidate.totalUsd;
  const pct = (diff / candidate.totalUsd) * 100;
  return { diff, pct };
}

// ── Compute the change % since the very first snapshot in the whole history ──
function computeGrowthAllTime(currentTotal) {
  if (!historyData || historyData.length === 0) return null;
  const candidate = historyData[0]; // historyData is sorted ascending by date
  if (!candidate || candidate.totalUsd === 0) return null;

  const diff = currentTotal - candidate.totalUsd;
  const pct = (diff / candidate.totalUsd) * 100;
  return { diff, pct };
}

// ── Fetch exchange rates: hourly source first, falling back to daily ─
async function fetchFxRates() {
  // Primary source: updates hourly (api.exchangerate.fun)
  try {
    const res = await fetch("https://api.exchangerate.fun/latest?base=USD");
    const j = await res.json();
    if (j && j.rates && j.rates.EGP && j.rates.EUR && j.rates.SAR) {
      return { egpPerUsd: j.rates.EGP, eurPerUsd: j.rates.EUR, sarPerUsd: j.rates.SAR, source: "hourly" };
    }
    throw new Error("بيانات ناقصة من المصدر الساعي");
  } catch (e) {
    console.warn("fetchFxRates: المصدر الساعي فشل، رجوع للمصدر اليومي:", e);
  }
  // Fallback source: updates daily (open.er-api.com)
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  const fx = await res.json();
  return { egpPerUsd: fx.rates.EGP, eurPerUsd: fx.rates.EUR, sarPerUsd: fx.rates.SAR, source: "daily" };
}

// ── Fetch rates from the internet ────────────────────────────
async function fetchRates() {
  status = "loading";
  render();
  try {
    const [fx, goldRes] = await Promise.all([fetchFxRates(), fetch("https://api.gold-api.com/price/XAU")]);
    const gold = await goldRes.json();
    const ounce = gold.price ?? gold.rate ?? gold.value;
    rates = {
      egpPerUsd: fx.egpPerUsd,
      eurPerUsd: fx.eurPerUsd,
      sarPerUsd: fx.sarPerUsd,
      fxSource: fx.source,
      goldUsdPerOunce: ounce,
      goldUsdPerGram: ounce / OUNCE_TO_GRAM,
      fetchedAt: new Date().toISOString(),
    };
    status = "live";
  } catch (e) {
    status = "err";
    console.error("fetchRates:", e);
  }
  render();
  renderBreakdown();
}
