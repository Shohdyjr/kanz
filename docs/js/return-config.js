// ══════════════════════════════════════════════════════
//  Interest Categories — return configuration panel.
//
//  Lets the UI show *how* a product's return actually works (calculation
//  method / payout frequency / compounding / liquidity / whether the
//  entered % is a Nominal APR or an Effective APY-EAR), independent of
//  which bank or platform it's with. This DOES feed into the real growth
//  math — both the daily cron (cron/dailySnapshot.js -> lib/growthEngine.js)
//  and every projection shown in the UI (computeGrowthValueAt below) read
//  this config to decide which formula and which "since when" date to use.
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
    rateBasis: "effective",
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
    rateBasis: "effective",
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
    rateBasis: "nominal",
    calcMethod: "lowestMonthlyBalance",
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
    rateBasis: "nominal",
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
    rateBasis: "nominal",
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

// productType is a TEMPLATE only — it never drives the calculation itself
// (see growth-pipeline.js header comment). Picking it here just pre-fills
// sensible defaults for the fields that actually do: calcMethod, compounding,
// rateBasis. The user can still override any of them afterwards. Only fields
// left empty/unset by the user are touched — this never overwrites a value
// they already typed in.
const PRODUCT_TYPE_DEFAULTS = {
  savings: { calcMethod: "lowestMonthlyBalance", compounding: true, rateBasis: "nominal" },
  fixedDeposit: { calcMethod: "lowestMonthlyBalance", compounding: true, rateBasis: "nominal" },
  certificate: { calcMethod: "fixedPrincipal", compounding: false, rateBasis: "nominal" },
  moneyMarketFund: { calcMethod: "navBased", compounding: true, rateBasis: "effective" },
  fixedIncomeFund: { calcMethod: "navBased", compounding: true, rateBasis: "effective" },
  investmentFund: { calcMethod: "navBased", compounding: true, rateBasis: "effective" },
};

function applyProductTypeDefaults(productType) {
  const defaults = PRODUCT_TYPE_DEFAULTS[productType];
  if (!defaults) return;
  const setIfEmpty = (fieldId, value) => {
    const el = document.getElementById(fieldId);
    if (el && !el.value) el.value = String(value);
  };
  setIfEmpty("rc-calcMethod", defaults.calcMethod);
  setIfEmpty("rc-compounding", defaults.compounding);
  setIfEmpty("rc-rateBasis", defaults.rateBasis);
  previewReturnCategory();
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
  set("rc-rateBasis", p.rateBasis || "");
  set("rc-calcMethod", p.calcMethod);
  set("rc-payoutFreq", p.payoutFreq);
  set("rc-compounding", p.compounding);
  set("rc-liquidity", p.liquidity);
  set("rc-apy", p.suggestedApy);
  set("rc-tierRates", p.tierRates ? p.tierRates.join(",") : "");
  set("rc-growthFormula", "");
  previewReturnCategory();
  previewGrowthFormula();
}

