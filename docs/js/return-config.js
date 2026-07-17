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
// Fields are the real domain model (see backend/lib/growthPipeline.js):
// growthSource/growthFrequency describe HOW/HOW OFTEN the value changes,
// distributionFrequency is WHEN cash is paid out, compoundingFrequency is
// WHEN growth is reinvested, liquidityFrequency is WHEN funds are
// redeemable — four independent concepts, not one overloaded payoutFreq.
const RETURN_PRESETS = [
  {
    id: "thndr_cloud_instant",
    name_ar: "Thndr Cloud Instant (اليومي)",
    name_en: "Thndr Cloud Instant (Daily)",
    productType: "fixedIncomeFund",
    rateType: "variable",
    rateBasis: "effective",
    growthSource: "nav",
    growthFrequency: "daily",
    distributionFrequency: "none",
    compoundingFrequency: "daily",
    liquidityFrequency: "daily",
    suggestedApy: 18.11,
  },
  {
    id: "thndr_cloud_monthly",
    name_ar: "Thndr Cloud Monthly (الشهري)",
    name_en: "Thndr Cloud Monthly",
    productType: "fixedIncomeFund",
    rateType: "variable",
    rateBasis: "effective",
    growthSource: "nav",
    // Grows daily — NAV moves every day. Never distributes: all growth is
    // reflected in the price. Only liquidity (redemption) is monthly.
    growthFrequency: "daily",
    distributionFrequency: "none",
    compoundingFrequency: "daily",
    liquidityFrequency: "monthly",
    suggestedApy: 20.06,
  },
  {
    id: "mashreq_savings",
    name_ar: "بنك المشرق — Savings",
    name_en: "Mashreq — Savings",
    productType: "savings",
    rateType: "variable",
    rateBasis: "nominal",
    growthSource: "fixedRate",
    balanceBasis: "lowestPeriodBalance",
    growthFrequency: "monthly",
    distributionFrequency: "none",
    compoundingFrequency: "monthly",
    liquidityFrequency: "monthly",
    suggestedApy: 18,
  },
  {
    id: "mashreq_day_by_day",
    name_ar: "بنك المشرق — يوم بيوم",
    name_en: "Mashreq — Day by Day",
    productType: "savings",
    rateType: "variable",
    rateBasis: "nominal",
    growthSource: "fixedRate",
    balanceBasis: "currentBalance",
    growthFrequency: "daily",
    distributionFrequency: "none",
    compoundingFrequency: "daily",
    liquidityFrequency: "daily",
    suggestedApy: 15,
  },
  {
    id: "nbe_platinum_stepup_3y",
    name_ar: "الأهلي — شهادة بلاتينية متدرجة (3 سنين)",
    name_en: "NBE Platinum Step-Up Certificate (3 Years)",
    productType: "certificate",
    rateType: "fixed",
    rateBasis: "nominal",
    growthSource: "fixedRate",
    balanceBasis: "fixedPrincipal",
    growthFrequency: "annual",
    distributionFrequency: "annual",
    compoundingFrequency: "none",
    liquidityFrequency: "maturity",
    tierRates: [27, 22, 17],
  },
];

// ── Product Summary Engine ──────────────────────────────────────────────
// Generates a human-readable, plain-language description of a product's
// financial model, purely from the domain-model fields — never from a
// hardcoded product name. This is what powers the live "Product Summary"
// panel in the Product Configuration UI: as any field changes, this is
// re-run and the sentence updates instantly.
function generateProductSummary(cfg) {
  if (!cfg || !cfg.growthSource) return null;

  const sentences = [];
  const opt = (mapKey, value) => (value ? t(mapKey)[value] || value : null);

  // 1) What kind of thing is this, and why does its value move at all?
  const growthSourceLabel = opt("growthSourceOptions", cfg.growthSource);
  sentences.push(t("summaryGrowthSource")(growthSourceLabel));

  // 2) How often does it actually change.
  const growthFreqLabel = opt("growthFrequencyOptions", cfg.growthFrequency);
  if (growthFreqLabel) sentences.push(t("summaryGrowthFrequency")(growthFreqLabel));

  // 3) Where does the growth go: reinvested, paid out, or both nonsensical.
  const compounds = cfg.compoundingFrequency && cfg.compoundingFrequency !== "none";
  const distributes = cfg.distributionFrequency && cfg.distributionFrequency !== "none";
  if (compounds) {
    sentences.push(t("summaryCompounds")(opt("compoundingFrequencyOptions", cfg.compoundingFrequency)));
  }
  if (distributes) {
    sentences.push(t("summaryDistributes")(opt("distributionFrequencyOptions", cfg.distributionFrequency)));
  } else if (!compounds) {
    sentences.push(t("summaryNoAutoGrowth"));
  } else {
    sentences.push(t("summaryNoDistribution"));
  }

  // 4) When can the money actually move.
  if (cfg.liquidityFrequency) {
    sentences.push(t("summaryLiquidity")(opt("liquidityFrequencyOptions", cfg.liquidityFrequency)));
  }

  // 5) What the growth is actually computed against.
  if (cfg.growthSource === "fixedRate" && cfg.balanceBasis === "fixedPrincipal") {
    sentences.push(t("summaryFixedPrincipal"));
  } else if (Array.isArray(cfg.tierRates) && cfg.tierRates.length) {
    sentences.push(t("summaryTiered")(cfg.tierRates.join("% → ") + "%"));
  }

  // 6) How projections in the table/simulator should be read.
  sentences.push(cfg.growthSource === "nav" ? t("summaryProjectionEstimated") : t("summaryProjectionGuaranteed"));

  return sentences.filter(Boolean).join(" ");
}

