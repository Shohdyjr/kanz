// ── Helpers ────────────────────────────────────────────
const fmtUsd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEgp = (n) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + (lang === "en" ? " EGP" : " ج.م");
// Generic "amount + currency code" formatter for currencies without their
// own dedicated formatter above (used by the contributions grid, where the
// user can log a salary/expense in EGP, USD, EUR, or SAR — see contributions.js).
const fmtByCurrency = (n, currency) => {
  if (currency === "USD") return fmtUsd(n);
  if (currency === "EGP") return fmtEgp(n);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currency;
};
// Same idea as fmtByCurrency, but never rounds down to whole numbers (which
// fmtEgp does for EGP) — used for projection amounts, where the person
// specifically wants to see the actual fractional growth, not a rounded total.
const fmtByCurrencyPrecise = (n, currency, d = 2) => {
  if (currency === "USD") return fmtUsd(n);
  if (currency === "EGP") return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) + (lang === "en" ? " EGP" : " ج.م");
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) + " " + currency;
};
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

// Today as YYYY-MM-DD in local time — same rationale as addDaysToDateStr above.
// Snapshots/contributions are stored using Cairo-local dates, so anything that
// compares against "today" must use local time too, or it can land on the
// wrong side of midnight for part of the day.
function todayLocalStr() {
  const dt = new Date();
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

  const windowStartStr = addDaysToDateStr(todayLocalStr(), -days);

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

// ── Split a wealth delta into "money the user added" vs "assets actually
// grew in value" ────────────────────────────────────────────────────
// Salary being bigger than expenses means wealth goes up every month even if
// nothing you already own changed in value at all — that's saving, not
// growth. This sums the contributions logged in docs/js/contributions.js
// that fall strictly after `sinceDateExclusive` and up to `untilDateInclusive`,
// so it can be subtracted from a raw diff to isolate the real, price-driven change.
// Kept as a helper name (`*Exclusive`) for historical reasons, but the
// comparison is actually inclusive (`>=`) on the start date. Contributions
// are logged with monthly granularity (always the 1st of the month, since
// the full-screen yearly grid replaced the old free-form date field — see
// contributions.js), and MTD's window start is exactly that same "1st of
// the month" date. A strict `>` used to silently exclude the current
// month's own contribution from its own MTD comparison.
// `currencies`, if given, restricts the sum to contributions logged in one of
// those currencies (see CONTRIB_CURRENCIES in contributions.js) — used to
// attribute a contribution to the EGP vs. hard-currency change-breakdown
// category it actually landed in, since a contribution already carries the
// currency the user typed it in.
// Types that represent money genuinely entering/leaving the user's control
// (not moved between their own holdings) — kept in sync with
// EXTERNAL_CASH_FLOW_TYPES in backend/lib/attribution.js. Buy/Sell/Transfer/
// Correction activities are stored in the same array but must NOT be
// subtracted here as if they were external cash flow, or a Buy would wrongly
// look like a deposit and a Sell like a withdrawal.
const CASH_FLOW_ACTIVITY_TYPES = new Set(["salary", "deposit", "withdrawal", "income", "expense"]);

// Which cash-flow types count as "income" vs "expense" for month totals
// (used by monthSummary() in contributions.js). Kept here alongside
// CASH_FLOW_ACTIVITY_TYPES so the two stay in sync as new types are added.
const INCOME_ACTIVITY_TYPES = new Set(["salary", "deposit", "income"]);
const EXPENSE_ACTIVITY_TYPES = new Set(["withdrawal", "expense"]);

function sumContributionsBetween(sinceDateInclusive, untilDateInclusive, currencies) {
  if (!contributionsData || contributionsData.length === 0) return 0;
  return contributionsData
    .filter(
      (c) =>
        (!sinceDateInclusive || c.date >= sinceDateInclusive) &&
        c.date <= untilDateInclusive &&
        // Entries saved before the currency field existed have no `currency`
        // at all — the backend already treats that as USD at save time
        // (see POST /contributions: `currency: currency || "USD"`), so read
        // it back the same way here. Without this fallback, a legacy entry
        // matched neither the EGP filter nor the USD/EUR/SAR filter and
        // silently vanished from both buckets instead of landing in one.
        (!currencies || currencies.includes(c.currency || "USD")) &&
        CASH_FLOW_ACTIVITY_TYPES.has(c.type || (parseFloat(c.amountUsd) >= 0 ? "income" : "expense"))
    )
    .reduce((sum, c) => sum + (parseFloat(c.amountUsd) || 0), 0);
}

// Attaches `contributed`/`realDiff`/`realPct` to a { diff, pct } growth result,
// using `refDate` (the snapshot being compared against) as the window start.
function attachRealGrowth(result, refDate) {
  if (!result) return null;
  const todayStr = todayLocalStr();
  const contributed = sumContributionsBetween(refDate, todayStr);
  // realDiff/realPct answer "how much would my wealth have changed if I
  // hadn't added or withdrawn anything this period" — i.e. price movement only.
  const realDiff = result.diff - contributed;
  const realPct = result.candidateTotal ? (realDiff / result.candidateTotal) * 100 : 0;
  return { ...result, contributed, realDiff, realPct };
}

// ── Compute the change % vs. the closest snapshot N days ago ─────────
function computeGrowth(days, currentTotal) {
  const candidate = getGrowthCandidate(days);
  if (!candidate || candidate.totalUsd === 0) return null;

  const diff = currentTotal - candidate.totalUsd;
  const pct = (diff / candidate.totalUsd) * 100;
  return attachRealGrowth({ diff, pct, candidateTotal: candidate.totalUsd }, candidate.date);
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
  return attachRealGrowth({ diff, pct, candidateTotal: candidate.totalUsd }, candidate.date);
}

// ── Compute the change % since the very first snapshot in the whole history ──
function computeGrowthAllTime(currentTotal) {
  if (!historyData || historyData.length === 0) return null;
  const candidate = historyData[0]; // historyData is sorted ascending by date
  if (!candidate || candidate.totalUsd === 0) return null;

  const diff = currentTotal - candidate.totalUsd;
  const pct = (diff / candidate.totalUsd) * 100;
  return attachRealGrowth({ diff, pct, candidateTotal: candidate.totalUsd }, candidate.date);
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