function submitReturnConfig(ev) {
  ev.preventDefault();
  const id = returnPanelAssetId;
  if (!id) return;

  const val = (fieldId) => document.getElementById(fieldId).value;
  const productType = val("rc-productType");
  const rateType = val("rc-rateType");
  const rateBasis = val("rc-rateBasis");
  if (!rateBasis) {
    const el = document.getElementById("rc-rateBasis");
    if (el) el.reportValidity ? el.reportValidity() : alert(t("rateBasisRequiredAlert"));
    return;
  }
  const calcMethod = val("rc-calcMethod");
  const payoutFreq = val("rc-payoutFreq");
  const compounding = val("rc-compounding") === "true";
  const liquidity = val("rc-liquidity");
  const apyVal = parseFloat(val("rc-apy"));
  // startDate is no longer edited from this panel — it's the exact same
  // returnConfig[id].startDate field the per-row "Since" button
  // (since-date.js) manages, kept here only so saving this form doesn't
  // wipe out whatever that button already set.
  const startDate = (returnConfig[id] && returnConfig[id].startDate) || null;
  const tierRates = val("rc-tierRates")
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
  const growthFormula = val("rc-growthFormula").trim();

  returnConfig[id] = {
    productType: productType || null,
    rateType: rateType || null,
    rateBasis: rateBasis || null,
    calcMethod: calcMethod || null,
    payoutFreq: payoutFreq || null,
    compounding,
    liquidity: liquidity || null,
    startDate: startDate || null,
    tierRates: tierRates.length ? tierRates : null,
    growthFormula: growthFormula || null,
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

// evalGrowthFormula / segmentInterest now live in growth-pipeline.js (shared
// with the backend and the simulator — see that file's header comment).

// Live "if I plug in X" example shown right under the formula box in the
// panel, using whatever amount/rate/days the user has typed elsewhere in
// the form — so mistakes show up immediately, not three clicks later in
// the simulator.
function previewGrowthFormula() {
  const el = document.getElementById("rc-growthFormula");
  const out = document.getElementById("rc-formula-preview");
  if (!el || !out) return;
  const formula = el.value;
  const rateEl = document.getElementById("rc-apy");
  const rate = parseFloat(rateEl && rateEl.value) || 18;
  const principal = 10000;
  const days = 30;
  if (!formula.trim()) {
    out.textContent = t("growthFormulaDefaultNote");
    return;
  }
  const result = evalGrowthFormula(formula, principal, rate, days);
  out.textContent =
    result == null
      ? t("growthFormulaErrorNote")
      : `${t("growthFormulaPreviewLabel")}: principal=${principal}, rate=${rate}%, days=${days} → ${fmtFormulaNum(result, 4)}`;
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
        <div class="wt-field-row-5">
          <div class="wt-field">
            <label for="rc-productType">${t("productTypeLabel")}</label>
            <select id="rc-productType" onchange="applyProductTypeDefaults(this.value)">${optionsHtml(t("productTypeOptions"), cfg.productType)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-rateType">${t("rateTypeLabel")}</label>
            <select id="rc-rateType">${optionsHtml(t("rateTypeOptions"), cfg.rateType)}</select>
          </div>
          <div class="wt-field">
            <label for="rc-rateBasis">${t("rateBasisLabel")} <span style="color:var(--wt-danger,#e05252)">*</span></label>
            <select id="rc-rateBasis" required title="${t("rateBasisHint")}">
              <option value="" disabled ${!cfg.rateBasis ? "selected" : ""}>${t("rateBasisChoosePrompt")}</option>
              ${Object.keys(t("rateBasisOptions"))
                .map(
                  (k) =>
                    `<option value="${k}" ${k === cfg.rateBasis ? "selected" : ""}>${t("rateBasisOptions")[k]}</option>`
                )
                .join("")}
            </select>
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
            <label for="rc-tierRates">${t("tierRatesLabel")}</label>
            <input type="text" id="rc-tierRates" placeholder="27,22,17" dir="ltr"
              value="${Array.isArray(cfg.tierRates) ? cfg.tierRates.join(",") : ""}">
          </div>
        </div>
        <p style="font-size:11px;color:var(--wt-text-dim);margin:8px 0 4px">${t("tierRatesHint")}</p>

        <!-- Custom growth formula — overrides the built-in interest math for
             THIS item only, everywhere it's used (simulator, table columns,
             and the real daily cron), without needing a code change. Leave
             blank to keep using the built-in default for whatever
             calculation/payout settings are picked above. -->
        <div class="wt-field">
          <label for="rc-growthFormula">${t("growthFormulaLabel")}</label>
          <textarea id="rc-growthFormula" dir="ltr" rows="2" spellcheck="false"
            placeholder="principal * (rate/100/365) * days"
            oninput="previewGrowthFormula()">${esc(cfg.growthFormula || "")}</textarea>
          <p style="font-size:11px;color:var(--wt-text-dim);margin:4px 0 0">${t("growthFormulaHint")}</p>
          <p id="rc-formula-preview" class="wt-return-summary-category" style="margin-top:6px">${t("growthFormulaDefaultNote")}</p>
        </div>

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

// parseDateStr / daysBetweenDates / addYearsToDate now live in
// growth-pipeline.js (loaded before this file — see index.html).

// Short human-readable date for the small "as of" label shown under each
// projection amount in the table (e.g. "12 Jul 2026" / "١٢ يوليو ٢٠٢٦").
// Reuses the month-name lists already defined in contributions.js.
function fmtDateShort(d) {
  const monthName = lang === "ar" ? MONTH_NAMES_AR[d.getMonth()] : MONTH_NAMES_EN[d.getMonth()];
  return `${d.getDate()} ${monthName} ${d.getFullYear()}`;
}

// All growth-model math (periodic-boundary, flat/certificate, tiered,
// nominal↔effective conversion) now lives in growth-pipeline.js — the single
// source of truth shared with the backend cron and the simulator. This is
// now a thin wrapper that just pulls this item's live `apy`/`returnConfig`
// globals and hands them to the shared projectValueAt().
function computeGrowthValueAt(assetId, principal, fromDate, targetDate) {
  const cfg = returnConfig[assetId] || {};
  const rate = apy[assetId] || 0;
  return projectValueAt(principal, rate, cfg, fromDate, targetDate, undefined, true);
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

// monthsStepForFreq now lives in growth-pipeline.js.

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
