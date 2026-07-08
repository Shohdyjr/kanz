// ── Daily history log ────────────────────────────────
function openHistoryModal() {
  historyModalOpen = true;
  histRate = null;
  histRateStatus = "idle";
  histRateError = "";
  renderHistory();
  setTimeout(() => {
    const f = document.getElementById("hist-date");
    if (f) f.focus();
    onHistDateChange(); // fetch the rate for the default date (today) right away
  }, 50);
}

function closeHistoryModal() {
  historyModalOpen = false;
  renderHistory();
}

// Total grams of gold the user currently holds (all GOLD-currency assets)
// used as the default value in the historical snapshot modal for convenience
function currentGoldGrams() {
  return ASSETS.filter((a) => a.currency === "GOLD").reduce((s, a) => s + (parseFloat(qty[a.id]) || 0), 0);
}

// Opens a Google search for that day's ounce gold price
function searchGoldPriceGoogle() {
  const dateEl = document.getElementById("hist-date");
  const date = dateEl ? dateEl.value : "";
  const q = date ? `gold price per ounce on ${date}` : "gold price per ounce";
  window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank");
}

// ── Historical exchange rate (EGP/USD) ─────────────────────
// Fetched from the backend (APILayer) the moment the user picks a date,
// and cached in histRate to convert EGP fields to USD
function onHistDateChange() {
  const dateEl = document.getElementById("hist-date");
  const date = dateEl ? dateEl.value : "";
  if (!date) return;

  histRate = null;
  histRateStatus = "loading";
  histRateError = "";
  renderHistRateBadge();

  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        histRate = { egpPerUsd: j.egpPerUsd, date: j.date };
        histRateStatus = "ok";
      } else {
        histRate = null;
        histRateStatus = "error";
        histRateError = j && j.error ? t(j.error) : t("histRateFailed");
      }
      renderHistRateBadge();
      updateHistEgpPreview();
      updateHistAssetsPreview();
      updateHistTotalPreview();
    })
    .withFailureHandler(function () {
      histRate = null;
      histRateStatus = "error";
      histRateError = t("connectionError");
      renderHistRateBadge();
      updateHistTotalPreview();
    })
    .getHistoricalRate(date);
}

function renderHistRateBadge() {
  const el = document.getElementById("hist-rate-badge");
  if (!el) return;
  if (histRateStatus === "loading") {
    el.className = "wt-hist-rate-badge loading";
    el.textContent = t("histRateFetching");
  } else if (histRateStatus === "ok" && histRate) {
    el.className = "wt-hist-rate-badge ok";
    el.textContent = t("histRatePrefix") + fmtNum(histRate.egpPerUsd, 2) + t("histRateSuffix");
  } else if (histRateStatus === "error") {
    el.className = "wt-hist-rate-badge error";
    el.textContent = "⚠ " + histRateError;
  } else {
    el.className = "wt-hist-rate-badge";
    el.textContent = "";
  }
}

// Converts an EGP amount to USD using the currently available historical rate
function egpToUsdHist(egpAmount) {
  if (!histRate || !histRate.egpPerUsd) return null;
  return egpAmount / histRate.egpPerUsd;
}

function updateHistEgpPreview() {
  const amtEl = document.getElementById("hist-egp-amount");
  const prevEl = document.getElementById("hist-egp-preview");
  if (!amtEl || !prevEl) return;
  const amount = parseFloat(amtEl.value) || 0;
  const usd = egpToUsdHist(amount);
  prevEl.innerHTML = usd === null ? t("histPreviewEmpty") : "≈ <b>" + fmtUsd(usd) + "</b>";
}

function updateHistAssetsPreview() {
  const amtEl = document.getElementById("hist-assets-amount");
  const prevEl = document.getElementById("hist-assets-preview");
  if (!amtEl || !prevEl) return;
  const amount = parseFloat(amtEl.value) || 0;
  const usd = egpToUsdHist(amount);
  prevEl.innerHTML = usd === null ? t("histPreviewEmpty") : "≈ <b>" + fmtUsd(usd) + "</b>";
}

