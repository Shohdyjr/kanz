// ══════════════════════════════════════════════════════
//  Interest Categories — return configuration panel.
//
//  Descriptive metadata only: lets the UI show *how* a product's return
//  actually works (calculation method / payout frequency / compounding /
//  liquidity), independent of which bank or platform it's with. It does
//  NOT change the growth calculation itself — that still comes from the
//  flat `apy` % compounded daily by the cron (see cron/dailySnapshot.js).
//
//  Opened from its own standalone button (not per table row). Includes a
//  fixed, built-in list of known real-world products (RETURN_PRESETS) —
//  the same for every user — so picking one fills in every field instead
//  of the user having to look each one up and set it by hand.
// ══════════════════════════════════════════════════════

// Fixed for every user — not editable from the UI. Update this list in code
// when a bank/platform changes its terms or a new product should be offered.
const RETURN_PRESETS = [
  {
    id: "thndr_cloud_instant",
    name_ar: "Thndr Cloud Instant (اليومي)",
    name_en: "Thndr Cloud Instant (Daily)",
    productType: "fixedIncomeFund",
    rateType: "variable",
    calcMethod: "navBased",
    payoutFreq: "daily",
    compounding: true,
    liquidity: "daily",
    suggestedApy: 18.11,
  },
  {
    id: "thndr_cloud_monthly",
    name_ar: "Thndr Cloud Monthly (الشهري)",
    name_en: "Thndr Cloud Monthly",
    productType: "fixedIncomeFund",
    rateType: "variable",
    calcMethod: "navBased",
    payoutFreq: "monthly",
    compounding: true,
    liquidity: "monthly",
    suggestedApy: 20.06,
  },
  {
    id: "mashreq_savings",
    name_ar: "بنك المشرق — Savings",
    name_en: "Mashreq — Savings",
    productType: "savings",
    rateType: "variable",
    calcMethod: "dailyBalance",
    payoutFreq: "monthly",
    compounding: true,
    liquidity: "monthly",
    suggestedApy: 18,
  },
  {
    id: "mashreq_day_by_day",
    name_ar: "بنك المشرق — يوم بيوم",
    name_en: "Mashreq — Day by Day",
    productType: "savings",
    rateType: "variable",
    calcMethod: "dailyBalance",
    payoutFreq: "daily",
    compounding: true,
    liquidity: "daily",
    suggestedApy: 15,
  },
  {
    id: "nbe_platinum_stepup_3y",
    name_ar: "الأهلي — شهادة بلاتينية متدرجة (3 سنين)",
    name_en: "NBE Platinum Step-Up Certificate (3 Years)",
    productType: "certificate",
    rateType: "fixed",
    calcMethod: "fixedPrincipal",
    payoutFreq: "annual",
    compounding: false,
    liquidity: "restricted",
    tierRates: [27, 22, 17],
  },
];

// Derives the "Category" code (e.g. DAILY_MONTHLY, FUND_DAILY) from the
// calculation method + payout frequency + compounding combo, matching the
// categories table in the design doc. Combos not explicitly listed there
// still get a readable generated code instead of nothing.
function deriveReturnCategory(calcMethod, payoutFreq, compounding) {
  if (!calcMethod || !payoutFreq) return null;

  const KNOWN = {
    "dailyBalance|daily|true": "DAILY_DAILY",
    "dailyBalance|monthly|true": "DAILY_MONTHLY",
    "dailyBalance|quarterly|true": "DAILY_QUARTERLY",
    "dailyBalance|annual|true": "DAILY_ANNUAL",
    "lowestMonthlyBalance|monthly|true": "MIN_BAL_MONTHLY",
    "fixedPrincipal|monthly|false": "FIXED_MONTHLY",
    "fixedPrincipal|quarterly|false": "FIXED_QUARTERLY",
    "fixedPrincipal|semiAnnual|false": "FIXED_SEMI_ANNUAL",
    "fixedPrincipal|annual|false": "FIXED_ANNUAL",
    "fixedPrincipal|maturity|true": "FIXED_MATURITY",
    "fixedPrincipal|monthly|true": "VARIABLE_MONTHLY",
    "navBased|daily|true": "FUND_DAILY",
    "navBased|monthly|true": "FUND_MONTHLY",
  };
  const key = calcMethod + "|" + payoutFreq + "|" + !!compounding;
  return KNOWN[key] || calcMethod.toUpperCase() + "_" + payoutFreq.toUpperCase();
}

