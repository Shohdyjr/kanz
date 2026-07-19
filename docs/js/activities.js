// ══════════════════════════════════════════════════════════════════════
//  Activities — facts about intentional user actions
//  ──────────────────────────────────────────────────────────────────
//  Generalizes the old income/expense-only model (Salary/Deposit/Withdrawal
//  were already "income"/"expense" contributions) into six named,
//  intent-driven actions, logged into the shared Activities log
//  (see activities-log.js).
//  The user picks WHY they're changing a number before they change it —
//  there is no follow-up question and no generic "edit balance, then
//  classify it" step. Portfolio (`qty`) remains the only source of truth;
//  an Activity is only ever a fact recorded ALONGSIDE the qty change, never
//  a thing qty is derived from. See docs-dev/architecture-principles.md.
//
//  Per that same doc: an Activity may carry fields intrinsic to the single
//  action it represents (a Transfer's fromItemId/toItemId, a Buy's
//  assetItemId/fundingItemId) but must NEVER reference another Activity.
// ══════════════════════════════════════════════════════════════════════

const ACTIVITY_KINDS = ["salary", "deposit", "withdrawal", "buy", "sell", "transfer", "correction"];

// "Edit Balance" (plain qty edit, e.g. via setQty in assets.js) already logs
// nothing — it stays the deliberately narrow, no-shame fallback for a quick
// correction. This modal's "correction" option exists for people who arrive
// via "Log Activity" first and want that intent to be explicit.
function openActivityModal(kind) {
  activityType = ACTIVITY_KINDS.includes(kind) ? kind : "deposit";
  activityError = null;
  activityModalOpen = true;
  render();
  setTimeout(() => {
    const f = document.getElementById("activity-amount");
    if (f) f.focus();
  }, 50);
}

function closeActivityModal() {
  activityModalOpen = false;
  activityType = null;
  activityError = null;
  render();
}

function switchActivityType(kind) {
  activityType = kind;
  activityError = null;
  render();
}

// Every non-asset item the user can pick a "from/to/funding" side from —
// assets (isAsset:true, e.g. a car) are excluded from Buy/Sell/Transfer
// pickers since they're not liquid holdings money moves through.
function activityPickableItems() {
  return ASSETS.filter((a) => !a.isAsset);
}
// Buy/Sell's "asset acquired/disposed" side can be anything, including a
// flagged asset (e.g. buying the car itself).
function activityAllItems() {
  return ASSETS;
}

/**
 * Applies a native-currency delta to an item's qty (shared by every
 * Activity type below) and keeps the existing qtyUpdatedAt bookkeeping
 * consistent with a plain manual edit.
 */
function applyQtyDelta(itemId, nativeDelta) {
  qty[itemId] = (parseFloat(qty[itemId]) || 0) + nativeDelta;
  qtyUpdatedAt[itemId] = todayLocalStr();
}

/** Records the Activity itself — same endpoint activities-log.js already uses. */
function postActivity(fields, onDone) {
  callApi("addActivity", currentUser, fields, sessionToken)
    .then((j) => {
      if (j && j.ok) {
        loadActivities(); // refresh activitiesData so the Activities log reflects this immediately
        onDone && onDone(null);
      } else onDone && onDone((j && j.error) || "genericError");
    })
    .catch(() => onDone && onDone("connectionError"));
}

function submitActivity(ev) {
  ev.preventDefault();
  activityError = null;
  try {
    submitActivityInner();
  } catch (e) {
    // Whatever goes wrong here, the person should see SOMETHING rather than
    // a frozen modal with no feedback — that silent-failure mode is exactly
    // the bug this try/catch exists to prevent.
    console.error("submitActivity:", e);
    activityError = "genericError";
    render();
  }
}

