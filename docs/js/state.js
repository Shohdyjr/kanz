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
    group: "savings",
  },
  {
    id: "thunder_invest",
    name_ar: "ثاندر — استثمار (جنيه)",
    name_en: "Thunder — Investment",
    icon: "📈",
    currency: "EGP",
    isAsset: false,
    group: "investments",
  },
  {
    id: "tilda_invest",
    name_ar: "تيلدا — استثمار (جنيه)",
    name_en: "Telda — Investment",
    icon: "📈",
    currency: "EGP",
    isAsset: false,
    group: "investments",
  },
  {
    id: "ahli",
    name_ar: "البنك الأهلي (جنيه)",
    name_en: "National Bank (NBE)",
    icon: "🏦",
    currency: "EGP",
    isAsset: false,
    group: "savings",
  },
  {
    id: "mashreq",
    name_ar: "بنك المشرق (جنيه)",
    name_en: "Mashreq Bank",
    icon: "🏦",
    currency: "EGP",
    isAsset: false,
    group: "savings",
  },
  {
    id: "car",
    name_ar: "سعر السيارة (جنيه)",
    name_en: "Car",
    icon: "🚗",
    currency: "EGP",
    isAsset: true,
    group: "assets",
  },
  {
    id: "usd",
    name_ar: "نقدي بالدولار",
    name_en: "Cash USD",
    icon: "💵",
    currency: "USD",
    isAsset: false,
    group: "savings",
  },
  {
    id: "eur",
    name_ar: "نقدي باليورو",
    name_en: "Cash EUR",
    icon: "💶",
    currency: "EUR",
    isAsset: false,
    group: "savings",
  },
  {
    id: "sar",
    name_ar: "نقدي بالريال السعودي",
    name_en: "Cash SAR",
    icon: "💴",
    currency: "SAR",
    isAsset: false,
    group: "savings",
  },
  {
    id: "gold",
    name_ar: "ذهب (جرام)",
    name_en: "Gold (grams)",
    icon: "🪙",
    currency: "GOLD",
    isAsset: false,
    group: "assets",
  },
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
// Last date (YYYY-MM-DD, local) the user manually typed into an item's qty
// field — shown as a small subtext under the field, same style as the
// projection dates. Purely informational (never used in any calculation);
// unset for items the user hasn't touched since this feature shipped.
let qtyUpdatedAt = {};
// Per-item APY (%), e.g. apy["gold"] = 5 means that item grows 5%/year,
// compounded daily by the backend cron. Keyed by asset id, like `qty`.
let apy = {};
// Per-item "Interest Category" configuration — descriptive metadata only
// (does NOT affect the growth calculation, which is still the flat `apy`
// above compounded daily by the cron). Lets the UI show how a product's
// return actually works (e.g. "NAV-based, paid daily, compounds") instead
// of just a bare percentage. See docs/js/return-config.js.
let returnConfig = {};
let returnPanelOpen = false; // standalone "return category presets" panel, opened from its own button
let returnPanelAssetId = null; // which of the user's assets the panel is currently editing
let rcCollapsed = {}; // Product Configuration page: { [sectionKey]: true } for collapsed sections — default (absent) = expanded
let rcSelectedPresetId = null; // Product Configuration page: id of the preset button to highlight as "currently selected", reset whenever the asset changes
// Which asset's quick "since when has this money been here" popover is open
// (see docs/js/since-date.js) — null when none is open. A lightweight,
// per-row shortcut into returnConfig[id].startDate, so setting/correcting
// just that one date doesn't require opening the full Return Settings panel.
let sinceDatePopoverId = null;
let simModalOpen = false; // "what-if" simulator modal, opened per row from the table
let simAssetId = null; // which asset the simulator is currently running for
let simAmount = null; // last amount typed into the simulator (kept across re-renders)
let simDate = null; // last target date typed into the simulator (YYYY-MM-DD)
let simStartDate = null; // last start date typed into the simulator (YYYY-MM-DD), defaults to today
// Which basis ("nominal" | "effective") the simulator currently computes
// with — lets the user flip APY/APR just for this "what if" run without
// touching the item's actual saved Return Settings. Reset to the item's own
// cfg.rateBasis whenever the simulator opens or the selected asset changes.
let simRateBasis = null;
let groupFilter = null; // "savings" | "investments" | "assets" | null (null = show all rows)
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

// Intent-driven Activity logging (see docs/js/activities.js). `activityType`
// is chosen FIRST (Salary/Deposit/Withdrawal/Buy/Sell/Transfer/Correction),
// which is what makes the resulting record a fact about a chosen action
// rather than a guess reconstructed after the number was typed.
let activityModalOpen = false;
let activityType = null; // "salary" | "deposit" | "withdrawal" | "buy" | "sell" | "transfer" | "correction"
let activityError = null;
let activitySavedFlash = false; // true for a brief moment after a successful save, before the modal closes

// Which optional table columns are hidden — a pure per-device display
// preference (not synced to the server, unlike everything else in this
// file), so it's read straight from localStorage once at load time.
let hiddenCols = new Set();
try {
  const saved = JSON.parse(localStorage.getItem("kanz_hidden_cols_v1") || "[]");
  if (Array.isArray(saved)) hiddenCols = new Set(saved);
} catch (e) {
  // corrupt/old value — ignore and start with everything visible
}
// One-time migration: the 4 old fixed projection columns (nextAdd/projNext/
// projCycle/projYearEnd) collapsed into a single "projection" column. Only
// carry over "hidden" if ALL FOUR were hidden before — a deliberate "I don't
// want to see any projections" choice — otherwise default the new column to
// visible, same as everything else previously-untouched.
const OLD_PROJECTION_COL_KEYS = ["nextAdd", "projNext", "projCycle", "projYearEnd"];
if (OLD_PROJECTION_COL_KEYS.some((k) => hiddenCols.has(k))) {
  if (OLD_PROJECTION_COL_KEYS.every((k) => hiddenCols.has(k))) hiddenCols.add("projection");
  OLD_PROJECTION_COL_KEYS.forEach((k) => hiddenCols.delete(k));
  try {
    localStorage.setItem("kanz_hidden_cols_v1", JSON.stringify([...hiddenCols]));
  } catch (e) {
    // storage unavailable — safe to ignore, migration just re-runs next load
  }
}
let columnPanelOpen = false; // the small "choose columns" popover, opened from the table header

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
    group: c.group || "savings",
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

// Toggles "Change breakdown for this period" between including and
// excluding logged contributions. Session-only (not persisted server-side),
// same pattern as other UI-only toggles here. Only meaningful for
// month-aligned chart periods (MTD/YTD/All Time) — see renderChangeAnalysis
// in history-chart.js for why 7d/30d never get this split.
let changeAnalysisExclContrib = false;

function toggleChangeAnalysisExclContrib() {
  changeAnalysisExclContrib = !changeAnalysisExclContrib;
  renderHistory();
}

function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  applyTheme();
  render();
  renderHistory();
  scheduleSave();
}