function openReturnPanel(assetId) {
  returnPanelOpen = true;
  returnPanelAssetId = assetId && ASSETS.some((a) => a.id === assetId) ? assetId : ASSETS.length ? ASSETS[0].id : null;
  render();
}

function closeReturnPanel() {
  returnPanelOpen = false;
  returnPanelAssetId = null;
  render();
}

// Re-renders just the panel body (not a full page render) so switching the
// asset dropdown doesn't disturb anything else on the page.
function onReturnPanelAssetChange(id) {
  returnPanelAssetId = id || null;
  const root = document.getElementById("wt-return-panel-root");
  if (root) root.outerHTML = renderReturnPanel();
}

// Fills the form fields from a preset with one click — the user can still
// tweak anything afterwards before saving.
function applyReturnPreset(presetId) {
  const p = RETURN_PRESETS.find((x) => x.id === presetId);
  if (!p) return;
  const set = (fieldId, value) => {
    const el = document.getElementById(fieldId);
    if (el) el.value = value == null ? "" : String(value);
  };
  set("rc-productType", p.productType);
  set("rc-rateType", p.rateType);
  set("rc-calcMethod", p.calcMethod);
  set("rc-payoutFreq", p.payoutFreq);
  set("rc-compounding", p.compounding);
  set("rc-liquidity", p.liquidity);
  set("rc-apy", p.suggestedApy);
  set("rc-tierRates", p.tierRates ? p.tierRates.join(",") : "");
  previewReturnCategory();
}

function submitReturnConfig(ev) {
  ev.preventDefault();
  const id = returnPanelAssetId;
  if (!id) return;

  const val = (fieldId) => document.getElementById(fieldId).value;
  const productType = val("rc-productType");
  const rateType = val("rc-rateType");
  const calcMethod = val("rc-calcMethod");
  const payoutFreq = val("rc-payoutFreq");
  const compounding = val("rc-compounding") === "true";
  const liquidity = val("rc-liquidity");
  const apyVal = parseFloat(val("rc-apy"));
  const startDate = val("rc-startDate");
  const tierRates = val("rc-tierRates")
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));

  returnConfig[id] = {
    productType: productType || null,
    rateType: rateType || null,
    calcMethod: calcMethod || null,
    payoutFreq: payoutFreq || null,
    compounding,
    liquidity: liquidity || null,
    startDate: startDate || null,
    tierRates: tierRates.length ? tierRates : null,
  };
  if (Number.isFinite(apyVal) && apyVal > 0) apy[id] = Math.min(apyVal, 100);

  render();
  scheduleSave();
}

function clearReturnConfig() {
  const id = returnPanelAssetId;
  if (!id) return;
  delete returnConfig[id];
  const root = document.getElementById("wt-return-panel-root");
  if (root) root.outerHTML = renderReturnPanel();
  scheduleSave();
}

function optionsHtml(optionsMap, selected) {
  return (
    `<option value="">${t("noneOption")}</option>` +
    Object.keys(optionsMap)
      .map((k) => `<option value="${k}" ${k === selected ? "selected" : ""}>${optionsMap[k]}</option>`)
      .join("")
  );
}

