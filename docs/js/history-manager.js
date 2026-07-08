// ── History manager (Excel-like interactive table: view/edit/delete inline) ──
let historyManagerEdits = {}; // { date: {egpUsd, hardUsd, goldUsd, assetsUsd} } — unsaved edits to existing rows
let historyManagerDrafts = []; // [{ tempId, date, egpUsd, hardUsd, goldUsd, assetsUsd }] — new unsaved rows
let historyManagerStatus = null; // { ok: true/false, text } — save confirmation, disappears on its own
let historyManagerFilter = ""; // date search filter for the table (e.g. "2026-06" shows just June)

// Wraps rpcCall in a Promise so we can await it when saving several rows in sequence
function callServer(fnName, ...args) {
  return new Promise((resolve, reject) => {
    rpc.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [fnName](...args);
  });
}

function openHistoryManager() {
  historyManagerOpen = true;
  historyManagerEdits = {};
  historyManagerDrafts = [];
  historyManagerStatus = null;
  historyManagerFilter = "";
  renderHistory();
}

function closeHistoryManager() {
  historyManagerOpen = false;
  historyManagerEdits = {};
  historyManagerDrafts = [];
  historyManagerStatus = null;
  historyManagerFilter = "";
  renderHistory();
}

function deleteHistoryEntryUi(date) {
  if (!confirm(t("confirmDeleteEntry")(date))) return;
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        historyData = (j.history || []).sort((a, b) => a.date.localeCompare(b.date));
        delete historyManagerEdits[date];
        render();
        renderHistory();
      }
    })
    .withFailureHandler(function (err) {
      console.error("deleteHistoryEntry:", err);
    })
    .deleteHistoryEntry(currentUser, date, sessionToken);
}

// Called on every numeric-cell edit for an existing row — updates the in-memory
// value and the row total instantly, without a full re-render (to avoid losing focus)
function onHistCellEdit(date, field, value) {
  const num = parseFloat(value) || 0;
  const original = historyData.find((h) => h.date === date) || {};

  if (!historyManagerEdits[date]) {
    historyManagerEdits[date] = {
      egpUsd: original.egpUsd || 0,
      hardUsd: original.hardUsd || 0,
      goldUsd: original.goldUsd || 0,
      assetsUsd: original.assetsUsd || 0,
    };
  }
  historyManagerEdits[date][field] = num;

  const e = historyManagerEdits[date];
  const total = (e.egpUsd || 0) + (e.hardUsd || 0) + (e.goldUsd || 0) + (e.assetsUsd || 0);
  const totalEl = document.getElementById("histmgr-total-" + date);
  if (totalEl) totalEl.textContent = fmtUsd(total);

  const row = document.querySelector('tr[data-date="' + date + '"]');
  if (row) row.classList.add("dirty");

  updateHistmgrSaveButton();
}

// ── Duplicate a row (existing or draft) — like "Duplicate row" in Excel ────
// Copies the four values, suggests the day right after the source date (still
// editable), and inserts the new row as a "draft" above the table until saved
function duplicateHistoryRow(sourceKey) {
  let source;
  let baseDateStr = "";

  if (sourceKey.indexOf("draft_") === 0) {
    source = historyManagerDrafts.find((d) => d.tempId === sourceKey);
    if (source) baseDateStr = source.date;
  } else {
    const edit = historyManagerEdits[sourceKey];
    const original = historyData.find((h) => h.date === sourceKey) || {};
    source = edit || original;
    baseDateStr = sourceKey;
  }
  if (!source) return;

  let suggestedDate = "";
  if (baseDateStr && /^\d{4}-\d{2}-\d{2}$/.test(baseDateStr)) {
    suggestedDate = addDaysToDateStr(baseDateStr, 1);
  }

  historyManagerDrafts.push({
    tempId: "draft_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date: suggestedDate,
    egpUsd: source.egpUsd || 0,
    hardUsd: source.hardUsd || 0,
    goldUsd: source.goldUsd || 0,
    assetsUsd: source.assetsUsd || 0,
  });

  renderHistory();
}

// ── Insert a brand-new empty row (like inserting a row in Excel) ──────
function addBlankDraftRow() {
  historyManagerDrafts.push({
    tempId: "draft_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date: "",
    egpUsd: 0,
    hardUsd: 0,
    goldUsd: 0,
    assetsUsd: 0,
  });
  renderHistory();
}

function removeDraftRow(tempId) {
  historyManagerDrafts = historyManagerDrafts.filter((d) => d.tempId !== tempId);
  renderHistory();
  updateHistmgrSaveButton();
}

function onDraftDateEdit(tempId, value) {
  const draft = historyManagerDrafts.find((d) => d.tempId === tempId);
  if (!draft) return;
  draft.date = value;
  updateHistmgrSaveButton();
}

