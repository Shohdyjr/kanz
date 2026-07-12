// ── Per-item history modal ──────────────────────────────────────────
// Shows the automatic timeline of daily APY-driven growth for one item:
// date, quantity before → after, and the delta. Entries are written by the
// backend cron (backend/cron/dailySnapshot.js) whenever that item has an
// apy set — there is nothing to add manually here, this is read-only.

function openItemHistoryModal(id) {
  itemHistoryModalId = id;
  itemHistoryEntries = [];
  render();
  loadItemHistory(id);
}

function closeItemHistoryModal() {
  itemHistoryModalId = null;
  itemHistoryEntries = [];
  render();
}

function loadItemHistory(id) {
  if (!currentUser) return;
  callApi("loadItemHistoryForClient", currentUser, id, sessionToken)
    .then(function (j) {
      if (j && j.ok && Array.isArray(j.itemHistory)) {
        // Newest first
        itemHistoryEntries = j.itemHistory.slice().sort((a, b) => b.date.localeCompare(a.date));
      }
      if (itemHistoryModalId === id) render();
    })
    .catch(function (err) {
      console.error("loadItemHistory:", err);
    });
}

function renderItemHistoryModal() {
  const a = ASSETS.find((x) => x.id === itemHistoryModalId);
  const name = a ? assetName(a) : itemHistoryModalId;
  const hasApy = a && apy[a.id] > 0;

  const rows = itemHistoryEntries
    .map((e) => {
      const up = e.delta >= 0;
      const color = up ? "var(--wt-green)" : "var(--wt-red)";
      const arrow = up ? "▲" : "▼";
      const sign = up ? "+" : "";
      return `<div class="wt-item-hist-row">
        <span class="wt-item-hist-date">${e.date}</span>
        <span class="wt-item-hist-vals">${fmtNum(e.before, 4)} → ${fmtNum(e.after, 4)}</span>
        <span class="wt-item-hist-delta" style="color:${color}">${arrow} ${sign}${fmtNum(e.delta, 4)}</span>
      </div>`;
    })
    .join("");

  return `
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeItemHistoryModal()">
    <div class="wt-modal wt-item-hist-modal">
      <h3>${t("itemHistoryModalTitle")(name)}</h3>
      ${
        !hasApy
          ? `<p class="wt-item-hist-empty">${t("itemHistoryNoApy")}</p>`
          : itemHistoryEntries.length
            ? `<div class="wt-item-hist-list">${rows}</div>`
            : `<p class="wt-item-hist-empty">${t("itemHistoryEmpty")}</p>`
      }
      <div class="wt-modal-actions">
        <button type="button" class="wt-btn-ghost" onclick="closeItemHistoryModal()">${t("close")}</button>
      </div>
    </div>
  </div>`;
}