function renderReturnPanel() {
  const id = returnPanelAssetId;
  const a = ASSETS.find((x) => x.id === id);
  const cfg = (a && returnConfig[id]) || {};
  const category = a ? deriveReturnCategory(cfg.calcMethod, cfg.payoutFreq, cfg.compounding) : null;
  const lang_ = lang; // presets are only ever labeled in ar/en, no i18n() needed

  return `
  <div class="wt-modal-overlay" id="wt-return-panel-root" onclick="if(event.target===this)closeReturnPanel()">
    <div class="wt-modal wt-modal-wide">
      <h3>${t("returnConfigBtnTitle")}</h3>
      <p style="font-size:12px;color:var(--wt-text-dim);margin:-6px 0 14px">${t("returnConfigHint")}</p>

      <div class="wt-field">
        <label for="rc-asset">${t("selectAssetLabel")}</label>
        <select id="rc-asset" onchange="onReturnPanelAssetChange(this.value)">
          ${ASSETS.map((x) => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.icon)} ${esc(assetName(x))}</option>`).join("")}
        </select>
      </div>

      ${
        !a
          ? `<p style="font-size:13px;color:var(--wt-text-dim)">${t("noAssetsHint")}</p>`
          : `
      <div class="wt-field">
        <label>${t("presetsLabel")}</label>
        <div class="wt-preset-list">
          ${RETURN_PRESETS.map(
            (p) =>
              `<button type="button" class="wt-btn-ghost wt-preset-btn" onclick="applyReturnPreset('${p.id}')">${esc(lang_ === "en" ? p.name_en : p.name_ar)}</button>`
          ).join("")}
        </div>
      </div>

      <form onsubmit="submitReturnConfig(event)">
        <div class="wt-field-row-4">
          <div class="wt-field">
            <label for="rc-productType">${t("productTypeLabel")}</label>
            <select id="rc-productType">${optionsHtml(t("productTypeOptions"), cfg.productType)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-rateType">${t("rateTypeLabel")}</label>
            <select id="rc-rateType">${optionsHtml(t("rateTypeOptions"), cfg.rateType)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-calcMethod">${t("calcMethodLabel")}</label>
            <select id="rc-calcMethod" onchange="previewReturnCategory()">${optionsHtml(t("calcMethodOptions"), cfg.calcMethod)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-payoutFreq">${t("payoutFreqLabel")}</label>
            <select id="rc-payoutFreq" onchange="previewReturnCategory()">${optionsHtml(t("payoutFreqOptions"), cfg.payoutFreq)}</select>
          </div>
        </div>
        <div class="wt-field-row-4" style="margin-top:12px">
          <div class="wt-field">
            <label for="rc-compounding">${t("compoundingLabel")}</label>
            <select id="rc-compounding" onchange="previewReturnCategory()">
              <option value="">${t("noneOption")}</option>
              <option value="true" ${cfg.compounding === true ? "selected" : ""}>${t("compoundingYes")}</option>
              <option value="false" ${cfg.compounding === false ? "selected" : ""}>${t("compoundingNo")}</option>
            </select>
          </div>
          <div class="wt-field">
            <label for="rc-liquidity">${t("liquidityLabel")}</label>
            <select id="rc-liquidity">${optionsHtml(t("liquidityOptions"), cfg.liquidity)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-startDate">${t("startDateLabel")}</label>
            <input type="date" id="rc-startDate" value="${cfg.startDate || ""}">
          </div>
          <div class="wt-field">
            <label for="rc-tierRates">${t("tierRatesLabel")}</label>
            <input type="text" id="rc-tierRates" placeholder="27,22,17" dir="ltr"
              value="${Array.isArray(cfg.tierRates) ? cfg.tierRates.join(",") : ""}">
          </div>
        </div>
        <p style="font-size:11px;color:var(--wt-text-dim);margin:8px 0 4px">${t("tierRatesHint")}</p>

        <!-- The actual number the cron applies every day — shown last, on its
             own, since everything above is just describing why it's what it is. -->
        <div class="wt-return-summary">
          <label for="rc-apy">${t("thApy")}</label>
          <input type="number" id="rc-apy" min="0" max="100" step="any" value="${apy[id] || ""}" placeholder="0%" title="${t("apyHint")}">
          <p class="wt-return-summary-category">${t("apyEditableHint")}</p>
          <p id="rc-category-preview" class="wt-return-summary-category">
            ${t("categoryPreviewLabel")}: <b>${category || "—"}</b>
          </p>
        </div>

        <div class="wt-modal-actions">
          <button type="button" class="wt-btn-ghost" onclick="clearReturnConfig()">${t("clearConfigBtn")}</button>
          <button type="button" class="wt-btn-ghost" onclick="closeReturnPanel()">${t("cancel")}</button>
          <button type="submit" class="wt-btn">${t("saveChanges")}</button>
        </div>
      </form>
      `
      }
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  Projections — shown as extra read-only columns in the assets table.
//  Purely a forward-looking display estimate; never written back anywhere,
//  never touches qty/apy/history. Two numbers per item, always:
//    - "next": value at the item's next natural payout point (tomorrow for
//      daily items, next month for monthly, next year for annual/maturity)
//    - "endOfYear": value on Dec 31 of the current calendar year
// ══════════════════════════════════════════════════════