// Live-updates the computed USD value as the user types the ounce price/gram quantity
function updateHistGoldPreview() {
  const ozEl = document.getElementById("hist-gold-oz");
  const gramsEl = document.getElementById("hist-gold-grams");
  const el = document.getElementById("hist-gold-computed");
  if (!ozEl || !gramsEl || !el) return;
  const oz = parseFloat(ozEl.value) || 0;
  const grams = parseFloat(gramsEl.value) || 0;
  const usd = (oz / OUNCE_TO_GRAM) * grams;
  el.textContent = fmtUsd(usd);
  updateHistTotalPreview();
}

// Running total across all categories — updates live at the bottom of the modal
function updateHistTotalPreview() {
  const totalEl = document.getElementById("hist-total-value");
  if (!totalEl) return;

  const egpAmount = parseFloat((document.getElementById("hist-egp-amount") || {}).value) || 0;
  const assetsAmount = parseFloat((document.getElementById("hist-assets-amount") || {}).value) || 0;
  const hardUsd = parseFloat((document.getElementById("hist-hard") || {}).value) || 0;
  const goldOz = parseFloat((document.getElementById("hist-gold-oz") || {}).value) || 0;
  const goldGrams = parseFloat((document.getElementById("hist-gold-grams") || {}).value) || 0;
  const goldUsd = (goldOz / OUNCE_TO_GRAM) * goldGrams;

  const egpUsd = egpToUsdHist(egpAmount) || 0;
  const assetsUsd = egpToUsdHist(assetsAmount) || 0;

  totalEl.textContent = fmtUsd(egpUsd + hardUsd + goldUsd + assetsUsd);
}

function renderHistoryModal() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return `
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeHistoryModal()">
    <div class="wt-modal wt-hist-modal">
      <h3>${t("historyModalTitle")}</h3>
      <p style="font-size:12px;color:var(--wt-text-dim);margin:-8px 0 4px">${t("historyModalHint")}</p>
      <form onsubmit="submitHistoryEntry(event)">
        <div class="wt-field" style="margin-bottom:6px">
          <label for="hist-date">${t("historyDateLabel")}</label>
          <input type="date" id="hist-date" max="${todayStr}" value="${todayStr}" onchange="onHistDateChange()">
          <span id="hist-rate-badge" class="wt-hist-rate-badge"></span>
        </div>

        <div style="height:2px"></div>

        <div class="wt-hist-grid">
        <div class="wt-hist-card c-egp">
          <div class="wt-hist-card-head">
            <span class="wt-hist-card-icon">💰</span>
            <div class="wt-hist-card-titles">
              <span class="wt-hist-card-title">${t("histEgpTitle")}</span>
              <span class="wt-hist-card-hint">${t("histEgpHint")}</span>
            </div>
          </div>
          <label style="font-size:11px;color:var(--wt-text-dim);display:block;margin-bottom:4px" for="hist-egp-amount">${t("histAmountEgp")}</label>
          <input type="number" id="hist-egp-amount" min="0" step="any" placeholder="0" oninput="updateHistEgpPreview();updateHistTotalPreview()">
          <p class="wt-hist-preview" id="hist-egp-preview">${t("histPreviewEmpty")}</p>
        </div>

        <div class="wt-hist-card c-hard">
          <div class="wt-hist-card-head">
            <span class="wt-hist-card-icon">💵</span>
            <div class="wt-hist-card-titles">
              <span class="wt-hist-card-title">${t("histHardTitle")}</span>
              <span class="wt-hist-card-hint">${t("histHardHint")}</span>
            </div>
          </div>
          <label style="font-size:11px;color:var(--wt-text-dim);display:block;margin-bottom:4px" for="hist-hard">${t("histAmountUsd")}</label>
          <input type="number" id="hist-hard" min="0" step="any" placeholder="0" oninput="updateHistTotalPreview()">
        </div>

        <div class="wt-hist-card c-gold">
          <div class="wt-hist-card-head">
            <span class="wt-hist-card-icon">🪙</span>
            <div class="wt-hist-card-titles">
              <span class="wt-hist-card-title">${t("histGoldTitle")}</span>
              <span class="wt-hist-card-hint">${t("histGoldHint")}</span>
            </div>
          </div>
          <button type="button" class="wt-hist-search-btn" onclick="searchGoldPriceGoogle()">${t("searchGoldGoogle")}</button>
          <div class="wt-hist-row2">
            <div>
              <label for="hist-gold-oz">${t("goldOuncePrice")}</label>
              <input type="number" id="hist-gold-oz" min="0" step="any" placeholder="0" oninput="updateHistGoldPreview()">
            </div>
            <div>
              <label for="hist-gold-grams">${t("goldGramsQty")}</label>
              <input type="number" id="hist-gold-grams" min="0" step="any" value="${currentGoldGrams()}" oninput="updateHistGoldPreview()">
            </div>
          </div>
          <p class="wt-hist-preview">${t("goldComputedLabel")} <b id="hist-gold-computed">$0.00</b></p>
        </div>

        <div class="wt-hist-card c-assets">
          <div class="wt-hist-card-head">
            <span class="wt-hist-card-icon">🚗</span>
            <div class="wt-hist-card-titles">
              <span class="wt-hist-card-title">${t("histAssetsTitle")}</span>
              <span class="wt-hist-card-hint">${t("histAssetsHint")}</span>
            </div>
          </div>
          <label style="font-size:11px;color:var(--wt-text-dim);display:block;margin-bottom:4px" for="hist-assets-amount">${t("histAmountEgp")}</label>
          <input type="number" id="hist-assets-amount" min="0" step="any" placeholder="0" oninput="updateHistAssetsPreview();updateHistTotalPreview()">
          <p class="wt-hist-preview" id="hist-assets-preview">${t("histPreviewEmpty")}</p>
        </div>
        </div>

        <div class="wt-hist-total">
          <span class="wt-hist-total-label">${t("histTotalLabel")}</span>
          <span class="wt-hist-total-value" id="hist-total-value">$0.00</span>
        </div>

        <p id="hist-error" style="display:none;color:var(--wt-red);font-size:12px;margin:-6px 0 12px"></p>
        <div class="wt-modal-actions">
          <button type="button" class="wt-btn-ghost" onclick="closeHistoryModal()">${t("cancel")}</button>
          <button type="submit" class="wt-btn">${t("add")}</button>
        </div>
      </form>
    </div>
  </div>`;
}

