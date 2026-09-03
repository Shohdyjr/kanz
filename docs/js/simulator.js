// ══════════════════════════════════════════════════════
//  "What if" simulator — a standalone calculator opened from its own button
//  in the table header (like the return-config panel). The user picks an
//  item, an amount, and a target date; this shows:
//    1) The projected total on that date (same growth models as the
//       read-only projection columns in return-config.js — tiered
//       certificate compounding if configured, custom formula, simple flat,
//       periodic-boundary staircase, or daily compounding — whichever
//       matches the item's actual Return Settings).
//    2) The actual EGP/USD/etc amount the balance grows by per day, per
//       month, and per year at the item's current rate — regardless of
//       the product's real payout frequency, since the user wants to see
//       all three, not just the one that matches the configured cycle.
//  A per-run APY/APR toggle lets the user see the item's real, saved rate
//  relabeled as its mathematically-equivalent APR or APY expression — it's
//  a display choice only: switching it never changes the projected amount,
//  since that's always driven by the item's own real Return Settings.
//  Purely a read-only estimate: never writes back to qty/apy/history.
// ══════════════════════════════════════════════════════

function openSimModal(assetId) {
  simModalOpen = true;
  // Prefer an explicitly-passed asset (opened from a specific row). Otherwise
  // keep whatever the user had selected last time (the header button passes
  // no id), and only fall back to the first asset if there's nothing valid.
  const prevAssetId = simAssetId;
  if (assetId && ASSETS.some((a) => a.id === assetId)) {
    simAssetId = assetId;
  } else if (!simAssetId || !ASSETS.some((a) => a.id === simAssetId)) {
    simAssetId = ASSETS.length ? ASSETS[0].id : null;
  }
  if (simAmount == null && simAssetId) simAmount = qty[simAssetId] || "";
  if (!simStartDate) simStartDate = todayLocalStr();
  if (!simDate) simDate = todayLocalStr();
  // Re-opening for a different item than last time — drop any basis
  // override so it defaults back to that item's own Return Settings.
  if (simAssetId !== prevAssetId) simRateBasis = null;
  render();
  setTimeout(() => {
    const el = document.getElementById("sim-amount");
    if (el) el.focus();
  }, 40);
}

function closeSimModal() {
  simModalOpen = false;
  render();
}

// Re-renders just the modal body so switching item/amount/date doesn't
// disturb the rest of the page (same pattern as onReturnPanelAssetChange).
function onSimInputChange() {
  const assetEl = document.getElementById("sim-asset");
  const amtEl = document.getElementById("sim-amount");
  const startDateEl = document.getElementById("sim-start-date");
  const dateEl = document.getElementById("sim-date");
  const newAssetId = assetEl ? assetEl.value || null : simAssetId;
  // Switched to a different item — the basis override no longer applies,
  // fall back to whatever that item's own Return Settings say.
  if (newAssetId !== simAssetId) simRateBasis = null;
  simAssetId = newAssetId;
  simAmount = amtEl ? amtEl.value : simAmount;
  simStartDate = startDateEl ? startDateEl.value : simStartDate;
  simDate = dateEl ? dateEl.value : simDate;

  // Re-rendering the modal replaces the DOM node the user is typing in, which
  // drops focus after every single keystroke (looked like "have to click for
  // every digit"). Remember what was focused + the cursor position, rebuild
  // the modal, then restore both on the fresh element.
  const active = document.activeElement;
  const activeId = active && active.id;
  const canSelect = active && "selectionStart" in active;
  const selStart = canSelect ? active.selectionStart : null;
  const selEnd = canSelect ? active.selectionEnd : null;

  const root = document.getElementById("wt-sim-modal-root");
  if (root) root.outerHTML = renderSimModal();

  if (activeId) {
    const newEl = document.getElementById(activeId);
    if (newEl) {
      newEl.focus();
      if (selStart != null) {
        try {
          newEl.setSelectionRange(selStart, selEnd);
        } catch (e) {
          // Some input types (e.g. number/date) don't support selection ranges — ignore.
        }
      }
    }
  }
}

// Flips the simulator's basis override (APY <-> APR) for the current item
// only, and re-renders. Doesn't touch returnConfig / scheduleSave — this is
// a "what if I read this rate the other way" toggle, nothing is saved.
function setSimRateBasis(basis) {
  simRateBasis = basis;
  const root = document.getElementById("wt-sim-modal-root");
  if (root) root.outerHTML = renderSimModal();
}