function submitActivityInner() {
  if (!rates) {
    // Every branch below prices at least one item via priceFor(), which
    // returns 0 with no rates loaded — better to say so explicitly than to
    // silently do nothing.
    activityError = "errContribRate";
    render();
    return;
  }

  const date = document.getElementById("activity-date").value || todayLocalStr();
  const note = document.getElementById("activity-note").value || "";
  const rawAmt = Math.abs(parseFloat(document.getElementById("activity-amount").value) || 0);
  if (!rawAmt) {
    activityError = "errActivityAmount";
    render();
    return;
  }

  if (activityType === "salary" || activityType === "deposit" || activityType === "withdrawal") {
    const itemId = document.getElementById("activity-item").value;
    const asset = ASSETS.find((a) => a.id === itemId);
    if (!asset) {
      activityError = "errActivityItems";
      render();
      return;
    }
    const price = priceFor(asset);
    if (!price) {
      activityError = "errContribRate";
      render();
      return;
    }
    const sign = activityType === "withdrawal" ? -1 : 1;
    const nativeDelta = sign * rawAmt;
    applyQtyDelta(itemId, nativeDelta);
    updateTotals();
    scheduleSave();
    renderBreakdown();

    const type = activityType === "withdrawal" ? "withdrawal" : activityType === "salary" ? "salary" : "deposit";
    postActivity(
      { date, amountUsd: sign * rawAmt * price, amountOriginal: nativeDelta, currency: asset.currency, note, type, itemId },
      (err) => finishActivitySubmit(err)
    );
    return;
  }

  if (activityType === "transfer") {
    const fromId = document.getElementById("activity-from-item").value;
    const toId = document.getElementById("activity-to-item").value;
    const fromAsset = ASSETS.find((a) => a.id === fromId);
    const toAsset = ASSETS.find((a) => a.id === toId);
    if (!fromAsset || !toAsset || fromId === toId) {
      activityError = "errActivityItems";
      render();
      return;
    }
    const fromPrice = priceFor(fromAsset);
    const toPrice = priceFor(toAsset);
    if (!fromPrice || !toPrice) {
      activityError = "errContribRate";
      render();
      return;
    }
    // Amount entered in the FROM item's native currency; the TO item
    // receives the same USD value, priced in its own currency. Same-currency
    // transfers (the common case) reduce to a 1:1 native move, exactly as
    // expected.
    const usdValue = rawAmt * fromPrice;
    applyQtyDelta(fromId, -rawAmt);
    applyQtyDelta(toId, usdValue / toPrice);
    updateTotals();
    scheduleSave();
    renderBreakdown();

    // One atomic action, two intrinsic sides — a single Activity record
    // (not two linked ones) with fromItemId/toItemId, per the architecture
    // principle that an Activity never references another Activity.
    postActivity(
      { date, amountUsd: usdValue, amountOriginal: rawAmt, currency: fromAsset.currency, note, type: "transfer", fromItemId: fromId, toItemId: toId },
      (err) => finishActivitySubmit(err)
    );
    return;
  }

  if (activityType === "buy" || activityType === "sell") {
    const assetId = document.getElementById("activity-asset-item").value;
    const fundingId = document.getElementById("activity-funding-item").value;
    const assetItem = ASSETS.find((a) => a.id === assetId);
    const fundingItem = ASSETS.find((a) => a.id === fundingId);
    if (!assetItem || !fundingItem || assetId === fundingId) {
      activityError = "errActivityItems";
      render();
      return;
    }
    const assetPrice = priceFor(assetItem);
    const fundingPrice = priceFor(fundingItem);
    if (!assetPrice || !fundingPrice) {
      activityError = "errContribRate";
      render();
      return;
    }
    // Amount entered in the funding item's native currency (the cash side —
    // what left/returned to the account). Converted to how much of the
    // asset that buys/sells at today's price, exactly like every other USD
    // conversion in this app (no allocation convention invented).
    const usdValue = rawAmt * fundingPrice;
    const assetNativeDelta = usdValue / assetPrice;
    if (activityType === "buy") {
      applyQtyDelta(fundingId, -rawAmt);
      applyQtyDelta(assetId, assetNativeDelta);
    } else {
      applyQtyDelta(fundingId, rawAmt);
      applyQtyDelta(assetId, -assetNativeDelta);
    }
    updateTotals();
    scheduleSave();
    renderBreakdown();

    postActivity(
      {
        date,
        amountUsd: activityType === "buy" ? usdValue : -usdValue,
        amountOriginal: rawAmt,
        currency: fundingItem.currency,
        note,
        type: activityType,
        assetItemId: assetId,
        fundingItemId: fundingId,
      },
      (err) => finishActivitySubmit(err)
    );
    return;
  }

  if (activityType === "correction") {
    const itemId = document.getElementById("activity-item").value;
    const asset = ASSETS.find((a) => a.id === itemId);
    if (!asset) {
      activityError = "errActivityItems";
      render();
      return;
    }
    const price = priceFor(asset);
    const signEl = document.getElementById("activity-correction-sign");
    const sign = signEl && signEl.value === "down" ? -1 : 1;
    const nativeDelta = sign * rawAmt;
    applyQtyDelta(itemId, nativeDelta);
    updateTotals();
    scheduleSave();
    renderBreakdown();

    postActivity(
      { date, amountUsd: sign * rawAmt * (price || 0), amountOriginal: nativeDelta, currency: asset.currency, note, type: "correction", itemId },
      (err) => finishActivitySubmit(err)
    );
  }
}

