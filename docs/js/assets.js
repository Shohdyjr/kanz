// ── General actions ────────────────────────────────────────
function setQty(id, v) {
  qty[id] = parseFloat(v) || 0;
  qtyUpdatedAt[id] = todayLocalStr();
  const dateEl = document.getElementById("qty-updated-" + id);
  if (dateEl) dateEl.textContent = fmtDateShort(parseDateStr(qtyUpdatedAt[id]));
  updateTotals();
  scheduleSave();
  renderBreakdown();
}

function move(id, dir) {
  const i = order.indexOf(id),
    j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  render();
  scheduleSave();
}

// ── Add / edit / delete assets ────────────────────────────
let selectedIcon = ICON_PALETTE[0];

// ── Savings goal ─────────────────────────────────────────
function openGoalModal() {
  goalModalOpen = true;
  render();
  setTimeout(() => {
    const f = document.getElementById("goal-input");
    if (f) f.focus();
  }, 50);
}

function closeGoalModal() {
  goalModalOpen = false;
  render();
}

function submitGoal(ev) {
  ev.preventDefault();
  const v = parseFloat(document.getElementById("goal-input").value) || 0;
  savingsGoal = v;
  goalModalOpen = false;
  render();
  scheduleSave();
}

function renderGoalModal() {
  return `
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeGoalModal()">
    <div class="wt-modal">
      <h3>${t("goalModalTitle")}</h3>
      <form onsubmit="submitGoal(event)">
        <div class="wt-field">
          <label for="goal-input">${t("goalInputLabel")}</label>
          <input type="number" id="goal-input" min="0" step="any" value="${savingsGoal || ""}" placeholder="50000" dir="ltr">
        </div>
        <div class="wt-modal-actions">
          <button type="button" class="wt-btn-ghost" onclick="closeGoalModal()">${t("cancel")}</button>
          <button type="submit" class="wt-btn">${t("saveChanges")}</button>
        </div>
      </form>
    </div>
  </div>`;
}

function openAddModal() {
  editingId = null;
  selectedIcon = ICON_PALETTE[0];
  modalOpen = true;
  render();
  setTimeout(() => {
    const f = document.getElementById("new-asset-name-ar");
    if (f) f.focus();
  }, 50);
}

function openEditModal(id) {
  const a = ASSETS.find((x) => x.id === id);
  if (!a) return;
  editingId = id;
  selectedIcon = a.icon;
  modalOpen = true;
  render();
  setTimeout(() => {
    const ar = document.getElementById("new-asset-name-ar");
    const en = document.getElementById("new-asset-name-en");
    if (ar) ar.value = a.name_ar;
    if (en) en.value = a.name_en;
    const cur = document.getElementById("new-asset-currency");
    if (cur) cur.value = a.currency;
    if (ar) ar.focus();
  }, 50);
}

function closeAddModal() {
  modalOpen = false;
  editingId = null;
  render();
}

function pickIcon(icon) {
  selectedIcon = icon;
  render();
  // Return focus to the form after re-rendering
  setTimeout(() => {
    const ar = document.getElementById("new-asset-name-ar");
    const en = document.getElementById("new-asset-name-en");
    const cur = document.getElementById("new-asset-currency");
    const grp = document.getElementById("new-asset-group");
    if (editingId) {
      const a = ASSETS.find((x) => x.id === editingId);
      if (ar && a) ar.value = a.name_ar;
      if (en && a) en.value = a.name_en;
      if (cur && a) cur.value = a.currency;
      if (grp && a) grp.value = a.group;
    }
  }, 0);
}

function submitAddAsset(ev) {
  ev.preventDefault();
  const nameArEl = document.getElementById("new-asset-name-ar");
  const nameEnEl = document.getElementById("new-asset-name-en");
  const curEl = document.getElementById("new-asset-currency");
  const groupEl = document.getElementById("new-asset-group");
  const errEl = document.getElementById("new-asset-error");
  const nameAr = (nameArEl.value || "").trim();
  const nameEn = (nameEnEl.value || "").trim();
  const currency = curEl.value;
  const group = groupEl.value || "savings";

  if (!nameAr) {
    errEl.textContent = t("errNameAr");
    errEl.style.display = "block";
    nameArEl.focus();
    return;
  }
  if (!nameEn) {
    errEl.textContent = t("errNameEn");
    errEl.style.display = "block";
    nameEnEl.focus();
    return;
  }
  if (!/^[A-Za-z0-9 \-_&().]+$/.test(nameEn)) {
    errEl.textContent = t("errNameEnFormat");
    errEl.style.display = "block";
    nameEnEl.focus();
    return;
  }

  if (editingId) {
    // ── Edit mode ──────────────────────────────────────
    const isBase = BASE_ASSETS.some((b) => b.id === editingId);
    if (isBase) {
      baseOverrides[editingId] = { name_ar: nameAr, name_en: nameEn, icon: selectedIcon, group };
      // Note: the original currency of built-in assets never changes, to keep old calculations accurate
    } else {
      const idx = customAssets.findIndex((c) => c.id === editingId);
      if (idx !== -1) {
        customAssets[idx] = {
          ...customAssets[idx],
          name_ar: nameAr,
          name_en: nameEn,
          icon: selectedIcon,
          currency,
          group,
        };
      }
    }
    rebuildAssets();
    modalOpen = false;
    editingId = null;
    render();
    renderBreakdown();
    scheduleSave();
    return;
  }

  // ── Add mode ────────────────────────────────────────
  let id = slugify(nameEn);
  if (ASSETS.some((a) => a.id === id)) {
    let n = 2;
    while (ASSETS.some((a) => a.id === id + "-" + n)) n++;
    id = id + "-" + n;
  }

  customAssets.push({ id, name_ar: nameAr, name_en: nameEn, icon: selectedIcon, currency, isAsset: false, group });
  rebuildAssets();
  order.push(id);

  modalOpen = false;
  render();
  renderBreakdown();
  scheduleSave();
}

