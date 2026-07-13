// ══════════════════════════════════════════════════════
//  "Since when has this money been here?" — quick per-row popover.
//
//  Writes to returnConfig[id].startDate, the same field the Return Settings
//  panel (return-config.js) and the growth engine (growthEngine.js /
//  return-config.js's own projection math) already read to anchor
//  compounding periods and tiered-rate anniversaries. This file adds no new
//  storage and no backend change — it's purely a faster way to set/correct
//  that one date from the table row itself, instead of opening the full
//  Return Settings panel (product type, rate type, payout frequency, etc.)
//  just to fix a single date.
//
//  Deliberately kept separate from `qtyUpdatedAt` (assets.js/state.js): that
//  field is an automatic, read-only "I last typed a number here on this
//  day" stamp and is never used in any calculation. This one is the
//  opposite — always user-set, never touched automatically, and it's the
//  one the projections actually depend on.
// ══════════════════════════════════════════════════════

function toggleSinceDatePopover(ev, id) {
  if (ev) ev.stopPropagation();
  sinceDatePopoverId = sinceDatePopoverId === id ? null : id;
  render();
}

function closeSinceDatePopover() {
  if (!sinceDatePopoverId) return;
  sinceDatePopoverId = null;
  render();
}

// `dateStr` of null/"" clears the field (falls back to no anchor date,
// same as an item that never had one set).
function setSinceDate(id, dateStr) {
  if (dateStr) {
    returnConfig[id] = { ...(returnConfig[id] || {}), startDate: dateStr };
  } else if (returnConfig[id]) {
    const { startDate, ...rest } = returnConfig[id];
    returnConfig[id] = rest;
  }
  sinceDatePopoverId = null;
  render();
  renderBreakdown();
  scheduleSave();
}

function sinceDateFromNativeInput(id, value) {
  if (!value) return;
  setSinceDate(id, value);
}

const sinceDatePreset = (daysAgo) => addDaysToDateStr(todayLocalStr(), -daysAgo);

function renderSinceDateBtn(a) {
  const cfg = returnConfig[a.id];
  const set = cfg && cfg.startDate;
  const label = set ? t("sinceDateBtnSet")(fmtDateShort(parseDateStr(cfg.startDate))) : t("sinceDateBtn");
  return `
    <div class="wt-since-wrap">
      <button type="button" class="wt-since-btn ${set ? "is-set" : ""}"
        onclick="toggleSinceDatePopover(event,'${a.id}')" title="${t("sinceDateBtnTitle")}">${label}</button>
      ${sinceDatePopoverId === a.id ? renderSinceDatePopover(a) : ""}
    </div>`;
}

function renderSinceDatePopover(a) {
  const cur = (returnConfig[a.id] && returnConfig[a.id].startDate) || "";
  const presets = [
    { key: "sinceDateToday", days: 0 },
    { key: "sinceDateWeekAgo", days: 7 },
    { key: "sinceDateMonthAgo", days: 30 },
    { key: "sinceDateYearAgo", days: 365 },
  ];
  return `
    <div class="wt-since-popover-overlay" onclick="closeSinceDatePopover()"></div>
    <div class="wt-since-popover" onclick="event.stopPropagation()">
      <p class="wt-since-title">${t("sinceDatePopoverTitle")}</p>
      <p class="wt-since-hint">${t("sinceDatePopoverHint")}</p>
      <div class="wt-since-presets">
        ${presets
          .map(
            (p) =>
              `<button type="button" class="wt-since-preset" onclick="setSinceDate('${a.id}','${sinceDatePreset(p.days)}')">${t(p.key)}</button>`
          )
          .join("")}
      </div>
      <label class="wt-since-custom-label" for="since-date-input-${a.id}">${t("sinceDateCustomLabel")}</label>
      <input type="date" id="since-date-input-${a.id}" class="wt-since-input" dir="ltr"
        value="${cur}" max="${todayLocalStr()}"
        onchange="sinceDateFromNativeInput('${a.id}',this.value)">
      <div class="wt-since-actions">
        ${cur ? `<button type="button" class="wt-btn-ghost wt-since-clear" onclick="setSinceDate('${a.id}',null)">${t("sinceDateClear")}</button>` : "<span></span>"}
        <button type="button" class="wt-btn wt-since-done" onclick="closeSinceDatePopover()">${t("sinceDateDone")}</button>
      </div>
    </div>`;
}
