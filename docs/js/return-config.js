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
        <div class="wt-field-row">
          <div class="wt-field">
            <label for="rc-productType">${t("productTypeLabel")}</label>
            <select id="rc-productType">${optionsHtml(t("productTypeOptions"), cfg.productType)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-rateType">${t("rateTypeLabel")}</label>
            <select id="rc-rateType">${optionsHtml(t("rateTypeOptions"), cfg.rateType)}</select>
          </div>
        </div>
        <div class="wt-field-row" style="margin-top:12px">
          <div class="wt-field">
            <label for="rc-calcMethod">${t("calcMethodLabel")}</label>
            <select id="rc-calcMethod" onchange="previewReturnCategory()">${optionsHtml(t("calcMethodOptions"), cfg.calcMethod)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-payoutFreq">${t("payoutFreqLabel")}</label>
            <select id="rc-payoutFreq" onchange="previewReturnCategory()">${optionsHtml(t("payoutFreqOptions"), cfg.payoutFreq)}</select>
          </div>
        </div>
        <div class="wt-field-row" style="margin-top:12px">
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
        </div>

        <div class="wt-field-row" style="margin-top:12px">
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
        <p style="font-size:11px;color:var(--wt-text-dim);margin:-6px 0 4px">${t("tierRatesHint")}</p>

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

// Returns { next, nextLabelKey, endOfYear } in USD, or null if there's
// nothing to project (no balance, or no rate configured at all).
function projectAssetValue(a) {
  const principal = (qty[a.id] || 0) * priceFor(a);
  if (!principal) return null;

  const cfg = returnConfig[a.id] || {};
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfYear = new Date(today.getFullYear(), 11, 31);

  let nextDate, nextLabelKey;
  if (cfg.payoutFreq === "monthly" || cfg.payoutFreq === "quarterly" || cfg.payoutFreq === "semiAnnual") {
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
      next: tieredValueAt(principal, cfg.startDate, cfg.tierRates, nextDate),
      nextLabelKey,
      endOfYear: tieredValueAt(principal, cfg.startDate, cfg.tierRates, endOfYear),
    };
  }

  const rate = apy[a.id] || 0;
  if (!rate) return null;
  const daysToNext = Math.max(0, daysBetweenDates(todayMid, nextDate));
  const daysToEnd = Math.max(0, daysBetweenDates(todayMid, endOfYear));
  return {
    next: principal * Math.pow(1 + rate / 100, daysToNext / 365),
    nextLabelKey,
    endOfYear: principal * Math.pow(1 + rate / 100, daysToEnd / 365),
  };
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