// An asset "generates a return" unless explicitly marked otherwise via the// An asset "generates a return" unless explicitly marked otherwise via the
// yield badge (toggleGeneratesReturn below). This is the single source of
// truth both the table badge and the Return Settings asset dropdown read —
// an asset marked noReturn:true is fully excluded from return configuration
// (can't be opened in the panel, never appears in its dropdown, and has no
// returnConfig/apy of its own).
function assetGeneratesReturn(id) {
  const cfg = returnConfig[id];
  return !(cfg && cfg.noReturn === true);
}

function yieldEligibleAssets() {
  return ASSETS.filter((a) => assetGeneratesReturn(a.id));
}

function openReturnPanel(assetId) {
  const eligible = yieldEligibleAssets();
  returnPanelOpen = true;
  returnPanelAssetId =
    assetId && eligible.some((a) => a.id === assetId) ? assetId : eligible.length ? eligible[0].id : null;
  // Product Configuration is a full-screen view, not a modal — give it a
  // real URL so the browser's own back button, refresh, and bookmarks all
  // work. syncPanelFromHash() (called at the top of every render()) is what
  // actually reads this back; setting it here just pushes the history entry.
  if (returnPanelAssetId) {
    const target = "#product-config/" + returnPanelAssetId;
    if (location.hash !== target) history.pushState(null, "", target);
  }
  render();
}

// Toggled from the small badge next to the Cash/Asset category badge in the
// table. Turning yield OFF clears any returnConfig/apy this item already
// had (per the user's own request: an asset that doesn't yield shouldn't
// carry around leftover return configuration) and closes/redirects the
// Return Settings panel if it was open on this exact item.
function toggleGeneratesReturn(id) {
  const currentlyYields = assetGeneratesReturn(id);
  if (currentlyYields) {
    const hasConfig = (returnConfig[id] && Object.keys(returnConfig[id]).length) || apy[id];
    if (hasConfig && !confirm(t("yieldToggleOffConfirm"))) return;
    returnConfig[id] = { noReturn: true };
    delete apy[id];
    if (returnPanelAssetId === id) closeReturnPanel();
  } else {
    delete returnConfig[id];
  }
  render();
  scheduleSave();
}

function closeReturnPanel() {
  returnPanelOpen = false;
  returnPanelAssetId = null;
  if (location.hash.startsWith("#product-config")) {
    history.pushState(null, "", location.pathname + location.search);
  }
  render();
}

// Keeps returnPanelOpen/returnPanelAssetId in sync with location.hash.
// Called at the very top of render() (see render.js) on every render pass —
// idempotent and cheap, so it's safe to call unconditionally: it only ever
// reads the hash and updates local state, never touches the hash itself
// (openReturnPanel/closeReturnPanel own that) and never calls render() again.
// This is what makes the browser's back/forward buttons, a page refresh, and
// a bookmarked/shared link all correctly open (or close) the right product's
// configuration page.
function syncPanelFromHash() {
  const match = /^#product-config\/(.+)$/.exec(location.hash);
  if (!match) {
    if (returnPanelOpen) {
      returnPanelOpen = false;
      returnPanelAssetId = null;
    }
    return;
  }
  const id = decodeURIComponent(match[1]);
  const eligible = yieldEligibleAssets();
  if (eligible.some((a) => a.id === id)) {
    returnPanelOpen = true;
    returnPanelAssetId = id;
  } else {
    // Stale/invalid link (asset deleted, or marked no-return since) —
    // silently drop back to a closed state rather than showing a broken page.
    returnPanelOpen = false;
    returnPanelAssetId = null;
  }
}

// Re-renders just the panel body (not a full page render) so switching the
// asset dropdown doesn't disturb anything else on the page.
function onReturnPanelAssetChange(id) {
  returnPanelAssetId = id && assetGeneratesReturn(id) ? id : null;
  if (returnPanelAssetId) {
    const target = "#product-config/" + returnPanelAssetId;
    if (location.hash !== target) history.pushState(null, "", target);
  }
  const root = document.getElementById("wt-return-panel-root");
  if (root) root.outerHTML = renderReturnPanel();
}

