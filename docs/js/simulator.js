// ══════════════════════════════════════════════════════
//  "What if" simulator — a standalone calculator opened from its own button
//  in the table header (like the return-config panel). The user picks an
//  item, an amount, and a target date; this shows:
//    1) The projected total on that date (reusing the exact same growth
//       math as the read-only projection columns in return-config.js —
//       tiered certificate compounding if configured, otherwise the flat
//       APY compounded daily).
//    2) The actual EGP/USD/etc amount the balance grows by per day, per
//       month, and per year at the item's current rate — regardless of
//       the product's real payout frequency, since the user wants to see
//       all three, not just the one that matches the configured cycle.
//  Purely a read-only estimate: never writes back to qty/apy/history.
// ══════════════════════════════════════════════════════

function openSimModal(assetId) {
  simModalOpen = true;
  // Prefer an explicitly-passed asset (opened from a specific row). Otherwise
  // keep whatever the user had selected last time (the header button passes
  // no id), and only fall back to the first asset if there's nothing valid.
  if (assetId && ASSETS.some((a) => a.id === assetId)) {
    simAssetId = assetId;
  } else if (!simAssetId || !ASSETS.some((a) => a.id === simAssetId)) {
    simAssetId = ASSETS.length ? ASSETS[0].id : null;
  }
  if (simAmount == null && simAssetId) simAmount = qty[simAssetId] || "";
  if (!simStartDate) simStartDate = todayLocalStr();
  if (!simDate) simDate = todayLocalStr();
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
  if (assetEl) simAssetId = assetEl.value || null;
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

// Effective per-day / per-month / per-year growth amounts an `amount`
// balance earns — computed by calling computeGrowthValueAt (the SAME
// function the table's projection columns and the "projected total" below
// use) over a 1-day / 1-month / 1-year window starting at `fromDate`. This
// guarantees the numbers here can never drift from what the rest of the
// app shows for the same item — no separate formula to keep in sync.
function simIncrementAmounts(assetId, amount, fromDate) {
  if (!amount) return null;
  const oneDayLater = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + 1);
  const oneMonthLater = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, fromDate.getDate());
  const oneYearLater = new Date(fromDate.getFullYear() + 1, fromDate.getMonth(), fromDate.getDate());
  return {
    daily: computeGrowthValueAt(assetId, amount, fromDate, oneDayLater) - amount,
    monthly: computeGrowthValueAt(assetId, amount, fromDate, oneMonthLater) - amount,
    yearly: computeGrowthValueAt(assetId, amount, fromDate, oneYearLater) - amount,
  };
}

// Same growth model used for the table's projection columns
// (computeGrowthValueAt in return-config.js), just with an arbitrary
// principal + start date instead of always the live qty/today.
function simProjectedValue(assetId, amount, startDateStr, targetDateStr) {
  if (!amount || !targetDateStr) return null;
  const targetDate = parseDateStr(targetDateStr);
  const startDate = startDateStr ? parseDateStr(startDateStr) : new Date();
  return computeGrowthValueAt(assetId, amount, startDate, targetDate);
}

// Days between the sim's start/target dates, clamped to 0 — used both for the
// projection and for the formula text shown to the user.
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

// Tiny, non-intrusive hint: if the item's rate is stored as APY (effective),
// show what that works out to as a Nominal APR, and vice versa — just the
// one extra number, using the same nominalToEffective/effectiveToNominal
// conversion the real growth math already uses (so it's never a separate,
// possibly-inconsistent formula). Uses the product's own compounding
// frequency (monthly/quarterly/etc from payoutFreq) when configured, since
// that's the frequency the rate basis actually corresponds to; falls back to
// daily (365) to match the daily-compounding assumption used elsewhere for
// items with no periodic payout configured.
function otherBasisEquivalent(cfg, rate) {
  if (!cfg || !cfg.rateBasis || !rate) return null;
  const monthsStep = monthsStepForFreq(cfg.payoutFreq);
  const m = monthsStep ? 12 / monthsStep : 365;
  if (cfg.rateBasis === "effective") {
    return { labelKey: "simApyToAprLabel", value: effectiveToNominal(rate, m) };
  }
  return { labelKey: "simAprToApyLabel", value: nominalToEffective(rate, m) };
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
  const monthsStep = monthsStepForFreq(cfg.payoutFreq);
  const isPeriodicBoundary = !isTiered && !!(cfg.startDate && monthsStep && cfg.compounding === true);
  const isSimpleFlat = !isTiered && !isPeriodicBoundary && cfg.compounding === false;
  const hasCustomFormula = !isTiered && !!cfg.growthFormula;
  const startDateVal = simStartDate || minDate;

  const inc = rate || isTiered ? simIncrementAmounts(a.id, amount, parseDateStr(startDateVal)) : null;
  const projected = amount && simDate ? simProjectedValue(a.id, amount, startDateVal, simDate) : null;
  const profit = projected != null ? projected - amount : null;
  const days = simDaysBetween(startDateVal, simDate);

  const noRateNote = !rate && !isTiered ? `<p class="wt-sim-note">${t("simNoRateHint")}</p>` : "";
  const otherBasis = rate ? otherBasisEquivalent(cfg, rate) : null;
  const otherBasisNote = otherBasis
    ? `<p class="wt-sim-note" dir="ltr" style="font-size:11px">${t(otherBasis.labelKey)}: ${fmtFormulaNum(otherBasis.value, 2)}%</p>`
    : "";

  const incRow = (labelKey, val) => `
    <div class="wt-sim-inc-row">
      <span>${t(labelKey)}</span>
      <b class="${val >= 0 ? "wt-sim-pos" : "wt-sim-neg"}">+${fmtByCurrencyPrecise(val, a.currency)}</b>
    </div>`;

  // Plain-language versions of the exact formulas used above, with the
  // user's own numbers substituted in, so the % and the math behind it are
  // visible and not just the final result.
  const rateStr = fmtFormulaNum(rate, 4);
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

      ${noRateNote}
      ${otherBasisNote}

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
            <span>${t("simProjectedTotal")}</span>
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