// Same growth model as computeGrowthValueAt (return-config.js) — both are
// now thin wrappers around the shared projectValueAt() in growth-pipeline.js.
// Here the Nominal-APR/Effective-APY basis is an explicit parameter instead
// REDESIGNED (2026-08-27): this used to pass the user's toggle selection
// straight through as `basisOverride`, so picking the basis that DIDN'T
// match the item's real, saved rateBasis silently reinterpreted the raw
// stored number as if it meant something else — genuinely changing the
// projected EGP/USD outcome depending only on which button was clicked, for
// a number the person already configured for real in Return Settings. That
// makes no sense for a real account: 15% APR on a real Mashreq certificate
// IS a fixed, single real-world outcome — it can't earn two different
// dollar amounts depending on which label you're currently looking at.
// The money math must always use the item's own actual cfg.rateBasis,
// never the toggle — the toggle is now purely a relabeling/display choice
// (see simDisplayedRate below), and never changes what gets projected.
function simComputeGrowthValueAt(assetId, principal, fromDate, targetDate) {
  const cfg = returnConfig[assetId] || {};
  const rate = apy[assetId] || 0;
  return projectValueAt(principal, rate, cfg, fromDate, targetDate);
}

// The rate as it would read under the SELECTED basis toggle, purely for
// display — the item's real cfg.rateBasis (defaulting to "effective" if
// never set, same default used elsewhere) is the number's one true
// meaning; when the toggle matches it, this returns the raw stored value
// untouched. When the toggle is set to the OTHER basis, this converts the
// SAME real, fixed rate into its mathematically-equivalent expression
// under that unit — informational only, and — critically — this value is
// NEVER fed back into simComputeGrowthValueAt above, so switching the
// toggle relabels the number shown but never changes the projected
// EGP/USD amount.
function simDisplayedRate(cfg, rate, basis) {
  const nativeBasis = cfg.rateBasis || "effective";
  if (basis === nativeBasis) return rate;
  const compounds = cfg.compoundingFrequency && cfg.compoundingFrequency !== "none";
  const monthsStep = monthsStepForFreq(cfg.growthFrequency);
  if (cfg.growthSource !== "nav" && cfg.startDate && monthsStep && compounds) {
    const periodsPerYear = 12 / monthsStep;
    return nativeBasis === "nominal" ? nominalToEffective(rate, periodsPerYear) : effectiveToNominal(rate, periodsPerYear);
  }
  if (!cfg.growthFormula && compounds) {
    return nativeBasis === "nominal" ? nominalToEffective(rate, 365) : effectiveToNominal(rate, 365);
  }
  return rate;
}

// Effective per-day / per-month / per-year growth amounts an `amount`
// balance earns — computed via simComputeGrowthValueAt (which always uses
// the item's real cfg.rateBasis; see its comment) over a 1-day / 1-month /
// 1-year window starting at `fromDate`. No `basis` parameter: the toggle
// no longer affects the projected amount, only simDisplayedRate's label.
function simIncrementAmounts(assetId, amount, fromDate) {
  if (!amount) return null;
  const oneDayLater = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + 1);
  const oneMonthLater = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, fromDate.getDate());
  const oneYearLater = new Date(fromDate.getFullYear() + 1, fromDate.getMonth(), fromDate.getDate());
  return {
    daily: simComputeGrowthValueAt(assetId, amount, fromDate, oneDayLater) - amount,
    monthly: simComputeGrowthValueAt(assetId, amount, fromDate, oneMonthLater) - amount,
    yearly: simComputeGrowthValueAt(assetId, amount, fromDate, oneYearLater) - amount,
  };
}

// Same growth model used for the table's projection columns, with an
// arbitrary principal + start date instead of always the live qty/today.
// No `basis` parameter — see simIncrementAmounts above.
function simProjectedValue(assetId, amount, startDateStr, targetDateStr) {
  if (!amount || !targetDateStr) return null;
  const targetDate = parseDateStr(targetDateStr);
  const startDate = startDateStr ? parseDateStr(startDateStr) : new Date();
  return simComputeGrowthValueAt(assetId, amount, startDate, targetDate);
}

