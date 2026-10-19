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
  { key: "category", labelKey: "thCategory" },
  { key: "yield", labelKey: "thYield" },
  { key: "apy", labelKey: "thApy" },
  { key: "unitPrice", labelKey: "thUnitPrice" },
  { key: "total", labelKey: "thTotal" },
  { key: "projection", labelKey: "thProjection" },
  { key: "gain", labelKey: "thGain" },
  { key: "cronTouch", labelKey: "thCronTouch" },
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


// ══════════════════════════════════════════════════════
//  Column sorting — ▲ (ascending) / ▼ (descending) buttons in each column
//  header. View-only, like the group/name filters: it never changes the
//  saved manual order, totals, or history. Clicking the active arrow again
//  clears the sort and goes back to the manual order. Rows with no value
//  for the sorted column (e.g. "—") always sink to the bottom.
// ══════════════════════════════════════════════════════

function setSort(key, dir) {
  if (sortKey === key && sortDir === dir) sortKey = null;
  else {
    sortKey = key;
    sortDir = dir;
  }
  render();
}

// Gain in USD (null when the table shows "—"). Mirrors the Gain cell in render.js.
function assetGainUsd(a) {
  const cfg = returnConfig[a.id];
  if (!assetGeneratesReturn(a.id) || !cfg || !cfg.startDate) return null;
  const m = primaryMilestone(a);
  if (!m) return null;
  const projectionShown = (m.principalPortion != null ? m.principalPortion : 0) + m.value;
  return (projectionShown - (qty[a.id] || 0)) * priceFor(a);
}

function sortValueFor(a, key) {
  switch (key) {
    case "order":
      return order.indexOf(a.id);
    case "asset":
      return String(assetName(a) || "").toLowerCase();
    case "qty":
      return qty[a.id] || 0;
    case "category":
      return a.isAsset ? 1 : 0;
    case "yield":
      return assetGeneratesReturn(a.id) ? 1 : 0;
    case "apy": {
      if (!assetGeneratesReturn(a.id)) return null;
      const r = currentTierRate(returnConfig[a.id] || {}, parseDateStr(todayLocalStr()));
      if (r != null) return r;
      return apy[a.id] ? apy[a.id] : null;
    }
    case "unitPrice":
      return priceFor(a);
    case "total":
      return (qty[a.id] || 0) * priceFor(a);
    case "projection": {
      const m = primaryMilestone(a);
      return m ? ((m.principalPortion != null ? m.principalPortion : 0) + m.value) * priceFor(a) : null;
    }
    case "gain":
      return assetGainUsd(a);
    case "cronTouch": {
      const r = nextCronTouch(qty[a.id] || 0, apy[a.id] || 0, returnConfig[a.id] || {}, todayLocalStr());
      return r && r.date ? r.date.getTime() : null;
    }
    default:
      return null;
  }
}

function sortAssets(list) {
  if (!sortKey) return list;
  const dir = sortDir === "desc" ? -1 : 1;
  return list
    .map((a, i) => ({ a, i, v: sortValueFor(a, sortKey) }))
    .sort((x, y) => {
      const xn = x.v == null || Number.isNaN(x.v);
      const yn = y.v == null || Number.isNaN(y.v);
      if (xn || yn) return xn === yn ? x.i - y.i : xn ? 1 : -1;
      const c = typeof x.v === "string" ? x.v.localeCompare(y.v) : x.v - y.v;
      return c ? c * dir : x.i - y.i;
    })
    .map((e) => e.a);
}

// <th> with the label plus ▲/▼ sort buttons.
function sortTh(key, labelHtml, cls) {
  const up = sortKey === key && sortDir === "asc";
  const down = sortKey === key && sortDir === "desc";
  return `<th class="${cls || ""}"><div class="wt-th-sort"><span>${labelHtml}</span><span class="wt-sort-btns">` +
    `<button type="button" class="wt-sort-btn ${up ? "active" : ""}" onclick="setSort('${key}','asc')" title="${t("sortAsc")}">▲</button>` +
    `<button type="button" class="wt-sort-btn ${down ? "active" : ""}" onclick="setSort('${key}','desc')" title="${t("sortDesc")}">▼</button>` +
    `</span></div></th>`;
}