function daysBetweenDates(d1, d2) {
  return Math.round((d2 - d1) / 86400000);
}

function addYearsToDate(d, n) {
  const nd = new Date(d);
  nd.setFullYear(nd.getFullYear() + n);
  return nd;
}

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Short human-readable date for the small "as of" label shown under each
// projection amount in the table (e.g. "12 Jul 2026" / "١٢ يوليو ٢٠٢٦").
// Reuses the month-name lists already defined in contributions.js.
function fmtDateShort(d) {
  const monthName = lang === "ar" ? MONTH_NAMES_AR[d.getMonth()] : MONTH_NAMES_EN[d.getMonth()];
  return `${d.getDate()} ${monthName} ${d.getFullYear()}`;
}

// ──────────────────────────────────────────────────────────────────────
//  Growth models — which formula actually matches how a bank pays interest.
//
//  Real products fall into (at least) three buckets, and using the wrong
//  one for a product silently gives numbers that don't match what actually
//  lands in the account:
//
//  1) TIERED CERTIFICATE (handled by tieredValueAt, unchanged): a fixed
//     principal that compounds once a year at a rate that steps down/up.
//
//  2) PERIODIC-BOUNDARY COMPOUNDING (new): products like "بنك المشرق"
//     savings — during the month the bank accrues *simple* interest
//     (principal × rate/365 × days), it does NOT compound day to day. Only
//     when the month actually closes does that accrued interest get paid
//     into the balance, and the *next* month's simple interest is then
//     calculated on the new, larger balance. So growth is a staircase:
//     flat within a period, a jump at each payout boundary.
//     Needs `returnConfig.startDate` (anchors which day-of-month/quarter/
//     year the boundary falls on) + `payoutFreq` that maps to a period
//     length (monthly/quarterly/semiAnnual/annual) + `compounding: true`.
//
//  3) FLAT SIMPLE INTEREST (new): `compounding: false` — the interest is
//     paid out elsewhere (not reinvested into this same balance), so this
//     item's own principal never compounds; it just accrues linearly off
//     the *original* principal for as long as it's held.
//
//  4) Anything else (no returnConfig, or a daily payout with no monthly
//     boundary) keeps the original behaviour: continuous daily compounding
//     via (1 + rate/100)^(days/365) — unchanged, for backward compatibility
//     with existing items/history.
// ──────────────────────────────────────────────────────────────────────

// Walks forward in `monthsStep`-sized jumps from `startDateStr`, anchored to
// its day-of-month, until passing `dateObj`. Returns the boundary date
// exactly matching `dateObj` and the one immediately before it, or null if
// `dateObj` doesn't fall exactly on a boundary (i.e. mid-period).
function periodBoundaryAt(startDateStr, monthsStep, dateObj) {
  if (!startDateStr || !monthsStep) return null;
  let cursor = parseDateStr(startDateStr);
  if (dateObj <= cursor) return null;
  let prev = cursor;
  while (cursor < dateObj) {
    prev = cursor;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + monthsStep, cursor.getDate());
  }
  return cursor.getTime() === dateObj.getTime() ? { periodStart: prev, periodEnd: cursor } : null;
}

// Simple interest within each period (principal × rate/365 × days), only
// folded into the balance at each real payout boundary — matching a product
// like Mashreq that doesn't compound mid-month but does start the next month
// from the new, larger balance. `fromDate` is where the principal amount is
// as of; boundaries are still anchored to `startDateStr`'s day-of-month so a
// simulated "what if I add money today" still lands on the account's real
// payout schedule.
function periodicBoundaryValueAt(principal, startDateStr, ratePercent, payoutFreq, fromDate, targetDate) {
  const monthsStep = monthsStepForFreq(payoutFreq);
  if (!startDateStr || !monthsStep || !ratePercent || targetDate <= fromDate) return principal;

  let balance = principal;
  let cursor = fromDate;
  let nextBoundary = anniversaryAfter(startDateStr, monthsStep, cursor);

  while (nextBoundary <= targetDate) {
    const days = daysBetweenDates(cursor, nextBoundary);
    balance += balance * ((ratePercent / 100 / 365) * days);
    cursor = nextBoundary;
    nextBoundary = new Date(cursor.getFullYear(), cursor.getMonth() + monthsStep, cursor.getDate());
  }
  const remDays = Math.max(0, daysBetweenDates(cursor, targetDate));
  if (remDays > 0) balance += balance * ((ratePercent / 100 / 365) * remDays);
  return balance;
}

