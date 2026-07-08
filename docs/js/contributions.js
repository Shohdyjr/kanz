// ── Contributions log ────────────────────────────────
// Lets the user record "net money added this period" (salary minus expenses,
// or a withdrawal as a negative number) separately from the wealth snapshots
// in historyData. The growth calculations in helpers.js subtract these from
// a period's raw wealth delta to isolate real, price-driven growth — see
// computeGrowth()/computeGrowthSince()/computeGrowthAllTime() and attachRealGrowth().

function openContribModal() {
  contribModalOpen = true;
  render();
  setTimeout(() => {
    const f = document.getElementById("contrib-amount");
    if (f) f.focus();
  }, 50);
}

function closeContribModal() {
  contribModalOpen = false;
  render();
}

function loadContributions() {
  if (!currentUser) return;
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok && Array.isArray(j.contributions)) {
        contributionsData = j.contributions.sort((a, b) => a.date.localeCompare(b.date));
      }
      // Contributions affect the growth chips, so re-render the hero section
      // (and the modal's own recent-entries list, if it's open).
      render();
    })
    .withFailureHandler(function (err) {
      console.error("loadContributions:", err);
    })
    .loadContributionsForClient(currentUser, sessionToken);
}

function submitContribution(ev) {
  ev.preventDefault();
  const dateEl = document.getElementById("contrib-date");
  const amountEl = document.getElementById("contrib-amount");
  const noteEl = document.getElementById("contrib-note");
  const errEl = document.getElementById("contrib-error");

  errEl.style.display = "none";
  const date = dateEl.value;
  const amountUsd = parseFloat(amountEl.value);
  const note = (noteEl.value || "").trim();

  if (!date) {
    errEl.textContent = t("errHistoryDate");
    errEl.style.display = "block";
    return;
  }
  if (!Number.isFinite(amountUsd) || amountUsd === 0) {
    errEl.textContent = t("errContribAmount");
    errEl.style.display = "block";
    return;
  }

  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        amountEl.value = "";
        noteEl.value = "";
        loadContributions();
      } else {
        errEl.textContent = j && j.error ? t(j.error) : t("genericError");
        errEl.style.display = "block";
      }
    })
    .withFailureHandler(function () {
      errEl.textContent = t("connectionError");
      errEl.style.display = "block";
    })
    .addContribution(currentUser, { date, amountUsd, note }, sessionToken);
}

function deleteContribution(date) {
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) loadContributions();
    })
    .withFailureHandler(function (err) {
      console.error("deleteContribution:", err);
    })
    .deleteContribution(currentUser, date, sessionToken);
}

// Most recent entries first, capped so the modal doesn't grow unbounded
function renderRecentContributions() {
  if (!contributionsData || contributionsData.length === 0) {
    return `<p style="color:var(--wt-text-dim);font-size:12px;margin:8px 0 0">${t("contribEmpty")}</p>`;
  }
  const recent = [...contributionsData].reverse().slice(0, 6);
  return `<div class="wt-contrib-list">
    ${recent
      .map((c) => {
        const up = c.amountUsd >= 0;
        const sign = up ? "+" : "";
        const color = up ? "var(--wt-green)" : "var(--wt-red)";
        return `<div class="wt-contrib-row">
        <span class="wt-contrib-date">${esc(c.date)}</span>
        <span class="wt-contrib-amount" style="color:${color}">${sign}${fmtUsd(c.amountUsd)}</span>
        ${c.note ? `<span class="wt-contrib-note">${esc(c.note)}</span>` : ""}
        <button type="button" class="wt-del" title="${t("deleteTitle")}" onclick="deleteContribution('${esc(c.date)}')">×</button>
      </div>`;
      })
      .join("")}
  </div>`;
}

function renderContribModal() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return `
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeContribModal()">
    <div class="wt-modal">
      <h3>${t("contribModalTitle")}</h3>
      <p style="font-size:12px;color:var(--wt-text-dim);margin:-8px 0 4px">${t("contribModalHint")}</p>
      <form onsubmit="submitContribution(event)">
        <div class="wt-field" style="margin-bottom:6px">
          <label for="contrib-date">${t("historyDateLabel")}</label>
          <input type="date" id="contrib-date" max="${todayStr}" value="${todayStr}">
        </div>
        <div class="wt-field" style="margin-bottom:6px">
          <label for="contrib-amount">${t("contribAmountLabel")}</label>
          <input type="number" id="contrib-amount" step="any" placeholder="500" dir="ltr">
        </div>
        <div class="wt-field">
          <label for="contrib-note">${t("contribNoteLabel")}</label>
          <input type="text" id="contrib-note" maxlength="200" placeholder="${t("contribNotePh")}">
        </div>
        <p id="contrib-error" style="display:none;color:var(--wt-red);font-size:12px;margin:-6px 0 12px"></p>
        <div class="wt-modal-actions">
          <button type="button" class="wt-btn-ghost" onclick="closeContribModal()">${t("cancel")}</button>
          <button type="submit" class="wt-btn">${t("add")}</button>
        </div>
      </form>
      <hr style="border-color:var(--wt-border,rgba(255,255,255,.08));margin:16px 0" />
      <p class="wt-bk-leg-title" style="margin-bottom:6px">${t("contribRecentTitle")}</p>
      ${renderRecentContributions()}
    </div>
  </div>`;
}
