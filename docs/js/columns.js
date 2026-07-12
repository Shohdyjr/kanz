// ══════════════════════════════════════════════════════
//  Column visibility — lets the user hide/show optional table columns
//  (APY, unit price, total, the 3 projection columns) from a small popover
//  under the "⚙ Columns" button in the table header. Order/asset/qty/actions
//  always stay visible — those are the columns needed to actually use the
//  table, only the "extra info" ones are toggleable.
//  A pure per-device display preference — persisted in localStorage, not
//  sent to the server, so it doesn't touch saveData()/the backend at all.
// ══════════════════════════════════════════════════════

const COLUMN_DEFS = [
  { key: "apy", labelKey: "thApy" },
  { key: "unitPrice", labelKey: "thUnitPrice" },
  { key: "total", labelKey: "thTotal" },
  { key: "projNext", labelKey: "thProjNext" },
  { key: "projCycle", labelKey: "thProjCycle" },
  { key: "projYearEnd", labelKey: "thProjYearEnd" },
];

function isColHidden(key) {
  return hiddenCols.has(key);
}

function persistHiddenCols() {
  try {
    localStorage.setItem("kanz_hidden_cols_v1", JSON.stringify([...hiddenCols]));
  } catch (e) {
    // storage unavailable (private mode, quota, etc.) — safe to ignore,
    // it just means the choice won't survive a refresh this time
  }
}

function toggleColumnVisibility(key) {
  if (hiddenCols.has(key)) hiddenCols.delete(key);
  else hiddenCols.add(key);
  persistHiddenCols();
  const root = document.getElementById("wt-col-panel-root");
  if (root) root.outerHTML = renderColumnPanel();
  // Column set changed → the table itself needs a full re-render (cells removed/added).
  render();
}

function toggleColumnPanel() {
  columnPanelOpen = !columnPanelOpen;
  render();
}

function closeColumnPanel() {
  columnPanelOpen = false;
  render();
}

function renderColumnPanel() {
  if (!columnPanelOpen) return `<div id="wt-col-panel-root"></div>`;
  return `<div id="wt-col-panel-root">
    <div class="wt-col-panel-overlay" onclick="closeColumnPanel()"></div>
    <div class="wt-col-panel">
      <p class="wt-col-panel-title">${t("columnsBtnTitle")}</p>
      ${COLUMN_DEFS.map(
        (c) => `
        <label class="wt-col-panel-row">
          <input type="checkbox" ${isColHidden(c.key) ? "" : "checked"} onchange="toggleColumnVisibility('${c.key}')">
          <span>${t(c.labelKey)}</span>
        </label>`
      ).join("")}
    </div>
  </div>`;
}