// productType is a TEMPLATE only — it never drives the calculation itself
// (see growth-pipeline.js header comment). Picking it here just pre-fills
// sensible defaults for the fields that actually do: calcMethod, compounding,
// rateBasis. The user can still override any of them afterwards. Only fields
// left empty/unset by the user are touched — this never overwrites a value
// they already typed in.
// productType is a TEMPLATE only — it never drives the calculation itself
// (see growth-pipeline.js header comment). Picking it here just pre-fills
// sensible defaults for the Financial Model fields the user can then
// customize freely. Only fields left empty/unset by the user are touched —
// this never overwrites a value they already picked.
const PRODUCT_TYPE_DEFAULTS = {
  savings: { growthSource: "fixedRate", balanceBasis: "lowestPeriodBalance", compoundingFrequency: "monthly", distributionFrequency: "none", rateBasis: "nominal" },
  fixedDeposit: { growthSource: "fixedRate", balanceBasis: "lowestPeriodBalance", compoundingFrequency: "monthly", distributionFrequency: "none", rateBasis: "nominal" },
  certificate: { growthSource: "fixedRate", balanceBasis: "fixedPrincipal", compoundingFrequency: "none", distributionFrequency: "annual", rateBasis: "nominal" },
  moneyMarketFund: { growthSource: "nav", growthFrequency: "daily", compoundingFrequency: "daily", distributionFrequency: "none", rateBasis: "effective" },
  fixedIncomeFund: { growthSource: "nav", growthFrequency: "daily", compoundingFrequency: "daily", distributionFrequency: "none", rateBasis: "effective" },
  investmentFund: { growthSource: "nav", growthFrequency: "daily", compoundingFrequency: "daily", distributionFrequency: "none", rateBasis: "effective" },
};

const PRODUCT_CONFIG_FIELDS = [
  "growthSource",
  "growthFrequency",
  "distributionFrequency",
  "compoundingFrequency",
  "liquidityFrequency",
  "balanceBasis",
  "rateBasis",
];

function applyProductTypeDefaults(productType) {
  const defaults = PRODUCT_TYPE_DEFAULTS[productType];
  if (!defaults) return;
  const setIfEmpty = (fieldId, value) => {
    const el = document.getElementById(fieldId);
    if (el && !el.value) el.value = String(value);
  };
  PRODUCT_CONFIG_FIELDS.forEach((f) => defaults[f] != null && setIfEmpty("rc-" + f, defaults[f]));
  onGrowthSourceChange(); // syncs tierRates/growthFormula visibility, then refreshes preview
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
  PRODUCT_CONFIG_FIELDS.forEach((f) => set("rc-" + f, p[f]));
  set("rc-apy", p.suggestedApy);
  set("rc-tierRates", p.tierRates ? p.tierRates.join(",") : "");
  set("rc-growthFormula", "");
  onGrowthSourceChange(); // syncs tierRates/growthFormula visibility for the preset's growthSource, then refreshes preview
  previewGrowthFormula();
}

// Reads every field currently in the form into a plain domain-model object
// — the single function both the live summary/validation preview AND the
// actual save use, so what you see before saving is exactly what gets
// saved.
function readProductConfigForm(id) {
  const val = (fieldId) => {
    const el = document.getElementById(fieldId);
    return el ? el.value : "";
  };
  const cfg = { productType: val("rc-productType") || null, rateType: val("rc-rateType") || null };
  PRODUCT_CONFIG_FIELDS.forEach((f) => (cfg[f] = val("rc-" + f) || null));
  // startDate is no longer edited from this panel — it's the exact same
  // returnConfig[id].startDate field the per-row "Since" button
  // (since-date.js) manages, kept here only so saving this form doesn't
  // wipe out whatever that button already set.
  cfg.startDate = (id && returnConfig[id] && returnConfig[id].startDate) || null;
  const tierRates = val("rc-tierRates")
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
  // Safety net: these two fields are hidden in the UI once growthSource
  // doesn't match, but a value can still be sitting in the DOM from before
  // the user switched (e.g. picked fixedRate, typed tierRates, then
  // switched to nav). Strip anything that no longer applies so a hidden
  // field can never be silently saved and silently ignored by the engine.
  cfg.tierRates = cfg.growthSource === "fixedRate" && tierRates.length ? tierRates : null;
  cfg.growthFormula = cfg.growthSource === "manual" ? val("rc-growthFormula").trim() || null : null;
  return cfg;
}

// Re-renders the live Product Summary + validation messages under the
// Financial Model section as the user changes any field — this is the
// "instant feedback" the Product Configuration page is built around.
function refreshProductConfigPreview() {
  const id = returnPanelAssetId;
  const cfg = readProductConfigForm(id);
  const summaryEl = document.getElementById("rc-product-summary");
  if (summaryEl) {
    const summary = generateProductSummary(cfg);
    summaryEl.textContent = summary || t("productSummaryEmpty");
    summaryEl.classList.toggle("wt-summary-empty", !summary);
  }
  const validationEl = document.getElementById("rc-validation");
  if (validationEl) {
    const result = typeof validateDomainModel === "function" ? validateDomainModel(cfg) : { valid: true, errors: [] };
    validationEl.innerHTML = result.valid
      ? ""
      : `<b>${t("validationTitle")}</b><ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`;
  }
  const durationEl = document.getElementById("rc-tierRates-duration");
  if (durationEl) durationEl.textContent = tierRatesDurationText(cfg);
  return cfg;
}

