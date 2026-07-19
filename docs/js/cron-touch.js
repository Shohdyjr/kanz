// ══════════════════════════════════════════════════════
//  "Next cron touch" — a small popover, opened from a button in each table
//  row's action group (next to History/Edit), answering a different
//  question than the Projection column's Milestone: not "what does this
//  product's own schedule call its next event" but literally "when will
//  the daily cron next post growth into this item's stored balance".
//
//  Powered by nextCronTouch() in growth-pipeline.js, which mirrors
//  dailyGrowthDelta() (the cron's own "does it apply today" check) exactly,
//  so the answer here can never silently drift from what the cron actually
//  does. Purely a read of existing config — nothing here is stored.
//
//  Also shows accrualBreakdown() (Phase 1 of the financial-product
//  redesign — see docs-dev/architecture-principles.md): for a periodic
//  product (credits monthly/quarterly/etc rather than continuously), the
//  balance shown elsewhere doesn't include what's accrued since the last
//  credit boundary — this popover is the one place that estimate surfaces.
// ══════════════════════════════════════════════════════

function toggleCronTouchInfo(id) {
  cronTouchOpenId = cronTouchOpenId === id ? null : id;
  render();
}

function closeCronTouchInfo() {
  cronTouchOpenId = null;
  render();
}

function renderCronTouchPanel() {
  if (!cronTouchOpenId) return `<div id="wt-cron-panel-root"></div>`;
  const a = ASSETS.find((x) => x.id === cronTouchOpenId);
  if (!a) return `<div id="wt-cron-panel-root"></div>`;

  const result = nextCronTouch(qty[a.id] || 0, apy[a.id] || 0, returnConfig[a.id] || {}, todayLocalStr());
  const dateLine = result.date
    ? `<div class="wt-cron-panel-date">${fmtDateShort(result.date)}</div>`
    : `<div class="wt-cron-panel-date wt-cron-panel-none">${t("cronTouchNoDate")}</div>`;

  const accrual = accrualBreakdown(qty[a.id] || 0, apy[a.id] || 0, returnConfig[a.id] || {}, todayLocalStr());
  const accrualSection =
    accrual.accruedEarnings > 0
      ? `<div class="wt-cron-panel-accrual">
          <p class="wt-cron-panel-accrual-label">${t("accruedSinceCreditLabel")}</p>
          <div class="wt-cron-panel-accrual-value">≈ ${fmtByCurrencyPrecise(accrual.accruedEarnings, a.currency)}</div>
          <p class="wt-cron-panel-reason">${t("accruedSinceCreditHint")(fmtDateShort(accrual.lastCreditDate), fmtDateShort(accrual.nextCreditDate))}</p>
        </div>`
      : "";

  return `<div id="wt-cron-panel-root">
    <div class="wt-col-panel-overlay" onclick="closeCronTouchInfo()"></div>
    <div class="wt-col-panel wt-cron-panel">
      <p class="wt-col-panel-title">${t("nextCronTouchTitle")} — ${esc(assetName(a))}</p>
      ${dateLine}
      <p class="wt-cron-panel-reason">${t(result.reasonKey)}</p>
      ${accrualSection}
    </div>
  </div>`;
}