function onDraftCellEdit(tempId, field, value) {
  const draft = historyManagerDrafts.find((d) => d.tempId === tempId);
  if (!draft) return;
  draft[field] = parseFloat(value) || 0;

  const total = (draft.egpUsd || 0) + (draft.hardUsd || 0) + (draft.goldUsd || 0) + (draft.assetsUsd || 0);
  const totalEl = document.getElementById("histmgr-total-" + tempId);
  if (totalEl) totalEl.textContent = fmtUsd(total);

  updateHistmgrSaveButton();
}

// Called on every keystroke in the search box — needs a full table re-render
// (required for filtering), then restores focus and cursor position to the
// search box itself so typing feels uninterrupted
function onHistmgrFilterChange(value) {
  historyManagerFilter = value;
  renderHistory();
  const el = document.querySelector(".wt-histmgr-search");
  if (el) {
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }
}

function updateHistmgrSaveButton() {
  const btn = document.getElementById("histmgr-save-btn");
  if (!btn) return;
  const editCount = Object.keys(historyManagerEdits).length;
  const draftCount = historyManagerDrafts.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)).length;
  const count = editCount + draftCount;
  btn.disabled = count === 0;
  btn.textContent = t("saveChanges") + (count > 0 ? " (" + count + ")" : "");
}