// ── Delete an asset: any asset can be removed, built-in or custom ──────
function deleteAsset(id) {
  const a = ASSETS.find((x) => x.id === id);
  if (!a) return;
  if (!confirm(t("confirmDelete")(assetName(a)))) return;

  const isBase = BASE_ASSETS.some((b) => b.id === id);
  if (isBase) {
    // Built-in asset: mark it excluded instead of deleting its definition (so it
    excludedBaseIds.add(id);
  } else {
    customAssets = customAssets.filter((c) => c.id !== id);
  }

  delete qty[id];
  delete apy[id];
  delete returnConfig[id];
  order = order.filter((oid) => oid !== id);
  rebuildAssets();

  render();
  renderBreakdown();
  scheduleSave();
}

// ── Toggle asset category: liquid cash ⇄ fixed asset ──────────
// This category is entirely separate from currency — any asset (even EGP)
// can be classified as an "asset" instead of "EGP" in the breakdown and history.
function toggleAssetCategory(id) {
  const a = ASSETS.find((x) => x.id === id);
  if (!a) return;
  const newValue = !a.isAsset;

  const isBase = BASE_ASSETS.some((b) => b.id === id);
  if (isBase) {
    baseOverrides[id] = { ...(baseOverrides[id] || {}), isAsset: newValue };
  } else {
    const idx = customAssets.findIndex((c) => c.id === id);
    if (idx !== -1) customAssets[idx] = { ...customAssets[idx], isAsset: newValue };
  }

  rebuildAssets();
  render();
  renderBreakdown();
  scheduleSave();
}

// ── Category filter (Savings / Investments / Assets) ──────
// View-only: filters which rows are shown in the table, does not affect
// totals, breakdown, or history — those always use every asset.
function setGroupFilter(g) {
  groupFilter = groupFilter === g ? null : g;
  render();
}

function updateTotals() {
  if (!rates) return;
  let totalUsd = 0;
  ASSETS.forEach((a) => {
    const p = priceFor(a);
    const t = qty[a.id] * p;
    totalUsd += t;
    const el = document.getElementById("total-" + a.id);
    if (el) el.textContent = fmtUsd(t);
    const proj = projectAssetValue(a);
    const nextEl = document.getElementById("proj-next-" + a.id);
    const cycleEl = document.getElementById("proj-cycle-" + a.id);
    const endEl = document.getElementById("proj-end-" + a.id);
    if (nextEl) nextEl.textContent = proj ? fmtByCurrency(proj.next, a.currency) : t("projNone");
    if (cycleEl) cycleEl.textContent = proj ? fmtByCurrency(proj.endOfCycle, a.currency) : t("projNone");
    if (endEl) endEl.textContent = proj ? fmtByCurrency(proj.endOfYear, a.currency) : t("projNone");
    const nextAddEl = document.getElementById("next-add-val-" + a.id);
    if (nextAddEl && proj) {
      const nextAddVal = proj.next - (qty[a.id] || 0);
      nextAddEl.className = nextAddVal >= 0 ? "wt-sim-pos" : "wt-sim-neg";
      nextAddEl.textContent = (nextAddVal >= 0 ? "+" : "") + fmtByCurrency(nextAddVal, a.currency);
    }
  });
  const totalGold = rates.goldUsdPerGram > 0 ? totalUsd / rates.goldUsdPerGram : 0;
  const totalEgp = totalUsd * rates.egpPerUsd;
  const hv = document.getElementById("hero-value");
  const hg = document.getElementById("hero-gold");
  const he = document.getElementById("hero-egp");
  if (hv) hv.textContent = fmtUsd(totalUsd);
  if (hg) hg.textContent = fmtNum(totalGold, 2) + " " + (lang === "en" ? "g" : "جم");
  if (he) he.textContent = fmtEgp(totalEgp);
}

function themeIconSvg() {
  if (theme === "dark") {
    // Sun icon (shown to indicate switching to light mode)
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
  }
  // Moon icon (to switch back to dark mode)
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}
