// ══════════════════════════════════════════════════════
//  "What if" simulator — a standalone modal opened from each row.
//  The user types an amount + a target date; this shows:
//    1) The projected total on that date (reusing the exact same growth
//       math as the read-only projection columns in return-config.js —
//       tiered certificate compounding if configured, otherwise the flat
//       APY compounded daily).
//    2) The actual EGP/USD/etc amount the balance grows by per day, per
//       month, and per year at the asset's current rate — regardless of
//       the product's real payout frequency, since the user wants to see
//       all three, not just the one that matches the configured cycle.
//  Purely a read-only estimate: never writes back to qty/apy/history.
// ══════════════════════════════════════════════════════

function openSimModal(assetId) {
  simModalOpen = true;
  simAssetId = assetId || null;
  if (simAmount == null) simAmount = qty[assetId] || "";
  if (!simDate) simDate = todayLocalStr();
  render();
  setTimeout(() => {
    const el = document.getElementById("sim-amount");
    if (el) el.focus();
  }, 40);
}

function closeSimModal() {
  simModalOpen = false;
  simAssetId = null;
  render();
}

function onSimInputChange() {
  const amtEl = document.getElementById("sim-amount");
  const dateEl = document.getElementById("sim-date");
  simAmount = amtEl ? amtEl.value : simAmount;
  simDate = dateEl ? dateEl.value : simDate;
  const root = document.getElementById("wt-sim-modal-root");
  if (root) root.outerHTML = renderSimModal();
}

// Effective per-day / per-month / per-year growth amounts an `amount`
// balance earns at the given annual rate — i.e. "how much does it actually
// go up by" at each cadence, not just the abstract %. Derived from the same
// annual-compounding rate the rest of the app already uses, so a "daily"
// product and a "monthly" product with the same APY show the same yearly
// total, just split differently.
function simIncrementAmounts(rate, amount) {
  if (!rate || !amount) return null;
  const dailyFactor = Math.pow(1 + rate / 100, 1 / 365) - 1;
  const monthlyFactor = Math.pow(1 + rate / 100, 1 / 12) - 1;
  const yearlyFactor = Math.pow(1 + rate / 100, 1) - 1;
  return {
    daily: amount * dailyFactor,
    monthly: amount * monthlyFactor,
    yearly: amount * yearlyFactor,
  };
}

// Same growth model as projectAssetValue() in return-config.js, but takes an
// arbitrary principal + target date instead of always using the live qty/today.
function simProjectedValue(assetId, amount, targetDateStr) {
  if (!amount || !targetDateStr) return null;
  const cfg = returnConfig[assetId] || {};
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetDate = parseDateStr(targetDateStr);

  if (cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length) {
    return tieredValueAt(amount, cfg.startDate, cfg.tierRates, targetDate);
  }
  const rate = apy[assetId] || 0;
  if (!rate) return amount;
  const days = Math.max(0, daysBetweenDates(todayMid, targetDate));
  return amount * Math.pow(1 + rate / 100, days / 365);
}

function renderSimModal() {
  const a = ASSETS.find((x) => x.id === simAssetId);
  if (!a) {
    return `<div id="wt-sim-modal-root"></div>`;
  }

  const amount = parseFloat(simAmount) || 0;
  const rate = apy[a.id] || 0;
  const cfg = returnConfig[a.id] || {};
  const isTiered = !!(cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length);
  const minDate = todayLocalStr();

  const inc = simIncrementAmounts(rate, amount);
  const projected = amount && simDate ? simProjectedValue(a.id, amount, simDate) : null;
  const profit = projected != null ? projected - amount : null;

  const noRateNote = !rate && !isTiered ? `<p class="wt-sim-note">${t("simNoRateHint")}</p>` : "";

  const incRow = (labelKey, val) => `
    <div class="wt-sim-inc-row">
      <span>${t(labelKey)}</span>
      <b class="${val >= 0 ? "wt-sim-pos" : "wt-sim-neg"}">+${fmtByCurrency(val, a.currency)}</b>
    </div>`;

  return `<div id="wt-sim-modal-root">
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeSimModal()">
    <div class="wt-modal">
      <h3>${t("simModalTitle")} — ${esc(assetName(a))}</h3>
      <p class="wt-sim-subtitle">${t("simModalHint")}</p>

      <div class="wt-field-row-4">
        <div class="wt-field">
          <label for="sim-amount">${t("simAmountLabel")} (${a.currency})</label>
          <input type="number" id="sim-amount" min="0" step="any" dir="ltr"
            value="${simAmount ?? ""}" placeholder="0" oninput="onSimInputChange()">
        </div>
        <div class="wt-field">
          <label for="sim-date">${t("simDateLabel")}</label>
          <input type="date" id="sim-date" min="${minDate}" dir="ltr"
            value="${simDate || ""}" onchange="onSimInputChange()">
        </div>
      </div>

      ${noRateNote}

      ${
        inc
          ? `<div class="wt-sim-inc-block">
        <p class="wt-sim-block-title">${t("simIncreaseTitle")}</p>
        ${incRow("simDaily", inc.daily)}
        ${incRow("simMonthly", inc.monthly)}
        ${incRow("simYearly", inc.yearly)}
      </div>`
          : ""
      }

      ${
        projected != null
          ? `<div class="wt-sim-total-block">
        <p class="wt-sim-block-title">${t("simOnDateTitle")}(${esc(simDate)})</p>
        <div class="wt-sim-total-row">
          <span>${t("simProjectedTotal")}</span>
          <b>${fmtByCurrency(projected, a.currency)}</b>
        </div>
        <div class="wt-sim-total-row">
          <span>${t("simProjectedProfit")}</span>
          <b class="${profit >= 0 ? "wt-sim-pos" : "wt-sim-neg"}">${profit >= 0 ? "+" : ""}${fmtByCurrency(profit, a.currency)}</b>
        </div>
      </div>`
          : ""
      }

      <div class="wt-modal-actions">
        <button type="button" class="wt-btn-ghost" onclick="openReturnPanel('${a.id}')">${t("returnConfigBtnTitle")}</button>
        <button type="button" class="wt-btn" onclick="closeSimModal()">${t("close")}</button>
      </div>
    </div>
  </div>
  </div>`;
}
