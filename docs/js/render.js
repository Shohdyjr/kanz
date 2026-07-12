// ── Main render ──────────────────────────────────────
function render() {
  // No session? Show the auth screen instead of the app content
  if (!currentUser) {
    renderAuth();
    return;
  }

  const isFetching = status === "loading";
  const isError = status === "err";
  const statusText = isFetching ? t("statusLoading") : isError ? t("statusErr") : t("statusLive");
  const statusState = isFetching ? "loading" : isError ? "err" : "live";
  const totalUsd = rates ? ASSETS.reduce((s, a) => s + qty[a.id] * priceFor(a), 0) : 0;
  const totalGold = rates && rates.goldUsdPerGram > 0 ? totalUsd / rates.goldUsdPerGram : 0;
  const totalEgp = rates ? totalUsd * rates.egpPerUsd : 0;
  const lastUpdate = rates
    ? new Date(rates.fetchedAt).toLocaleTimeString(lang === "en" ? "en-US" : "ar-EG", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const orderedAssets = order.map((id) => ASSETS.find((a) => a.id === id)).filter(Boolean);
  const fxNote = rates && rates.fxSource === "daily" ? t("footerDaily") : t("footerHourly");

  document.getElementById("app").innerHTML = `
    <div class="wt-top">
      <div>
        <div class="wt-logo">
          <svg viewBox="0 0 100 100" class="wt-logo-mark${logoAnimated ? "" : " wt-logo-animate"}" id="kanz-logo-mark">
            <g transform="translate(50,50)">
              <polygon points="0,-42 42,0 0,42 -42,0" fill="none" stroke="var(--wt-gold)" stroke-width="2.5" stroke-linejoin="round"/>
              <polygon points="0,-30 30,0 0,30 -30,0" fill="none" stroke="var(--wt-gold-dim)" stroke-width="1" stroke-linejoin="round"/>
              <text x="-1" y="8" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="22" font-weight="700" fill="var(--wt-gold-light)">K</text>
              <text x="1" y="7" text-anchor="start" font-family="JetBrains Mono, monospace" font-size="10" font-weight="700" fill="var(--wt-gold-light)">ANZ</text>
            </g>
          </svg>
          <p class="wt-eyebrow">${t("pageTitle")}</p>
        </div>
        <h1 class="wt-h1">${t("h1")}</h1>
        <p class="wt-sub">${t("sub")}</p>
      </div>
      <div class="wt-top-right">
        <div class="wt-top-row">
          <div class="wt-status"><span class="wt-dot ${statusState}"></span><span>${statusText}</span></div>
          <button class="wt-theme-btn" onclick="toggleLang()" title="${t("langToggleTitle")}">${lang === "ar" ? "EN" : "AR"}</button>
          <button class="wt-theme-btn" onclick="toggleTheme()" title="${t("themeToggleTitle")}">${themeIconSvg()}</button>
        </div>
        <div class="wt-top-row">
          <span class="wt-user-badge">@${currentUser}</span>
          <button class="wt-theme-btn" onclick="openEmailModal()" title="${t("emailSettingsBtn")}">✉️</button>
          <button class="wt-logout-btn" onclick="logout()">${lang === "en" ? "Logout" : "خروج"}</button>
          ${rates ? `<span class="wt-fx-badge ${rates.fxSource === "daily" ? "fx-daily" : "fx-hourly"}">${rates.fxSource === "daily" ? t("fxBadgeDaily") : t("fxBadgeHourly")}</span>` : ""}
        </div>
        <button class="wt-refresh" ${isFetching ? "disabled" : ""} onclick="fetchRates()">
          <svg class="${isFetching ? "wt-spin" : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/>
          </svg>
          ${t("refresh")}
        </button>
      </div>
    </div>

    <div class="wt-hero">
      <p class="wt-hero-label">${t("heroLabel")}</p>
      <p class="wt-hero-value" id="hero-value">${fmtUsd(totalUsd)}</p>
      <div class="wt-hero-meta">
        <div>${t("goldEquiv")} <b id="hero-gold">${fmtNum(totalGold, 2)} ${lang === "en" ? "g" : "جم"}</b></div>
        <div>${t("egpEquiv")} <b id="hero-egp">${fmtEgp(totalEgp)}</b></div>
        <div>${t("lastUpdate")} <b>${lastUpdate}</b></div>
      </div>
      ${(() => {
        const w = computeGrowth(7, totalUsd);
        const m = computeGrowth(30, totalUsd);
        const now = new Date();
        const monthStartStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
        const mtd = computeGrowthSince(monthStartStr, totalUsd);
        const currentYear = now.getFullYear();
        const y = computeGrowthSince(currentYear + "-01-01", totalUsd);
        const a = computeGrowthAllTime(totalUsd);
        if (!w && !m && !mtd && !y && !a) return "";
        const chip = (g, label, showReal = true) => {
          if (!g) return "";
          const up = g.diff >= 0;
          const color = up ? "var(--wt-green)" : "var(--wt-red)";
          const arrow = up ? "▲" : "▼";
          const sign = up ? "+" : "";
          // Only show the "real growth" line when contributions were actually
          // logged for this period — otherwise it's identical to the total
          // and just adds noise for users who don't bother logging them.
          // Also gated by `showReal`: contributions are logged with monthly
          // granularity (always the 1st of the month — see contributions.js),
          // so splitting a rolling 7/30-day window into "added vs grew" isn't
          // meaningful — a contribution can't be attributed to a specific
          // week within its month. Only MTD/YTD/all-time (whole-month-aligned
          // windows) get the split.
          const hasContribution = showReal && Math.abs(g.contributed || 0) > 0.005;
          const realUp = (g.realDiff || 0) >= 0;
          const realColor = realUp ? "var(--wt-green)" : "var(--wt-red)";
          const realArrow = realUp ? "▲" : "▼";
          const realSign = realUp ? "+" : "";
          return `<div class="wt-growth-chip" style="color:${color}">
            <span>${arrow} ${sign}${g.pct.toFixed(1)}%</span>
            <span class="wt-growth-sub">(${sign}${fmtUsd(g.diff)}) ${label}</span>
            ${
              hasContribution
                ? `<span class="wt-growth-real" style="color:${realColor}">${t("realGrowthPrefix")} ${realArrow} ${realSign}${g.realPct.toFixed(1)}%</span>`
                : ""
            }
          </div>`;
        };
        return `<div class="wt-growth-row">${chip(w, t("growthWeek"), false)}${chip(m, t("growthMonth"), false)}${chip(mtd, t("growthMtd"))}${chip(y, t("growthYtd")(currentYear))}${chip(a, t("growthAllTime"))}</div>`;
      })()}
      ${
        savingsGoal > 0
          ? `<div class="wt-goal-bar-wrap">
        <div class="wt-goal-bar-track"><div class="wt-goal-bar-fill" style="width:${Math.min(100, (totalUsd / savingsGoal) * 100).toFixed(1)}%"></div></div>
        <div class="wt-goal-bar-label">${fmtUsd(totalUsd)} / ${fmtUsd(savingsGoal)} (${((totalUsd / savingsGoal) * 100).toFixed(1)}%)</div>
      </div>`
          : ""
      }
      <button class="wt-theme-btn" style="margin-top:12px;position:relative" onclick="openGoalModal()">${savingsGoal > 0 ? t("editGoalBtn") : t("setGoalBtn")}</button>
      <button class="wt-theme-btn" style="margin-top:12px;position:relative" onclick="openContribModal()">${t("logContribBtn")}</button>    </div>

    <div id="wt-bk-root"></div>

    <div id="wt-history-root"></div>

    ${
      rates
        ? `<div class="wt-rates">
      <div class="wt-rate-card"><p class="wt-rl">${t("rateEgp")}</p><p class="wt-rv">${fmtNum(rates.egpPerUsd, 2)}</p></div>
      <div class="wt-rate-card"><p class="wt-rl">${t("rateEur")}</p><p class="wt-rv">${fmtNum(rates.eurPerUsd, 4)}</p></div>
      <div class="wt-rate-card"><p class="wt-rl">${t("rateSar")}</p><p class="wt-rv">${fmtNum(rates.sarPerUsd, 4)}</p></div>
      <div class="wt-rate-card"><p class="wt-rl">${t("rateGoldGram")}</p><p class="wt-rv">${fmtUsd(rates.goldUsdPerGram)}</p></div>
    </div>`
        : ""
    }

    <div class="wt-table-wrap">
      <div class="wt-table-head">
        <p class="wt-table-title">${t("tableTitle")}</p>
        <div class="wt-actions">
          <button class="wt-btn-add" onclick="openAddModal()" title="${t("addBtn")}">+</button>
          <button class="wt-btn wt-btn-ghost" onclick="openReturnPanel()" title="${t("returnConfigBtnTitle")}">${t("returnConfigBtnTitle")}</button>
          <button class="wt-btn" onclick="saveData()">${t("saveNow")}</button>
          <button class="wt-btn wt-btn-ghost" onclick="exportBackup()">${t("exportBackupBtn")}</button>
          <span id="wt-sync-badge" class="wt-sync-badge"></span>
        </div>
      </div>
      <table class="wt-table">
        <thead><tr>
          <th class="wt-th-order">${t("thOrder")}</th>
          <th>${t("thAsset")}</th>
          <th>${t("thQty")}</th>
          <th>${t("thApy")}</th>
          <th class="num">${t("thUnitPrice")}</th>
          <th class="num">${t("thTotal")}</th>
          <th class="wt-th-del"></th>
        </tr></thead>
        <tbody>
        ${orderedAssets
          .map((a, idx) => {
            const p = priceFor(a);
            const t2 = qty[a.id] * p;
            return `<tr>
            <td><div class="wt-order-btns">
              <button class="wt-ord" onclick="move('${a.id}',-1)" ${idx === 0 ? "disabled" : ""}>▲</button>
              <button class="wt-ord" onclick="move('${a.id}',1)"  ${idx === orderedAssets.length - 1 ? "disabled" : ""}>▼</button>
            </div></td>
            <td><div class="wt-asset-name">
              <span class="wt-asset-icon wt-asset-icon-bg">${esc(a.icon)}</span>
              <span>${esc(assetName(a))}</span>
              <button class="wt-category-badge ${a.isAsset ? "is-asset" : "is-cash"}" onclick="toggleAssetCategory('${a.id}')" title="${t("toggleCategoryTitle")}">${a.isAsset ? t("categoryAsset") : t("categoryCash")}</button>
            </div></td>
            <td><input class="wt-qty" type="number" min="0" step="any"
              value="${qty[a.id] || ""}" placeholder="0"
              oninput="setQty('${a.id}',this.value)"></td>
            <td><input class="wt-apy" type="number" min="0" max="100" step="any"
              value="${apy[a.id] || ""}" placeholder="0%" title="${t("apyHint")}"
              oninput="setApy('${a.id}',this.value)"></td>
            <td class="wt-price-cell">${fmtNum(p, a.currency === "EGP" ? 6 : 4)}</td>
            <td class="wt-total-cell" id="total-${a.id}">${fmtUsd(t2)}</td>
            <td><div class="wt-row-actions">
              <button class="wt-hist" onclick="openItemHistoryModal('${a.id}')" title="${t("itemHistoryTitle")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
              </button>
              <button class="wt-edit" onclick="openEditModal('${a.id}')" title="${t("editTitle")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button class="wt-del" onclick="deleteAsset('${a.id}')" title="${t("deleteTitle")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
            </div></td>
          </tr>`;
          })
          .join("")}
        </tbody>
      </table>
    </div>

    <p class="wt-footer-note">
      ${t("footerNote")(`<b style="color:${rates && rates.fxSource === "daily" ? "#f0b429" : "var(--wt-green)"}">${fxNote}</b>`)}
    </p>

    ${
      modalOpen
        ? (() => {
            const isEditingBase = editingId && BASE_ASSETS.some((b) => b.id === editingId);
            return `
    <div class="wt-modal-overlay" onclick="if(event.target===this)closeAddModal()">
      <div class="wt-modal">
        <h3>${editingId ? t("editModalTitle") : t("modalTitle")}</h3>
        <form onsubmit="submitAddAsset(event)">
          <div class="wt-field">
            <label>${t("iconLabel")}</label>
            <div class="wt-icon-grid">
              ${ICON_PALETTE.map((ic) => `<button type="button" class="wt-icon-opt ${ic === selectedIcon ? "selected" : ""}" onclick="pickIcon('${ic}')">${ic}</button>`).join("")}
            </div>
          </div>
          <div class="wt-field">
            <label for="new-asset-name-ar">${t("nameArLabel")}</label>
            <input type="text" id="new-asset-name-ar" placeholder="${t("nameArPh")}" autocomplete="off">
          </div>
          <div class="wt-field">
            <label for="new-asset-name-en">${t("nameEnLabel")}</label>
            <input type="text" id="new-asset-name-en" placeholder="${t("nameEnPh")}" autocomplete="off" dir="ltr">
          </div>
          <p id="new-asset-error" style="display:none;color:var(--wt-red);font-size:12px;margin:-6px 0 12px"></p>
          <div class="wt-field">
            <label for="new-asset-currency">${t("currencyLabel")}</label>
            <select id="new-asset-currency" ${isEditingBase ? "disabled" : ""}>
              ${Object.keys(CURRENCY_LABEL)
                .map((c) => `<option value="${c}">${t("currencyNames")[c]}</option>`)
                .join("")}
            </select>
            ${isEditingBase ? `<p style="font-size:11px;color:var(--wt-text-dim);margin:6px 0 0">${t("currencyLockedNote")}</p>` : ""}
          </div>
          <div class="wt-modal-actions">
            <button type="button" class="wt-btn-ghost" onclick="closeAddModal()">${t("cancel")}</button>
            <button type="submit" class="wt-btn">${editingId ? t("saveChanges") : t("add")}</button>
          </div>
        </form>
      </div>
    </div>`;
          })()
        : ""
    }
    ${goalModalOpen ? renderGoalModal() : ""}
    ${contribModalOpen ? renderContribModal() : ""}
    ${emailModalOpen ? renderEmailModal() : ""}
    ${itemHistoryModalId ? renderItemHistoryModal() : ""}
    ${returnPanelOpen ? renderReturnPanel() : ""}
  `;

  renderSyncBadge();
  if (rates) renderBreakdown();
  renderHistory();
  logoAnimated = true;
}