function finishActivitySubmit(err) {
  if (err) {
    // The qty change above already saved locally via scheduleSave() even if
    // logging the Activity record failed — Portfolio stays authoritative
    // and correct either way; only the annotation may be missing, which is
    // always a safe, honest degradation (see architecture principles: an
    // Activity is never required for Portfolio state to be correct).
    console.error("postActivity:", err);
    activityError = err;
    render();
    return;
  }
  // Brief visible confirmation — without this, a successful save and a
  // silently-failed one look identical to the person using the app.
  activitySavedFlash = true;
  render();
  setTimeout(() => {
    activitySavedFlash = false;
    closeActivityModal();
  }, 700);
}

// ── Rendering ────────────────────────────────────────────────────────
function activityItemOptions(items, selectedId) {
  return items
    .map((a) => `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>${a.icon || ""} ${assetName(a)}</option>`)
    .join("");
}

function renderActivityModal() {
  const items = activityPickableItems();
  const allItems = activityAllItems();
  const today = todayLocalStr();
  const errMsg = activityError ? `<p style="color:var(--wt-red);font-size:12px;margin:-6px 0 12px">${t(activityError)}</p>` : "";
  const savedMsg = activitySavedFlash
    ? `<p style="color:var(--wt-green);font-size:12px;margin:-6px 0 12px">✓ ${t("activitySaved")}</p>`
    : "";

  const tabs = ACTIVITY_KINDS.map(
    (k) =>
      `<button type="button" class="wt-btn-ghost${activityType === k ? " selected" : ""}" style="${
        activityType === k ? "border-color:var(--wt-gold);color:var(--wt-gold)" : ""
      }" onclick="switchActivityType('${k}')">${t("activityType" + k.charAt(0).toUpperCase() + k.slice(1))}</button>`
  ).join("");

  let fieldsHtml = "";
  if (activityType === "salary" || activityType === "deposit" || activityType === "withdrawal") {
    fieldsHtml = `
      <div class="wt-field">
        <label for="activity-item">${t("activityItemLabel")}</label>
        <select id="activity-item">${activityItemOptions(items)}</select>
      </div>`;
  } else if (activityType === "transfer") {
    fieldsHtml = `
      <div class="wt-field">
        <label for="activity-from-item">${t("activityFromItemLabel")}</label>
        <select id="activity-from-item">${activityItemOptions(items)}</select>
      </div>
      <div class="wt-field">
        <label for="activity-to-item">${t("activityToItemLabel")}</label>
        <select id="activity-to-item">${activityItemOptions(items)}</select>
      </div>`;
  } else if (activityType === "buy" || activityType === "sell") {
    fieldsHtml = `
      <div class="wt-field">
        <label for="activity-asset-item">${t("activityAssetItemLabel")}</label>
        <select id="activity-asset-item">${activityItemOptions(allItems)}</select>
      </div>
      <div class="wt-field">
        <label for="activity-funding-item">${t("activityFundingItemLabel")}</label>
        <select id="activity-funding-item">${activityItemOptions(items)}</select>
      </div>`;
  } else if (activityType === "correction") {
    fieldsHtml = `
      <div class="wt-field">
        <label for="activity-item">${t("activityItemLabel")}</label>
        <select id="activity-item">${activityItemOptions(allItems)}</select>
      </div>
      <div class="wt-field">
        <select id="activity-correction-sign">
          <option value="up">+</option>
          <option value="down">−</option>
        </select>
      </div>
      <p style="font-size:11px;color:var(--wt-text-dim);margin:-6px 0 12px">${t("activityEditBalanceHint")}</p>`;
  }

  return `
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeActivityModal()">
    <div class="wt-modal">
      <h3>${t("activityModalTitle")}</h3>
      <div class="wt-field" style="display:flex;flex-wrap:wrap;gap:6px">${tabs}</div>
      <form onsubmit="submitActivity(event)">
        ${fieldsHtml}
        <div class="wt-field">
          <label for="activity-amount">${t("activityAmountLabel")}</label>
          <input type="number" id="activity-amount" min="0" step="any" placeholder="0" dir="ltr">
        </div>
        <div class="wt-field">
          <label for="activity-date">${t("activityDateLabel")}</label>
          <input type="date" id="activity-date" value="${today}" dir="ltr">
        </div>
        <div class="wt-field">
          <label for="activity-note">${t("activityNoteLabel")}</label>
          <input type="text" id="activity-note" maxlength="200">
        </div>
        ${errMsg}
        ${savedMsg}
        <div class="wt-modal-actions">
          <button type="button" class="wt-btn-ghost" onclick="closeActivityModal()">${t("cancel")}</button>
          <button type="submit" class="wt-btn">${t("saveChanges")}</button>
        </div>
      </form>
    </div>
  </div>`;
}