function submitHistoryEntry(ev) {
  ev.preventDefault();
  const dateEl = document.getElementById("hist-date");
  const errEl = document.getElementById("hist-error");
  const date = dateEl.value;

  errEl.style.display = "none";
  if (!date) {
    errEl.textContent = t("errHistoryDate");
    errEl.style.display = "block";
    return;
  }

  const egpAmount = parseFloat(document.getElementById("hist-egp-amount").value) || 0;
  const assetsAmount = parseFloat(document.getElementById("hist-assets-amount").value) || 0;
  const hardUsd = parseFloat(document.getElementById("hist-hard").value) || 0;
  const goldOz = parseFloat(document.getElementById("hist-gold-oz").value) || 0;
  const goldGrams = parseFloat(document.getElementById("hist-gold-grams").value) || 0;
  const goldUsd = (goldOz / OUNCE_TO_GRAM) * goldGrams;

  // If the user entered an EGP amount (in this category or in assets), we need a
  // historical exchange rate ready, otherwise we can't convert it accurately
  let egpUsd = 0,
    assetsUsd = 0;
  if (egpAmount > 0 || assetsAmount > 0) {
    if (!histRate || !histRate.egpPerUsd) {
      errEl.textContent = t("errNeedRate");
      errEl.style.display = "block";
      return;
    }
    egpUsd = egpAmount / histRate.egpPerUsd;
    assetsUsd = assetsAmount / histRate.egpPerUsd;
  }

  const totalUsd = egpUsd + hardUsd + goldUsd + assetsUsd;

  if (totalUsd === 0) {
    errEl.textContent = t("errHistoryEmpty");
    errEl.style.display = "block";
    return;
  }

  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        historyModalOpen = false;
        loadHistory(); // reload the full history after adding
      } else {
        errEl.textContent = j && j.error ? t(j.error) : t("genericError");
        errEl.style.display = "block";
      }
    })
    .withFailureHandler(function () {
      errEl.textContent = t("connectionError");
      errEl.style.display = "block";
    })
    .addManualHistoryEntry(currentUser, { date, totalUsd, egpUsd, hardUsd, goldUsd, assetsUsd }, sessionToken);
}

function loadHistory() {
  if (!currentUser) return;
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok && Array.isArray(j.history)) {
        historyData = j.history.sort((a, b) => a.date.localeCompare(b.date));
      }
      render();
      renderHistory();
    })
    .withFailureHandler(function (err) {
      console.error("loadHistory:", err);
      renderHistory();
    })
    .loadHistoryForClient(currentUser, sessionToken);
}