// Plain simple interest off the original principal, never compounded —
// for products where the interest is paid out rather than reinvested here.
function simpleFlatValueAt(principal, ratePercent, fromDate, targetDate) {
  if (!ratePercent || targetDate <= fromDate) return principal;
  const days = daysBetweenDates(fromDate, targetDate);
  return principal + principal * (ratePercent / 100 / 365) * days;
}

// Single entry point used by both the table projections below and the
// simulator — picks the model that matches the item's actual configured
// return category instead of always assuming daily compounding.
function computeGrowthValueAt(assetId, principal, fromDate, targetDate) {
  if (!principal || targetDate <= fromDate) return principal;
  const cfg = returnConfig[assetId] || {};

  if (cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length) {
    return tieredValueAt(principal, cfg.startDate, cfg.tierRates, targetDate);
  }

  const rate = apy[assetId] || 0;
  if (!rate) return principal;

  const monthsStep = monthsStepForFreq(cfg.payoutFreq);
  if (cfg.startDate && monthsStep && cfg.compounding === true) {
    return periodicBoundaryValueAt(principal, cfg.startDate, rate, cfg.payoutFreq, fromDate, targetDate);
  }
  if (cfg.compounding === false) {
    return simpleFlatValueAt(principal, rate, fromDate, targetDate);
  }

  // Fallback: original daily-compounding assumption (daily payout, or no
  // return category configured at all).
  const days = Math.max(0, daysBetweenDates(fromDate, targetDate));
  return principal * Math.pow(1 + rate / 100, days / 365);
}
// Compounds `principal` from `startDateStr` up to `targetDate`, switching to
// the next rate in `tierRates` at every anniversary of the start date. Once
// past the last defined tier, keeps compounding at that last tier's rate
// (a reasonable assumption for "what happens if I don't withdraw" — edit the
// tierRates list in the panel if the real terms differ).
function tieredValueAt(principal, startDateStr, tierRates, targetDate) {
  if (!startDateStr || !Array.isArray(tierRates) || !tierRates.length) return principal;
  let cursor = parseDateStr(startDateStr);
  if (targetDate <= cursor) return principal;

  let value = principal;
  for (let i = 0; i < tierRates.length; i++) {
    const yearEnd = addYearsToDate(cursor, 1);
    const segmentEnd = targetDate < yearEnd ? targetDate : yearEnd;
    const days = Math.max(0, daysBetweenDates(cursor, segmentEnd));
    value *= Math.pow(1 + tierRates[i] / 100, days / 365);
    if (targetDate <= yearEnd) return value;
    cursor = yearEnd;
  }
  const lastRate = tierRates[tierRates.length - 1];
  const remDays = Math.max(0, daysBetweenDates(cursor, targetDate));
  return value * Math.pow(1 + lastRate / 100, remDays / 365);
}

// Next date that is startDateStr + N*monthsStep (integer N), strictly after
// `after`. This anchors "next payout" / "cycle end" to the account's actual
// opening date (e.g. opened on the 17th → next payout is the 17th of next
// month) instead of always the 1st/last of the calendar month — so setting
// a start date in the return panel actually changes the projection, even
// for plain (non-tiered) monthly/quarterly/etc products.
function anniversaryAfter(startDateStr, monthsStep, after) {
  let cursor = parseDateStr(startDateStr);
  if (cursor > after) return cursor;
  while (cursor <= after) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + monthsStep, cursor.getDate());
  }
  return cursor;
}

function monthsStepForFreq(payoutFreq) {
  if (payoutFreq === "monthly") return 1;
  if (payoutFreq === "quarterly") return 3;
  if (payoutFreq === "semiAnnual") return 6;
  if (payoutFreq === "annual" || payoutFreq === "maturity") return 12;
  return null;
}