// Saves all edited rows and valid drafts in sequence, then does a full reload
async function saveAllHistoryEdits() {
  const editDates = Object.keys(historyManagerEdits);
  const validDrafts = historyManagerDrafts.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  if (editDates.length === 0 && validDrafts.length === 0) return;

  const btn = document.getElementById("histmgr-save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }

  let successCount = 0;
  let failCount = 0;

  for (const date of editDates) {
    const e = historyManagerEdits[date];
    const totalUsd = (e.egpUsd || 0) + (e.hardUsd || 0) + (e.goldUsd || 0) + (e.assetsUsd || 0);
    try {
      const res = await callServer(
        "addManualHistoryEntry",
        currentUser,
        {
          date,
          totalUsd,
          egpUsd: e.egpUsd || 0,
          hardUsd: e.hardUsd || 0,
          goldUsd: e.goldUsd || 0,
          assetsUsd: e.assetsUsd || 0,
        },
        sessionToken
      );
      if (res && res.ok) successCount++;
      else failCount++;
    } catch (err) {
      failCount++;
      console.error("saveAllHistoryEdits (edit):", date, err);
    }
  }

  for (const d of validDrafts) {
    const totalUsd = (d.egpUsd || 0) + (d.hardUsd || 0) + (d.goldUsd || 0) + (d.assetsUsd || 0);
    try {
      const res = await callServer(
        "addManualHistoryEntry",
        currentUser,
        {
          date: d.date,
          totalUsd,
          egpUsd: d.egpUsd || 0,
          hardUsd: d.hardUsd || 0,
          goldUsd: d.goldUsd || 0,
          assetsUsd: d.assetsUsd || 0,
        },
        sessionToken
      );
      if (res && res.ok) successCount++;
      else failCount++;
    } catch (err) {
      failCount++;
      console.error("saveAllHistoryEdits (draft):", d.date, err);
    }
  }

  historyManagerEdits = {};
  historyManagerDrafts = [];

  historyManagerStatus =
    failCount === 0
      ? { ok: true, text: t("historySaveSuccess")(successCount) }
      : { ok: false, text: t("historySavePartialFail")(successCount, failCount) };

  loadHistory(); // reload the full history and refresh the whole screen (including the table if open)

  // The message disappears on its own after a bit, no user action needed
  setTimeout(() => {
    historyManagerStatus = null;
    if (historyManagerOpen) renderHistory();
  }, 3500);
}

function renderHistoryManager() {
  const filterText = (historyManagerFilter || "").trim();
  const sorted = [...historyData]
    .filter((h) => !filterText || h.date.includes(filterText))
    .sort((a, b) => b.date.localeCompare(a.date));
  const dupIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const delIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

  const draftRows = historyManagerDrafts
    .map((d) => {
      const total = (d.egpUsd || 0) + (d.hardUsd || 0) + (d.goldUsd || 0) + (d.assetsUsd || 0);
      return `<tr class="draft-row" data-draft="${d.tempId}">
      <td><input type="date" value="${d.date}" oninput="onDraftDateEdit('${d.tempId}', this.value)"></td>
      <td><input type="number" step="any" value="${d.egpUsd}" oninput="onDraftCellEdit('${d.tempId}','egpUsd',this.value)"></td>
      <td><input type="number" step="any" value="${d.hardUsd}" oninput="onDraftCellEdit('${d.tempId}','hardUsd',this.value)"></td>
      <td><input type="number" step="any" value="${d.goldUsd}" oninput="onDraftCellEdit('${d.tempId}','goldUsd',this.value)"></td>
      <td><input type="number" step="any" value="${d.assetsUsd}" oninput="onDraftCellEdit('${d.tempId}','assetsUsd',this.value)"></td>
      <td class="wt-histmgr-td-total" id="histmgr-total-${d.tempId}">${fmtUsd(total)}</td>
      <td><div class="wt-row-actions">
        <button class="wt-edit" onclick="duplicateHistoryRow('${d.tempId}')" title="${t("duplicateTitle")}">${dupIcon}</button>
        <button class="wt-del" onclick="removeDraftRow('${d.tempId}')" title="${t("deleteTitle")}">${delIcon}</button>
      </div></td>
    </tr>`;
    })
    .join("");

  const savedRows =
    sorted.length === 0
      ? historyManagerDrafts.length === 0
        ? `<tr><td colspan="7" class="wt-histmgr-empty">${filterText ? t("historyManagerNoMatch") : t("historyManagerEmpty")}</td></tr>`
        : ""
      : sorted
          .map((h) => {
            const edit = historyManagerEdits[h.date];
            const egp = edit ? edit.egpUsd : h.egpUsd || 0;
            const hard = edit ? edit.hardUsd : h.hardUsd || 0;
            const gold = edit ? edit.goldUsd : h.goldUsd || 0;
            const assets = edit ? edit.assetsUsd : h.assetsUsd || 0;
            const total = egp + hard + gold + assets;
            const dirtyCls = edit ? "dirty" : "";
            return `<tr class="${dirtyCls}" data-date="${h.date}">
          <td class="wt-histmgr-td-date">${h.date}</td>
          <td><input type="number" step="any" value="${egp}" oninput="onHistCellEdit('${h.date}','egpUsd',this.value)"></td>
          <td><input type="number" step="any" value="${hard}" oninput="onHistCellEdit('${h.date}','hardUsd',this.value)"></td>
          <td><input type="number" step="any" value="${gold}" oninput="onHistCellEdit('${h.date}','goldUsd',this.value)"></td>
          <td><input type="number" step="any" value="${assets}" oninput="onHistCellEdit('${h.date}','assetsUsd',this.value)"></td>
          <td class="wt-histmgr-td-total" id="histmgr-total-${h.date}">${fmtUsd(total)}</td>
          <td><div class="wt-row-actions">
            <button class="wt-edit" onclick="duplicateHistoryRow('${h.date}')" title="${t("duplicateTitle")}">${dupIcon}</button>
            <button class="wt-del" onclick="deleteHistoryEntryUi('${h.date}')" title="${t("deleteTitle")}">${delIcon}</button>
          </div></td>
        </tr>`;
          })
          .join("");

  const dirtyCount =
    Object.keys(historyManagerEdits).length +
    historyManagerDrafts.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)).length;

  return `
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeHistoryManager()">
    <div class="wt-modal wt-histmgr-modal wt-histmgr-table-modal">
      <div class="wt-table-head" style="margin-bottom:10px">
        <h3 style="margin:0">${t("historyManagerTitle")}</h3>
        <button type="button" class="wt-btn-add" onclick="addBlankDraftRow()" title="${t("addRowBtn")}">+</button>
      </div>
      <input type="text" class="wt-histmgr-search" placeholder="${t("searchByDatePh")}" value="${filterText}" oninput="onHistmgrFilterChange(this.value)" dir="ltr">
      ${historyManagerStatus ? `<p style="font-size:12.5px;margin:-4px 0 10px;color:${historyManagerStatus.ok ? "var(--wt-green)" : "var(--wt-red)"}">${historyManagerStatus.ok ? "✓ " : "⚠ "}${historyManagerStatus.text}</p>` : ""}
      <div class="wt-histmgr-table-wrap">
        <table class="wt-histmgr-table">
          <thead><tr>
            <th>${t("historyDateLabel")}</th>
            <th>${t("entryEgpLabel")}</th>
            <th>${t("entryHardLabel")}</th>
            <th>${t("entryGoldLabel")}</th>
            <th>${t("entryAssetsLabel")}</th>
            <th>${t("entryTotalLabel")}</th>
            <th></th>
          </tr></thead>
          <tbody>${draftRows}${savedRows}</tbody>
        </table>
      </div>
      <div class="wt-modal-actions">
        <button type="button" class="wt-btn-ghost" onclick="closeHistoryManager()">${t("closeBtn")}</button>
        <button type="button" class="wt-btn" id="histmgr-save-btn" onclick="saveAllHistoryEdits()" ${dirtyCount === 0 ? "disabled" : ""}>${t("saveChanges")}${dirtyCount > 0 ? " (" + dirtyCount + ")" : ""}</button>
      </div>
    </div>
  </div>`;
}