function submitReturnConfig(ev) {
  ev.preventDefault();
  const id = returnPanelAssetId;
  if (!id) return;

  const rateBasisEl = document.getElementById("rc-rateBasis");
  if (rateBasisEl && !rateBasisEl.value) {
    rateBasisEl.reportValidity ? rateBasisEl.reportValidity() : alert(t("rateBasisRequiredAlert"));
    return;
  }

  const cfg = refreshProductConfigPreview();
  const result = typeof validateDomainModel === "function" ? validateDomainModel(cfg) : { valid: true, errors: [] };
  if (!result.valid) return; // errors already shown live under the Financial Model section

  const apyVal = parseFloat(document.getElementById("rc-apy").value);
  returnConfig[id] = cfg;
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

// Toggles the ⓘ help text under any Financial Model field.
function toggleFieldHelp(key) {
  const el = document.getElementById("rc-help-" + key);
  if (el) el.style.display = el.style.display === "none" ? "block" : "none";
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

// The Return Settings panel's "detail view": every upcoming milestone for
// the selected asset, not just the primary one shown in the table.
function renderMilestonesSection(a) {
  const milestones = generateMilestones(a);
  if (!milestones.length) return "";
  return `
      <div class="wt-field wt-milestones-block">
        <label>${t("milestonesLabel")}</label>
        <div class="wt-milestones-list">
          ${milestones
            .map(
              (m) => `
            <div class="wt-milestone-row">
              <div class="wt-milestone-info">
                <span class="wt-milestone-title">${t(m.titleKey)}</span>
                <span class="wt-proj-date">${fmtDateShort(m.date)}</span>
                ${m.descriptionKey ? `<span class="wt-milestone-desc">${t(m.descriptionKey)}</span>` : ""}
              </div>
              <b class="wt-milestone-value">${m.estimated ? "≈ " : ""}${fmtByCurrencyPrecise(m.value, a.currency)}</b>
            </div>`
            )
            .join("")}
        </div>
      </div>`;
}

// A small ⓘ button + collapsible help paragraph, reused for every Financial
// Model field. Keeps the form itself uncluttered while the explanation is
// always one click away.
function fieldLabel(fieldId, labelKey, helpKey) {
  return `
    <label for="${fieldId}">
      ${t(labelKey)}
      ${helpKey ? `<button type="button" class="wt-help-icon" title="${t("helpIconTitle")}" onclick="toggleFieldHelp('${helpKey}')">ⓘ</button>` : ""}
    </label>
    ${helpKey ? `<p id="rc-help-${helpKey}" class="wt-field-help" style="display:none">${t(helpKey + "Help")}</p>` : ""}
  `;
}

function domainSelect(field, cfg, onchange) {
  return `<select id="rc-${field}" onchange="${onchange || "refreshProductConfigPreview()"}">${optionsHtml(t(field + "Options"), cfg[field])}</select>`;
}

// Derived-only: never stored, always recomputed from tierRates.length +
// startDate so it can't drift out of sync with what's actually saved.
// Shows the user in plain language what "3 rates" actually commits them to.
function tierRatesDurationText(cfg) {
  const n = Array.isArray(cfg.tierRates) ? cfg.tierRates.length : 0;
  if (!n) return "";
  if (!cfg.startDate) return t("tierRatesDurationLabel")(n);
  const start = parseDateStr(cfg.startDate);
  const dates = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(start.getFullYear() + i, start.getMonth(), start.getDate());
    dates.push(i === n ? t("tierRatesMaturityLabel") : String(d.getFullYear()));
  }
  return t("tierRatesDurationWithDates")(n, dates.join(" → "));
}

// Only tierRates/growthFormula/rc-tierRates-duration blocks are conditional
// on growthSource — everything else stays visible regardless.
function onGrowthSourceChange() {
  const source = document.getElementById("rc-growthSource").value;
  const isFixed = source === "fixedRate";
  const isManual = source === "manual";
  const advancedSection = document.getElementById("rc-advanced-section");
  const tierBlock = document.getElementById("rc-tierRates-block");
  const tierHint = document.getElementById("rc-tierRates-hint");
  const tierDuration = document.getElementById("rc-tierRates-duration");
  const formulaBlock = document.getElementById("rc-growthFormula-block");
  if (advancedSection) advancedSection.style.display = isFixed || isManual ? "" : "none";
  if (tierBlock) tierBlock.style.display = isFixed ? "" : "none";
  if (tierHint) tierHint.style.display = isFixed ? "" : "none";
  if (tierDuration) tierDuration.style.display = isFixed ? "" : "none";
  if (formulaBlock) formulaBlock.style.display = isManual ? "" : "none";
  refreshProductConfigPreview();
}

function renderReturnPanel() {
  const id = returnPanelAssetId;
  const a = ASSETS.find((x) => x.id === id);
  const cfg = (a && returnConfig[id]) || {};
  const lang_ = lang; // presets are only ever labeled in ar/en, no i18n() needed
  const summary = a ? generateProductSummary(cfg) : null;
  const validation = a ? (typeof validateDomainModel === "function" ? validateDomainModel(cfg) : { valid: true, errors: [] }) : { valid: true, errors: [] };

  return `
  <div class="wt-fullpage" id="wt-return-panel-root">
    <div class="wt-fullpage-inner">
      <button type="button" class="wt-fullpage-back" onclick="closeReturnPanel()">← ${t("cancel")}</button>
      <h3>${t("productConfigTitle")}</h3>
      <p style="font-size:12px;color:var(--wt-text-dim);margin:-6px 0 14px">${t("productConfigHint")}</p>

      <div class="wt-field">
        <label for="rc-asset">${t("selectAssetLabel")}</label>
        <select id="rc-asset" onchange="onReturnPanelAssetChange(this.value)">
          ${yieldEligibleAssets().map((x) => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.icon)} ${esc(assetName(x))}</option>`).join("")}
        </select>
      </div>

      ${
        !a
          ? `<p style="font-size:13px;color:var(--wt-text-dim)">${t("noAssetsHint")}</p>`
          : `
      <div class="wt-rc-layout">
        <div class="wt-rc-col-side">
          <div class="wt-field">
            <label>${t("presetsLabel")}</label>
            <div class="wt-preset-list">
              ${RETURN_PRESETS.map(
                (p) =>
                  `<button type="button" class="wt-btn-ghost wt-preset-btn" onclick="applyReturnPreset('${p.id}')">${esc(lang_ === "en" ? p.name_en : p.name_ar)}</button>`
              ).join("")}
            </div>
          </div>

          ${renderMilestonesSection(a)}

          <!-- Live, plain-English explanation of exactly what's configured,
               plus any inline validation issues — both regenerated on every
               change via refreshProductConfigPreview(), never hardcoded.
               Lives beside the form so it updates as you fill it in, instead
               of scrolling past it. -->
          <div class="wt-product-summary">
            <div class="wt-product-summary-title">💡 ${t("productSummaryTitle")}</div>
            <p id="rc-product-summary" class="${summary ? "" : "wt-summary-empty"}">${summary ? esc(summary) : t("productSummaryEmpty")}</p>
          </div>
          <div id="rc-validation" class="wt-rc-validation">
            ${validation.valid ? "" : `<b>${t("validationTitle")}</b><ul>${validation.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`}
          </div>
        </div>

        <div class="wt-rc-col-main">
      <form onsubmit="submitReturnConfig(event)">

        <!-- ── General ─────────────────────────────────────────────── -->
        <h4 class="wt-rc-section-title">${t("sectionGeneral")}</h4>
        <div class="wt-field-row-4">
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
            <select id="rc-rateBasis" required title="${t("rateBasisHint")}" onchange="refreshProductConfigPreview()">
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
            <label for="rc-apy">${t("thApy")}</label>
            <input type="number" id="rc-apy" min="0" max="100" step="any" value="${apy[id] || ""}" placeholder="0%" title="${t("apyHint")}">
          </div>
        </div>
        <p class="wt-return-summary-category" style="margin-top:-4px">${t("apyEditableHint")}</p>

        <!-- ── Financial Model ─────────────────────────────────────── -->
        <h4 class="wt-rc-section-title">${t("sectionFinancialModel")}</h4>
        <div class="wt-field-row-3">
          <div class="wt-field">
            ${fieldLabel("rc-growthSource", "growthSourceLabel", "growthSource")}
            ${domainSelect("growthSource", cfg, "onGrowthSourceChange()")}
          </div>
          <div class="wt-field">
            ${fieldLabel("rc-growthFrequency", "growthFrequencyLabel", "growthFrequency")}
            ${domainSelect("growthFrequency", cfg)}
          </div>
          <div class="wt-field">
            ${fieldLabel("rc-balanceBasis", "balanceBasisLabel", "balanceBasis")}
            ${domainSelect("balanceBasis", cfg)}
          </div>
          <div class="wt-field">
            ${fieldLabel("rc-distributionFrequency", "distributionFrequencyLabel", "distributionFrequency")}
            ${domainSelect("distributionFrequency", cfg)}
          </div>
          <div class="wt-field">
            ${fieldLabel("rc-compoundingFrequency", "compoundingFrequencyLabel", "compoundingFrequency")}
            ${domainSelect("compoundingFrequency", cfg)}
          </div>
          <div class="wt-field">
            ${fieldLabel("rc-liquidityFrequency", "liquidityFrequencyLabel", "liquidityFrequency")}
            ${domainSelect("liquidityFrequency", cfg)}
          </div>
        </div>

        <!-- Live, plain-English explanation of exactly what's configured above,
             plus any inline validation issues — both regenerated on every
             change via refreshProductConfigPreview(), never hardcoded. -->
        <div class="wt-product-summary">
          <div class="wt-product-summary-title">💡 ${t("productSummaryTitle")}</div>
          <p id="rc-product-summary" class="${summary ? "" : "wt-summary-empty"}">${summary ? esc(summary) : t("productSummaryEmpty")}</p>
        </div>
        <div id="rc-validation" class="wt-rc-validation">
          ${validation.valid ? "" : `<b>${t("validationTitle")}</b><ul>${validation.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`}
        </div>

        <!-- ── Advanced overrides ──────────────────────────────────── -->
        <!-- Only ever relevant for growthSource:"fixedRate" (tierRates) or
             "manual" (growthFormula) — the whole section, header included,
             stays hidden for every other growthSource so it never shows up
             empty. Toggled live by onGrowthSourceChange(). -->
        <div id="rc-advanced-section" ${cfg.growthSource === "fixedRate" || cfg.growthSource === "manual" ? "" : 'style="display:none"'}>
          <h4 class="wt-rc-section-title">${t("sectionDatesLiquidity")}</h4>
          <!-- tierRates only means anything for growthSource:"fixedRate" (see
               validateDomainModel) — hidden otherwise so it can't be filled in
               and silently ignored. -->
          <div class="wt-field-row-3" id="rc-tierRates-block" ${cfg.growthSource === "fixedRate" ? "" : 'style="display:none"'}>
            <div class="wt-field">
              <label for="rc-tierRates">${t("tierRatesLabel")}</label>
              <input type="text" id="rc-tierRates" placeholder="27,22,17" dir="ltr"
                oninput="refreshProductConfigPreview()"
                value="${Array.isArray(cfg.tierRates) ? cfg.tierRates.join(",") : ""}">
            </div>
          </div>
          <p id="rc-tierRates-hint" style="font-size:11px;color:var(--wt-text-dim);margin:8px 0 4px;${cfg.growthSource === "fixedRate" ? "" : "display:none"}">${t("tierRatesHint")}</p>
          <p id="rc-tierRates-duration" class="wt-return-summary-category" style="margin:4px 0 8px;${cfg.growthSource === "fixedRate" ? "" : "display:none"}">${tierRatesDurationText(cfg)}</p>

          <!-- Custom growth formula — overrides the built-in interest math for
               THIS item only, everywhere it's used (simulator, table columns,
               and the real daily cron), without needing a code change. Leave
               blank to keep using the built-in default for whatever
               growth model is picked above. Only meaningful for
               growthSource:"manual" — hidden otherwise, same reasoning as
               tierRates above. -->
          <div class="wt-field" id="rc-growthFormula-block" ${cfg.growthSource === "manual" ? "" : 'style="display:none"'}>
            <label for="rc-growthFormula">${t("growthFormulaLabel")}</label>
            <textarea id="rc-growthFormula" dir="ltr" rows="2" spellcheck="false"
              placeholder="principal * (rate/100/365) * days"
              oninput="previewGrowthFormula(); refreshProductConfigPreview();">${esc(cfg.growthFormula || "")}</textarea>
            <p style="font-size:11px;color:var(--wt-text-dim);margin:4px 0 0">${t("growthFormulaHint")}</p>
            <p id="rc-formula-preview" class="wt-return-summary-category" style="margin-top:6px">${t("growthFormulaDefaultNote")}</p>
          </div>
        </div>

        <div class="wt-modal-actions">
          <button type="button" class="wt-btn-ghost" onclick="clearReturnConfig()">${t("clearConfigBtn")}</button>
          <button type="submit" class="wt-btn">${t("saveChanges")}</button>
        </div>
      </form>
        </div>
      </div>
      `
      }
    </div>
  </div>`;
}

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

// Returns { next, nextDate, endOfCycle, endOfCycleDate, endOfYear, endOfYearDate }
// in the asset's own currency (qty is already stored in native units — EGP
// stays EGP, gold stays grams, etc. — so there's no USD conversion here at
// all), or null if there's nothing to project (no balance, or no rate
// configured at all). The *Date fields are plain JS Date objects. Smart,
// product-aware labels for these dates are computed separately by
// generateMilestones() below — this function only knows dates/values.
function projectAssetValue(a) {
  const principal = qty[a.id] || 0;
  if (!principal) return null;

  const cfg = returnConfig[a.id] || {};
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // A true rolling "one year from today" (not calendar Dec 31 — that could
  // be just days away if today is in December, which wouldn't match the
  // "One year from now" milestone label at all).
  const oneYearOut = addYearsToDate(todayMid, 1);
  const endOfCycle = endOfCycleDate(cfg, todayMid);

  const freq = cycleFrequency(cfg);
  const monthsStep = monthsStepForFreq(freq);
  let nextDate;
  if (cfg.startDate && monthsStep) {
    nextDate = anniversaryAfter(cfg.startDate, monthsStep, todayMid);
  } else if (freq === "monthly" || freq === "quarterly" || freq === "semiAnnual") {
    nextDate = new Date(todayMid.getFullYear(), todayMid.getMonth() + 1, todayMid.getDate());
  } else if (freq === "annual" || freq === "maturity") {
    nextDate = addYearsToDate(todayMid, 1);
  } else {
    nextDate = new Date(todayMid.getFullYear(), todayMid.getMonth(), todayMid.getDate() + 1);
  }

  if (cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length) {
    return {
      next: computeGrowthValueAt(a.id, principal, todayMid, nextDate),
      nextDate,
      endOfCycle: computeGrowthValueAt(a.id, principal, todayMid, endOfCycle),
      endOfCycleDate: endOfCycle,
      endOfYear: computeGrowthValueAt(a.id, principal, todayMid, oneYearOut),
      endOfYearDate: oneYearOut,
    };
  }

  const rate = apy[a.id] || 0;
  if (!rate) return null;
  return {
    next: computeGrowthValueAt(a.id, principal, todayMid, nextDate),
    nextDate,
    endOfCycle: computeGrowthValueAt(a.id, principal, todayMid, endOfCycle),
    endOfCycleDate: endOfCycle,
    endOfYear: computeGrowthValueAt(a.id, principal, todayMid, oneYearOut),
    endOfYearDate: oneYearOut,
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
// The cadence that actually determines "when does this product's current
// cycle end" for milestone purposes. For a NAV product that's its
// liquidityFrequency (Thunder Cloud Monthly grows every day, but the
// milestone that matters to the user is "End of Month" — when redemption
// actually happens); for everything else it's simply growthFrequency, since
// growth and the payout/milestone cadence are the same boundary there.
function cycleFrequency(cfg) {
  return cfg.growthSource === "nav" ? cfg.liquidityFrequency : cfg.growthFrequency;
}

function endOfCycleDate(cfg, todayMid) {
  if (cfg.startDate && Array.isArray(cfg.tierRates) && cfg.tierRates.length) {
    let cursor = parseDateStr(cfg.startDate);
    while (cursor <= todayMid) cursor = addYearsToDate(cursor, 1);
    return cursor;
  }
  const freq = cycleFrequency(cfg);
  const monthsStep = monthsStepForFreq(freq);
  if (cfg.startDate && monthsStep) {
    return anniversaryAfter(cfg.startDate, monthsStep, todayMid);
  }
  if (!freq || freq === "daily") return todayMid;
  return new Date(todayMid.getFullYear(), todayMid.getMonth() + 1, 0); // last day of this month
}

// ──────────────────────────────────────────────────────────────────────
//  Milestones — one generic, product-aware layer instead of fixed
//  next/endOfCycle/endOfYear table columns. A product's shape (calcMethod +
//  payoutFreq + compounding) already fully determines both which milestones
//  make sense for it AND what to call them — so this is a plain lookup, not
//  a switch statement duplicated in the UI. Adding a new product later only
//  ever means adding a returnConfig preset (return-config.js) with the right
//  attribute combination; this function needs no changes for it.
// ──────────────────────────────────────────────────────────────────────
const MILESTONE_LABELS = {
  next: {
    navBasedDaily: "milestoneNextNav",
    tomorrow: "milestoneTomorrow",
    monthly: "milestoneEndOfMonth",
    quarterly: "milestoneQuarterEnd",
    semiAnnual: "milestoneHalfYearEnd",
    annualPayout: "milestoneAnnualPayout",
    nextInterest: "milestoneNextInterest",
    maturity: "milestoneMaturity",
    // No real Since-date to anchor a calendar boundary to — "N periods from
    // today" is a rolling estimate, not a locked-in date, so it needs
    // wording distinct from the cycle milestone's true calendar end (which
    // would otherwise show the same label on a different date right below).
    unanchoredMonthly: "milestoneNextMonth",
    unanchoredQuarterly: "milestoneNextQuarter",
    unanchoredSemiAnnual: "milestoneNextHalfYear",
    unanchoredAnnual: "milestoneNextYear",
  },
  cycle: {
    navBased: "milestoneNavEstimate",
    monthly: "milestoneEndOfMonth",
    quarterly: "milestoneQuarterEnd",
    semiAnnual: "milestoneHalfYearEnd",
    default: "milestoneEndOfCycle",
  },
};

function nextMilestoneLabelKey(cfg) {
  const freq = cycleFrequency(cfg);
  if (!freq || freq === "daily") {
    return cfg.growthSource === "nav" ? MILESTONE_LABELS.next.navBasedDaily : MILESTONE_LABELS.next.tomorrow;
  }
  // A real Since-date anchors "next" to an actual calendar boundary (e.g.
  // "the 8th of next month") — without one it's just "roughly a month from
  // today" and needs the softer "unanchored" wording (see comment above).
  const anchored = !!cfg.startDate;
  const distributes = cfg.distributionFrequency && cfg.distributionFrequency !== "none";
  if (freq === "monthly") return anchored ? MILESTONE_LABELS.next.monthly : MILESTONE_LABELS.next.unanchoredMonthly;
  if (freq === "quarterly")
    return anchored ? MILESTONE_LABELS.next.quarterly : MILESTONE_LABELS.next.unanchoredQuarterly;
  if (freq === "semiAnnual")
    return anchored ? MILESTONE_LABELS.next.semiAnnual : MILESTONE_LABELS.next.unanchoredSemiAnnual;
  if (freq === "annual")
    return distributes
      ? MILESTONE_LABELS.next.nextInterest
      : anchored
        ? MILESTONE_LABELS.next.annualPayout
        : MILESTONE_LABELS.next.unanchoredAnnual;
  if (freq === "maturity") return MILESTONE_LABELS.next.maturity;
  return MILESTONE_LABELS.next.tomorrow;
}

function cycleMilestoneLabelKey(cfg) {
  if (cfg.growthSource === "nav") return MILESTONE_LABELS.cycle.navBased;
  return MILESTONE_LABELS.cycle[cycleFrequency(cfg)] || MILESTONE_LABELS.cycle.default;
}

// ── kind / status / priority metadata ───────────────────────────────────
// `kind` is a STABLE internal identifier for what a milestone actually is,
// independent of its (localized, product-phrasing-aware) title. Business
// logic — sorting, filtering, future analytics/UI — must key off `kind`,
// never off `titleKey`/`title`, so that adding a translation or rewording a
// label can never silently change behaviour.
function nextMilestoneKind(cfg) {
  const freq = cycleFrequency(cfg);
  if (!freq || freq === "daily") return cfg.growthSource === "nav" ? "nav-update" : "interest-payment";
  if (freq === "monthly") return "month-end";
  if (freq === "quarterly") return "quarter-end";
  if (freq === "semiAnnual") return "interest-payment";
  if (freq === "annual") return "interest-payment";
  if (freq === "maturity") return "maturity";
  return "interest-payment";
}

function cycleMilestoneKind(cfg) {
  if (cfg.growthSource === "nav") return "nav-update";
  const freq = cycleFrequency(cfg);
  if (freq === "monthly") return "month-end";
  if (freq === "quarterly") return "quarter-end";
  if (freq === "semiAnnual" || freq === "annual") return "year-end";
  return "month-end";
}

// priority is purely additional metadata for future UI use (e.g. sorting
// "important" milestones to the top of a dashboard) — chronological
// ordering below always continues to use `date`, never `priority`.
const MILESTONE_PRIORITY = { next: 100, maturityBoost: 90, cycle: 70, year: 50 };

function priorityFor(id, kind) {
  if (kind === "maturity") return MILESTONE_PRIORITY.maturityBoost;
  return MILESTONE_PRIORITY[id] || 50;
}

// status replaces the old plain boolean `estimated` flag with an explicit
// tri-state: "estimated" (NAV-based/Thndr-style projections that can move
// with market price), "guaranteed" (a contractually fixed payout — e.g. a
// certificate's maturity value), or "actual" — applied by the caller once
// a milestone's date is in the past (see `completed` below).
function statusFor(kind, estimated) {
  if (estimated) return "estimated";
  return "guaranteed";
}

// Returns every upcoming milestone for an asset, soonest date first — NOT
// assumed to be [next, cycle, year] in that order, since a product's
// calendar "cycle" boundary can fall before its "next" event (e.g. a
// monthly product with no Since-date set yet: "next" is an arbitrary
// 1-month-from-today estimate, but the calendar month itself may end
// sooner). The table shows milestones[0]; the Return Settings panel shows
// the full list.
function generateMilestones(a) {
  const proj = projectAssetValue(a);
  if (!proj) return [];
  const cfg = returnConfig[a.id] || {};
  const estimated = cfg.growthSource === "nav";
  const todayMid = new Date();
  todayMid.setHours(0, 0, 0, 0);

  const rawCandidates = [
    {
      id: "next",
      kind: nextMilestoneKind(cfg),
      titleKey: nextMilestoneLabelKey(cfg),
      date: proj.nextDate,
      value: proj.next,
    },
    {
      id: "cycle",
      kind: cycleMilestoneKind(cfg),
      titleKey: cycleMilestoneLabelKey(cfg),
      date: proj.endOfCycleDate,
      value: proj.endOfCycle,
    },
    {
      id: "year",
      kind: "projection",
      titleKey: "milestoneOneYear",
      date: proj.endOfYearDate,
      value: proj.endOfYear,
      descriptionKey: estimated ? "milestoneEstimateDesc" : null,
    },
  ];

  // Sort chronologically. Array.sort is stable, so when two milestones land
  // on the exact same date (very common — a monthly product's "next" often
  // IS its cycle boundary), the earlier-declared one (next > cycle > year,
  // the more specific/important label) wins the tie and the duplicate is
  // dropped right after.
  rawCandidates.sort((x, y) => x.date - y.date);
  const milestones = [];
  for (const m of rawCandidates) {
    const prev = milestones[milestones.length - 1];
    if (prev && prev.date.getTime() === m.date.getTime()) continue; // duplicate event, already have it
    const completed = m.date.getTime() < todayMid.getTime();
    milestones.push({
      ...m,
      // Rich metadata (target model). `title`/`subtitle`/`description` are
      // resolved eagerly against the current `lang` — generateMilestones()
      // re-runs on every render() (including on language toggle), so this
      // stays live; `titleKey`/`descriptionKey` are kept alongside for
      // existing call sites and any future re-localization without
      // recomputation.
      title: t(m.titleKey),
      subtitle: null,
      description: m.descriptionKey ? t(m.descriptionKey) : null,
      status: completed ? "actual" : statusFor(m.kind, estimated),
      priority: priorityFor(m.id, m.kind),
      daysRemaining: completed ? 0 : Math.max(0, daysBetweenDates(todayMid, m.date)),
      completed,
      // Back-compat: existing render.js / assets.js read `m.estimated`
      // directly. Derive it from the new tri-state `status` so both stay
      // in sync — no separate boolean to drift out of step.
      estimated: completed ? false : statusFor(m.kind, estimated) === "estimated",
    });
  }
  return milestones;
}

// The single number the table shows for this asset — always the soonest
// upcoming milestone, whatever it's called for this particular product.
function primaryMilestone(a) {
  const milestones = generateMilestones(a);
  return milestones.length ? milestones[0] : null;
}