// Returns { next, nextLabelKey, nextDate, endOfCycle, endOfCycleDate, endOfYear, endOfYearDate }
// in the asset's own currency (qty is already stored in native units — EGP
// stays EGP, gold stays grams, etc. — so there's no USD conversion here at
// all), or null if there's nothing to project (no balance, or no rate
// configured at all). The *Date fields are plain JS Date objects, used to
// show a small "as of <date>" label under each projected amount in the table.
function projectAssetValue(a) {
  const principal = qty[a.id] || 0;
  if (!principal) return null;

  const cfg = returnConfig[a.id] || {};
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfYear = new Date(today.getFullYear(), 11, 31);
  const endOfCycle = endOfCycleDate(cfg, todayMid);

  const monthsStep = monthsStepForFreq(cfg.payoutFreq);
  let nextDate, nextLabelKey;
  if (cfg.startDate && monthsStep) {
    nextDate = anniversaryAfter(cfg.startDate, monthsStep, todayMid);
    nextLabelKey = monthsStep === 12 ? "projNextYear" : "projNextMonth";
  } else if (cfg.payoutFreq === "monthly" || cfg.payoutFreq === "quarterly" || cfg.payoutFreq === "semiAnnual") {
    nextDate = new Date(todayMid.getFullYear(), todayMid.getMonth() + 1, todayMid.getDate());
    nextLabelKey = "projNextMonth";
  } else if (cfg.payoutFreq === "annual" || cfg.payoutFreq === "maturity") {
    nextDate = addYearsToDate(todayMid, 1);
    nextLabelKey = "projNextYear";
  } else {
    nextDate = new Date(todayMid.getFullYear(), todayMid.getMonth(), todayMid.getDate() + 1);
    nextLabelKey = "projTomorrow";
  }

  if (cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length) {
    return {
      next: computeGrowthValueAt(a.id, principal, todayMid, nextDate),
      nextLabelKey,
      nextDate,
      endOfCycle: computeGrowthValueAt(a.id, principal, todayMid, endOfCycle),
      endOfCycleDate: endOfCycle,
      endOfYear: computeGrowthValueAt(a.id, principal, todayMid, endOfYear),
      endOfYearDate: endOfYear,
    };
  }

  const rate = apy[a.id] || 0;
  if (!rate) return null;
  return {
    next: computeGrowthValueAt(a.id, principal, todayMid, nextDate),
    nextLabelKey,
    nextDate,
    endOfCycle: computeGrowthValueAt(a.id, principal, todayMid, endOfCycle),
    endOfCycleDate: endOfCycle,
    endOfYear: computeGrowthValueAt(a.id, principal, todayMid, endOfYear),
    endOfYearDate: endOfYear,
  };
}

// The natural end of the item's current compounding/payout cycle:
//  - tiered certificate: the next anniversary of its start date (when the
//    current step-up year rolls into the next one)
//  - non-tiered with a start date set: the next anniversary of that start
//    date at the product's payout frequency (e.g. opened on the 17th,
//    monthly payout → the 17th of next month)
//  - monthly/quarterly/semi-annual/annual/maturity with no start date: end
//    of the current calendar month
//  - daily (or unset): end of today
function endOfCycleDate(cfg, todayMid) {
  if (cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length) {
    let cursor = parseDateStr(cfg.startDate);
    while (cursor <= todayMid) cursor = addYearsToDate(cursor, 1);
    return cursor;
  }
  const monthsStep = monthsStepForFreq(cfg.payoutFreq);
  if (cfg.startDate && monthsStep) {
    return anniversaryAfter(cfg.startDate, monthsStep, todayMid);
  }
  if (!cfg.payoutFreq || cfg.payoutFreq === "daily") return todayMid;
  return new Date(todayMid.getFullYear(), todayMid.getMonth() + 1, 0); // last day of this month
}
function previewReturnCategory() {
  const calcMethod = document.getElementById("rc-calcMethod").value;
  const payoutFreq = document.getElementById("rc-payoutFreq").value;
  const compoundingVal = document.getElementById("rc-compounding").value;
  const compounding = compoundingVal === "true" ? true : compoundingVal === "false" ? false : undefined;
  const category = deriveReturnCategory(calcMethod, payoutFreq, compounding);
  const el = document.getElementById("rc-category-preview");
  if (el) el.innerHTML = `${t("categoryPreviewLabel")}: <b>${category || "—"}</b>`;
}
