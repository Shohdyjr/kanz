// ══════════════════════════════════════════════════════
//  Wealth tracker — talks to the backend via a REST API
//  (the page used to load inside a sandboxed iframe, so fetch(location) would not work)
// ══════════════════════════════════════════════════════

const OUNCE_TO_GRAM = 31.1034768;

// Base assets — same ids as before (so saved quantities keep matching),
// now with editable name_ar/name_en/icon like any other asset.
const BASE_ASSETS = [
  {
    id: "thunder_save",
    name_ar: "ثاندر — توفير (جنيه)",
    name_en: "Thunder — Savings",
    icon: "💰",
    currency: "EGP",
    isAsset: false,
  },
  {
    id: "thunder_invest",
    name_ar: "ثاندر — استثمار (جنيه)",
    name_en: "Thunder — Investment",
    icon: "📈",
    currency: "EGP",
    isAsset: false,
  },
  {
    id: "tilda_invest",
    name_ar: "تيلدا — استثمار (جنيه)",
    name_en: "Telda — Investment",
    icon: "📈",
    currency: "EGP",
    isAsset: false,
  },
  {
    id: "ahli",
    name_ar: "البنك الأهلي (جنيه)",
    name_en: "National Bank (NBE)",
    icon: "🏦",
    currency: "EGP",
    isAsset: false,
  },
  { id: "mashreq", name_ar: "بنك المشرق (جنيه)", name_en: "Mashreq Bank", icon: "🏦", currency: "EGP", isAsset: false },
  { id: "car", name_ar: "سعر السيارة (جنيه)", name_en: "Car", icon: "🚗", currency: "EGP", isAsset: true },
  { id: "usd", name_ar: "نقدي بالدولار", name_en: "Cash USD", icon: "💵", currency: "USD", isAsset: false },
  { id: "eur", name_ar: "نقدي باليورو", name_en: "Cash EUR", icon: "💶", currency: "EUR", isAsset: false },
  { id: "sar", name_ar: "نقدي بالريال السعودي", name_en: "Cash SAR", icon: "💴", currency: "SAR", isAsset: false },
  { id: "gold", name_ar: "ذهب (جرام)", name_en: "Gold (grams)", icon: "🪙", currency: "GOLD", isAsset: false },
];

const ICON_PALETTE = [
  "💰",
  "💵",
  "💶",
  "💷",
  "💴",
  "🏦",
  "💳",
  "📈",
  "📊",
  "🪙",
  "🟡",
  "🚗",
  "🏠",
  "💎",
  "📦",
  "🧾",
  "🛢️",
  "🏢",
  "🐷",
  "💼",
];
const CURRENCY_LABEL = { EGP: "جنيه مصري", USD: "دولار أمريكي", EUR: "يورو", SAR: "ريال سعودي", GOLD: "ذهب (جرام)" };

let customAssets = [];
let excludedBaseIds = new Set();
let baseOverrides = {};
let ASSETS = [];

let qty = {};
// Per-item APY (%), e.g. apy["gold"] = 5 means that item grows 5%/year.
// Keyed by asset id, like `qty`.
let apy = {};
// Per-item compounding cadence for the APY above — "daily" or "monthly".
// Missing/undefined defaults to "daily". Keyed by asset id.
let apyFrequency = {};
// Per-item ISO timestamp of the last time the user edited that item's qty —
// set automatically by setQty(). The backend cron uses this as the start
// point for computing accrued return, so growth always counts from the last
// manual change rather than from account creation.
let qtyChangedAt = {};
// Per-item accrued return since qtyChangedAt, computed nightly by the
// backend cron (see backend/cron/dailySnapshot.js) — read-only on the
// client. `qty` itself is never touched by this; it only ever changes when
// the user edits it directly.
let accruedValue = {};
let order = [];
let itemHistoryModalId = null; // asset id whose history timeline is open, or null
let itemHistoryEntries = []; // entries loaded for itemHistoryModalId
let rates = null; // FX/gold rates — plain JS variable, refetched every time, no need to persist
let status = "loading";
let syncStatus = "idle";
let syncTimer = null;
let outerChart = null;
let innerChart = null;
let historyChart = null;
let historyData = [];
let modalOpen = false;
let historyModalOpen = false; // open/close the "add manual snapshot" modal
let historyManagerOpen = false; // open/close the history manager panel (view/edit/delete)
let historyChartPeriod = "mtd"; // "7d" | "30d" | "mtd" | "ytd" | "all" — chart's visible period
let showBenchmark = false; // whether to overlay the S&P 500 comparison line
let benchmarkError = null; // user-visible message when the benchmark fetch fails
let histRate = null; // { egpPerUsd, date } — historical exchange rate, once fetched
let histRateStatus = "idle"; // idle | loading | ok | error
let histRateError = "";
let logoAnimated = false;
let editingId = null;
let authMode = "login"; // "login" | "signup" | "forgot" | "resetOtp"
// Carried between the two forgot-password steps: the username the code was
// requested for, and the masked email it was sent to (for the "code sent to
// a***@gmail.com" message). Reset once the flow completes or is abandoned.
let forgotFlowUsername = null;
let forgotFlowEmail = null;
let theme = "dark"; // updated from the user's data after login
let lang = "en"; // updated from the user's data after login

/**
 * Browser storage in this project is limited to two things:
 * 1) The current username in sessionStorage — so the session survives a refresh.
 * 2) The "remember me" token in localStorage — so the user stays logged in on
 *    this device for 7 days without re-entering their password. This token
 *    is long and random; the server only ever compares its hash (just like
 *    a password) — the raw token itself is never stored server-side.
 * Every other preference (theme/lang/order/assets/quantities) comes from the server on every load.
 */
let currentUser = null; // only set after a real login or a successful "remember me" check
let sessionToken = null; // authorizes every sensitive server request — memory only, persisted only if "remember me" is on
let savingsGoal = 0; // savings goal in USD — 0 means no goal set
let goalModalOpen = false;

// Net money manually added/withdrawn (e.g. "salary minus expenses this
// month"), kept separate from `historyData` so growth % can be split into
// "money I added" vs "my assets actually grew in value" — see helpers.js.
let contributionsData = [];
let contribModalOpen = false;
let emailModalOpen = false; // recovery-email settings modal, opened from the top bar

function slugify(s) {
  return (
    String(s)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "item"
  );
}

function rebuildAssets() {
  const baseFull = BASE_ASSETS.filter((b) => !excludedBaseIds.has(b.id)).map((b) => {
    const ov = baseOverrides[b.id];
    return ov ? { ...b, ...ov } : b;
  });
  const customFull = customAssets.map((c) => ({
    id: c.id,
    name_ar: c.name_ar,
    name_en: c.name_en,
    icon: c.icon || "💼",
    currency: c.currency,
    isAsset: !!c.isAsset,
  }));
  ASSETS = [...baseFull, ...customFull];
  ASSETS.forEach((a) => {
    if (!(a.id in qty)) qty[a.id] = 0;
  });
}

function syncOrderWithAssets() {
  const known = order.filter((id) => ASSETS.some((a) => a.id === id));
  const missing = ASSETS.map((a) => a.id).filter((id) => !known.includes(id));
  order = [...known, ...missing];
}

function applyTheme() {
  const el = document.getElementById("bodyRoot");
  if (theme === "light") el.classList.add("theme-light");
  else el.classList.remove("theme-light");
}

function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  applyTheme();
  render();
  renderHistory();
  scheduleSave();
}