// Days between the sim's start/target dates, clamped to 0 — used both for the
// projection and for the formula text and the "computing over N days" label.
function simDaysBetween(startDateStr, targetDateStr) {
  if (!startDateStr || !targetDateStr) return 0;
  return Math.max(0, daysBetweenDates(parseDateStr(startDateStr), parseDateStr(targetDateStr)));
}

// Small helper to format a rate/number for display inside a formula string —
// always LTR digits, trimmed of unnecessary trailing zeros.
function fmtFormulaNum(n, maxDigits) {
  const digits = maxDigits == null ? 4 : maxDigits;
  return Number(n.toFixed(digits)).toString();
}

function renderSimModal() {
  if (!simModalOpen) return `<div id="wt-sim-modal-root"></div>`;

  const a = ASSETS.find((x) => x.id === simAssetId);
  const minDate = todayLocalStr();

  const assetPicker = `
      <div class="wt-field">
        <label for="sim-asset">${t("simItemLabel")}</label>
        <select id="sim-asset" onchange="onSimInputChange()">
          ${ASSETS.map((x) => `<option value="${x.id}" ${x.id === simAssetId ? "selected" : ""}>${esc(x.icon)} ${esc(assetName(x))}</option>`).join("")}
        </select>
      </div>`;

  if (!a) {
    return `<div id="wt-sim-modal-root">
    <div class="wt-modal-overlay" onclick="if(event.target===this)closeSimModal()">
      <div class="wt-modal wt-modal-wide">
        <h3>${t("simModalTitle")}</h3>
        <p class="wt-sim-subtitle">${t("simModalHint")}</p>
        <p class="wt-sim-note">${t("noAssetsHint")}</p>
        <div class="wt-modal-actions">
          <button type="button" class="wt-btn" onclick="closeSimModal()">${t("close")}</button>
        </div>
      </div>
    </div>
    </div>`;
  }

  const amount = parseFloat(simAmount) || 0;
  const rate = apy[a.id] || 0;
  const cfg = returnConfig[a.id] || {};
  const isTiered = !!(cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length);
  const compounds = cfg.compoundingFrequency && cfg.compoundingFrequency !== "none";
  const monthsStep = monthsStepForFreq(cfg.growthFrequency);
  const isPeriodicBoundary = !isTiered && cfg.growthSource !== "nav" && !!(cfg.startDate && monthsStep && compounds);
  const isSimpleFlat = !isTiered && !isPeriodicBoundary && cfg.growthSource !== "nav" && !compounds;
  const hasCustomFormula = !isTiered && cfg.growthSource === "manual" && !!cfg.growthFormula;
  const startDateVal = simStartDate || minDate;

  // The basis this run actually uses: the user's per-run toggle if they've
  // touched it, otherwise whatever the item's own Return Settings say. Only
  // meaningful for the periodic-boundary and plain-daily-compounding
  // branches — tiered certificates, custom formulas, and simple-flat items
  // don't run any Nominal/Effective conversion in the first place.
  const basisMatters = !isTiered && !hasCustomFormula && !isSimpleFlat;
  const basis = simRateBasis || cfg.rateBasis || "effective";

  const inc = rate || isTiered ? simIncrementAmounts(a.id, amount, parseDateStr(startDateVal)) : null;
  const projected = amount && simDate ? simProjectedValue(a.id, amount, startDateVal, simDate) : null;
  const profit = projected != null ? projected - amount : null;
  const days = simDaysBetween(startDateVal, simDate);

  const noRateNote = !rate && !isTiered ? `<p class="wt-sim-note">${t("simNoRateHint")}</p>` : "";

  const basisToggle =
    rate && basisMatters
      ? `<div class="wt-sim-basis-toggle" role="group" aria-label="${t("simBasisToggleLabel")}">
          <span class="wt-sim-basis-toggle-label">${t("simBasisToggleLabel")}</span>
          <button type="button" class="wt-btn-ghost wt-sim-basis-btn ${basis === "nominal" ? "is-active" : ""}"
            onclick="setSimRateBasis('nominal')">APR</button>
          <button type="button" class="wt-btn-ghost wt-sim-basis-btn ${basis === "effective" ? "is-active" : ""}"
            onclick="setSimRateBasis('effective')">APY</button>
        </div>`
      : "";

  const daysLabel =
    simDate && startDateVal
      ? `<p class="wt-sim-days-label" dir="ltr">${esc(fmtDateShort(parseDateStr(startDateVal)))} → ${esc(fmtDateShort(parseDateStr(simDate)))} = <b>${days}</b> ${t("simDaysUnit")}</p>`
      : "";

  const incRow = (labelKey, val) => `
    <div class="wt-sim-inc-row">
      <span>${t(labelKey)}</span>
      <b class="${val >= 0 ? "wt-sim-pos" : "wt-sim-neg"}">+${fmtByCurrencyPrecise(val, a.currency)}</b>
    </div>`;

  // Plain-language versions of the exact formulas used above, with the
  // user's own numbers substituted in, so the % and the math behind it are
  // visible and not just the final result. rateStr is always the item's
  // REAL, native rate — the same number simComputeGrowthValueAt actually
  // multiplied — so the printed arithmetic is always internally
  // consistent and checks out if you do the multiplication yourself. The
  // toggle's relabeled equivalent (equivRateStr) is shown as a separate
  // informational line instead of being substituted into the formula —
  // substituting it in used to make the formula text lie about its own
  // arithmetic whenever the toggle didn't match the item's native basis
  // (the printed rate wouldn't actually multiply out to the printed
  // result anymore).
  const rateStr = fmtFormulaNum(rate, 4);
  const nativeBasis = cfg.rateBasis || "effective";
  const equivRate = basisMatters ? simDisplayedRate(cfg, rate, basis) : null;
  const equivRateLine =
    basisMatters && basis !== nativeBasis
      ? `<p class="wt-sim-rate-equiv" dir="auto">${t("simEquivRateLabel")(fmtFormulaNum(equivRate, 4), basis === "nominal" ? "APR" : "APY")}</p>`
      : "";
  const amountStr = fmtFormulaNum(amount, 2);
  let incFormula = "";
  if (inc && hasCustomFormula) {
    incFormula = `<p class="wt-sim-formula" dir="ltr">${t("simCustomFormulaLabel")}: ${esc(cfg.growthFormula)}<br>
      → ${fmtFormulaNum(inc.daily, 4)} ${esc(a.currency)} / ${t("simDaily")}, ${fmtFormulaNum(inc.monthly, 4)} ${esc(a.currency)} / ${t("simMonthly")}, ${fmtFormulaNum(inc.yearly, 2)} ${esc(a.currency)} / ${t("simYearly")}</p>`;
  } else if (inc && isPeriodicBoundary) {
    incFormula = `<p class="wt-sim-formula" dir="ltr">${amountStr} × (${rateStr}/100/365) × 1 = ${fmtFormulaNum(inc.daily, 4)} ${esc(a.currency)} / ${t("simDaily")}<br>
      ${t("simPeriodicIncHint")}<br>
      → ${fmtFormulaNum(inc.monthly, 4)} ${esc(a.currency)} / ${t("simMonthly")}, ${fmtFormulaNum(inc.yearly, 2)} ${esc(a.currency)} / ${t("simYearly")}</p>`;
  } else if (inc && isSimpleFlat) {
    incFormula = `<p class="wt-sim-formula" dir="ltr">${amountStr} × ${rateStr}/100/365 × 1 = ${fmtFormulaNum(inc.daily, 4)} ${esc(a.currency)} / ${t("simDaily")}<br>
      ${t("simSimpleFlatHint")}</p>`;
  } else if (inc && !isTiered) {
    incFormula = `<p class="wt-sim-formula" dir="ltr">${amountStr} × ((1 + ${rateStr}/100)^(1/365) − 1) = ${fmtFormulaNum(inc.daily, 4)} ${esc(a.currency)} / ${t("simDaily")}<br>
         ${amountStr} × ((1 + ${rateStr}/100)^(1/12) − 1) = ${fmtFormulaNum(inc.monthly, 4)} ${esc(a.currency)} / ${t("simMonthly")}<br>
         ${amountStr} × ((1 + ${rateStr}/100)^(1) − 1) = ${fmtFormulaNum(inc.yearly, 4)} ${esc(a.currency)} / ${t("simYearly")}</p>`;
  }

  let totalFormula = "";
  if (projected != null && isTiered) {
    totalFormula = `<p class="wt-sim-formula">${t("simTieredFormulaHint")}</p>`;
  } else if (projected != null && hasCustomFormula) {
    totalFormula = `<p class="wt-sim-formula" dir="ltr">${t("simCustomFormulaLabel")}: ${esc(cfg.growthFormula)}<br>
      ${t("simResultLabel")} = ${fmtFormulaNum(projected, 2)} ${esc(a.currency)}</p>`;
  } else if (projected != null && isPeriodicBoundary) {
    totalFormula = `<p class="wt-sim-formula" dir="ltr">${t("simPeriodicFormulaHint")}<br>
      ${amountStr} × (${rateStr}/100/365) × ${t("simDaysInEachPeriod")} → ${t("simAddedAtBoundary")}<br>
      ${t("simResultLabel")} = ${fmtFormulaNum(projected, 2)} ${esc(a.currency)}</p>`;
  } else if (projected != null && isSimpleFlat) {
    totalFormula = `<p class="wt-sim-formula" dir="ltr">${amountStr} + (${amountStr} × ${rateStr}/100/365 × ${days}) = ${fmtFormulaNum(projected, 2)} ${esc(a.currency)}<br>${t("simSimpleFlatHint")}</p>`;
  } else if (projected != null) {
    totalFormula = `<p class="wt-sim-formula" dir="ltr">${amountStr} × (1 + ${rateStr}/100)^(${days}/365) = ${fmtFormulaNum(projected, 2)} ${esc(a.currency)}</p>`;
  }

  return `<div id="wt-sim-modal-root">
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeSimModal()">
    <div class="wt-modal wt-modal-wide">
      <h3>${t("simModalTitle")}</h3>
      <p class="wt-sim-subtitle">${t("simModalHint")}</p>

      <div class="wt-field-row-5">
        ${assetPicker}
        <div class="wt-field">
          <label for="sim-amount">${t("simAmountLabel")} (${a.currency})</label>
          <input type="number" id="sim-amount" min="0" step="any" dir="ltr"
            value="${simAmount ?? ""}" placeholder="0" oninput="onSimInputChange()">
        </div>
        <div class="wt-field">
          <label for="sim-start-date">${t("simStartDateLabel")}</label>
          <input type="date" id="sim-start-date" dir="ltr"
            value="${startDateVal}" onchange="onSimInputChange()">
        </div>
        <div class="wt-field">
          <label for="sim-date">${t("simDateLabel")}</label>
          <input type="date" id="sim-date" min="${startDateVal}" dir="ltr"
            value="${simDate || ""}" onchange="onSimInputChange()">
        </div>
      </div>

      ${daysLabel}
      ${noRateNote}
      ${basisToggle}
      ${equivRateLine}

      <div class="wt-sim-results">
        ${
          inc
            ? `<div class="wt-sim-inc-block">
          <p class="wt-sim-block-title">${t("simIncreaseTitle")}</p>
          ${incRow("simDaily", inc.daily)}
          ${incRow("simMonthly", inc.monthly)}
          ${incRow("simYearly", inc.yearly)}
          ${incFormula}
        </div>`
            : ""
        }

        ${
          projected != null
            ? `<div class="wt-sim-total-block">
          <p class="wt-sim-block-title">${t("simOnDateTitle")}(${esc(simDate)})</p>
          <div class="wt-sim-total-row">
            <span>${t("simProjectedTotal")}${cfg.growthSource === "nav" ? ` <span class="wt-proj-date" title="${t("projEstimateHint")}">≈</span>` : ""}</span>
            <b>${fmtByCurrencyPrecise(projected, a.currency)}</b>
          </div>
          <div class="wt-sim-total-row">
            <span>${t("simProjectedProfit")}</span>
            <b class="${profit >= 0 ? "wt-sim-pos" : "wt-sim-neg"}">${profit >= 0 ? "+" : ""}${fmtByCurrencyPrecise(profit, a.currency)}</b>
          </div>
          ${totalFormula}
        </div>`
            : ""
        }
      </div>

      <div class="wt-modal-actions">
        <button type="button" class="wt-btn-ghost" onclick="openReturnPanel('${a.id}')">${t("returnConfigBtnTitle")}</button>
        <button type="button" class="wt-btn" onclick="closeSimModal()">${t("close")}</button>
      </div>
    </div>
  </div>
  </div>`;
}
