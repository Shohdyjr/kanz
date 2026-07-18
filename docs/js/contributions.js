// ── Contributions — full-screen yearly grid ───────────────────────────
// Replaces the old small modal. Shows a 4×3 grid of all 12 months of the
// current year. Each cell has two rows:
//   + income (green)  — money that came IN this month (salary, bonus, etc.)
//   - expenses (red)  — money that went OUT (spent, withdrawn)
// The net (income − expenses) is what gets passed to helpers.js so growth
// calculations can subtract it from raw wealth deltas.

// ── State ──
// Each contribution entry now has:
//   { date, type: "income"|"expense", amountUsd, note }
// The server/backend model stays the same (stores any amountUsd — positive
// or negative) so old net entries still display; new UI writes two separate
// signed entries instead.

function openContribModal() {
  contribModalOpen = true;
  render();
}

function closeContribModal() {
  contribModalOpen = false;
  render();
}

function loadContributions() {
  if (!currentUser) return;
  callApi("loadContributionsForClient", currentUser, sessionToken)
    .then(function (j) {
      if (j && j.ok && Array.isArray(j.contributions)) {
        contributionsData = j.contributions.sort((a, b) => a.date.localeCompare(b.date));
      }
      render();
    })
    .catch(function (err) {
      console.error("loadContributions:", err);
    });
}

// ── Helpers ──

const MONTH_NAMES_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(m0) {
  // m0 is 0-indexed
  return lang === "ar" ? MONTH_NAMES_AR[m0] : MONTH_NAMES_EN[m0];
}

// Returns {income, expense, net} for YYYY-MM
function monthSummary(yearMonth) {
  let income = 0,
    expense = 0;
  (contributionsData || []).forEach((c) => {
    if (!c.date.startsWith(yearMonth)) return;
    // Support both old-style net entries (amountUsd positive=income, negative=expense)
    // and new-style entries with explicit type field.
    const amt = parseFloat(c.amountUsd) || 0;
    if (INCOME_ACTIVITY_TYPES.has(c.type) || (!c.type && amt > 0)) income += Math.abs(amt);
    else if (EXPENSE_ACTIVITY_TYPES.has(c.type) || (!c.type && amt < 0)) expense += Math.abs(amt);
  });
  return { income, expense, net: income - expense };
}

// Currencies the user can log a salary/expense entry in — kept in sync with
// CONTRIB_CURRENCIES in backend/routes/data.js.
const CONTRIB_CURRENCIES = ["EGP", "USD", "EUR", "SAR"];

// ── Save a single entry ──
// `currency` is what the user actually typed the amount in (e.g. a salary in
// EGP); it's converted to USD here using the same live FX rates the rest of
// the app already uses (priceFor, from helpers.js) so amountUsd — the figure
// every growth calculation relies on — stays exactly as before. The original
// amount+currency are sent along too, purely so the entry can be displayed
// back in its original currency later.
function saveContribEntry(yearMonth, type, rawAmt, currency, note, onDone) {
  const amt = Math.abs(parseFloat(rawAmt) || 0);
  if (!amt) {
    onDone && onDone("errContribAmount");
    return;
  }
  const cur = CONTRIB_CURRENCIES.includes(currency) ? currency : "USD";
  const rate = priceFor({ currency: cur });
  if (!rate) {
    // Rates haven't loaded yet (e.g. called right after login) — better to
    // ask the user to retry than to silently save a wrong/zero USD amount.
    onDone && onDone("errContribRate");
    return;
  }
  // Use first of the month as key, keep type in the entry for display
  const date = yearMonth + "-01";
  const amountUsdMag = amt * rate;
  const amountUsd = type === "expense" ? -amountUsdMag : amountUsdMag;
  const amountOriginal = type === "expense" ? -amt : amt;
  callApi(
    "addContribution",
    currentUser,
    { date, amountUsd, amountOriginal, currency: cur, note: note || "", type },
    sessionToken
  )
    .then(function (j) {
      if (j && j.ok) {
        loadContributions();
        onDone && onDone(null);
      } else onDone && onDone(j?.error || "genericError");
    })
    .catch(function () {
      onDone && onDone("connectionError");
    });
}

// Icon + i18n-label-key for every Activity type, used by the unified entry
// list below. Untyped legacy rows are treated exactly as they always were
// (income if amountUsd >= 0, else expense).
const ACTIVITY_DISPLAY = {
  salary: { icon: "💰", labelKey: "activityTypeSalary", color: "var(--wt-green)" },
  income: { icon: "▲", labelKey: "contribIncomeLabel", color: "var(--wt-green)" },
  deposit: { icon: "▲", labelKey: "activityTypeDeposit", color: "var(--wt-green)" },
  withdrawal: { icon: "▼", labelKey: "activityTypeWithdrawal", color: "var(--wt-red)" },
  expense: { icon: "▼", labelKey: "contribExpenseLabel", color: "var(--wt-red)" },
  buy: { icon: "🛒", labelKey: "activityTypeBuy", color: "var(--wt-text)" },
  sell: { icon: "💵", labelKey: "activityTypeSell", color: "var(--wt-text)" },
  transfer: { icon: "↔️", labelKey: "activityTypeTransfer", color: "var(--wt-text-dim)" },
  correction: { icon: "✎", labelKey: "activityTypeCorrection", color: "var(--wt-text-dim)" },
};
function activityDisplayFor(c) {
  const type = c.type || (parseFloat(c.amountUsd) >= 0 ? "income" : "expense");
  return ACTIVITY_DISPLAY[type] || ACTIVITY_DISPLAY.income;
}
// Resolves an itemId (stored on typed Activities) to a display name, falling
// back to the raw id if the item was later deleted/renamed — never hides
// the fact that an Activity references something, even if that something
// is gone.
function activityItemLabel(itemId) {
  if (!itemId) return "";
  const a = ASSETS.find((x) => x.id === itemId);
  return a ? assetName(a) : itemId;
}

// Undoes the qty change an Activity made to whichever item(s) it touched,
// the mirror image of applyQtyDelta() in activities.js. Deleting a logged
// Activity must never leave a balance it created behind — the log entry
// and the qty it caused are two views of the same fact and have to be
// deleted together.
//
// For salary/deposit/withdrawal/correction the original native delta is
// stored verbatim as amountOriginal, so reversal is exact. For
// transfer/buy/sell only one side's native delta is stored; the other
// side is recomputed from amountUsd at today's price, which is exact if
// prices haven't moved since and a close best-effort otherwise.
function reverseActivityQty(entry) {
  if (!entry || typeof entry !== "object") return; // legacy date-only delete: nothing to reverse
  const amt = parseFloat(entry.amountOriginal);
  if (entry.type === "transfer" && entry.fromItemId && entry.toItemId) {
    if (!isNaN(amt)) applyQtyDelta(entry.fromItemId, amt); // undo the -rawAmt taken from fromItemId
    const toAsset = ASSETS.find((a) => a.id === entry.toItemId);
    const toPrice = toAsset && priceFor(toAsset);
    const usdValue = parseFloat(entry.amountUsd) || 0;
    if (toPrice) applyQtyDelta(entry.toItemId, -(usdValue / toPrice));
  } else if ((entry.type === "buy" || entry.type === "sell") && entry.assetItemId && entry.fundingItemId) {
    if (!isNaN(amt)) applyQtyDelta(entry.fundingItemId, -amt); // undo the funding-side delta
    const assetItem = ASSETS.find((a) => a.id === entry.assetItemId);
    const assetPrice = assetItem && priceFor(assetItem);
    const usdValue = Math.abs(parseFloat(entry.amountUsd) || 0);
    if (assetPrice) {
      const assetNativeDelta = usdValue / assetPrice;
      applyQtyDelta(entry.assetItemId, entry.type === "buy" ? -assetNativeDelta : assetNativeDelta);
    }
  } else if (entry.itemId && !isNaN(amt)) {
    // salary / deposit / withdrawal / correction — single item, exact reversal
    applyQtyDelta(entry.itemId, -amt);
  }
}

function deleteContrib(entry) {
  // `entry` is either a legacy date string (old call sites) or a full
  // Activity object — pass its id when present so same-day typed Activities
  // don't clobber each other (see backend/routes/data.js DELETE /contributions).
  const isObj = entry && typeof entry === "object";
  const date = isObj ? entry.date : entry;
  const id = isObj ? entry.id : undefined;

  // Undo the balance change locally first (same pattern submitActivityInner
  // uses: qty mutation + scheduleSave), THEN delete the log entry — so a
  // failed/slow API call never leaves the log gone but the balance stuck.
  if (isObj) {
    reverseActivityQty(entry);
    updateTotals();
    scheduleSave();
    renderBreakdown();
  }

  callApi("deleteActivity", currentUser, id ? { date, id } : date, sessionToken)
    .then(function (j) {
      if (j && j.ok) loadContributions();
    })
    .catch(function (err) {
      console.error("deleteContrib:", err);
    });
}

// ── Render a single month card ──
// No inline per-cell editor anymore — adding always goes through
// openActivityModal() (docs/js/activities.js), the single intent-driven
// entry point. This card is purely a monthly summary + browsable log.
function renderMonthCard(year, m0) {
  const m1 = String(m0 + 1).padStart(2, "0");
  const yearMonth = year + "-" + m1;
  const { income, expense, net } = monthSummary(yearMonth);

  const isCurrentMonth = new Date().getFullYear() === year && new Date().getMonth() === m0;
  const netColor = net >= 0 ? "var(--wt-green)" : "var(--wt-red)";
  const netSign = net >= 0 ? "+" : "";
  const hasCashFlow = income > 0 || expense > 0;

  const borderStyle = isCurrentMonth ? "border:1.5px solid var(--wt-gold-dim)" : "border:1px solid var(--wt-line)";

  // Every Activity in this month, of any type — not just income/expense —
  // so nothing recorded is ever hidden from this screen.
  const monthEntries = (contributionsData || []).filter((c) => c.date.startsWith(yearMonth));

  const entryList =
    monthEntries.length > 0
      ? `
    <div style="margin-top:6px;border-top:1px solid var(--wt-line);padding-top:5px;display:flex;flex-direction:column;gap:2px">
      ${monthEntries
        .map((c) => {
          const disp = activityDisplayFor(c);
          const hasOriginal = c.currency && c.currency !== "USD" && typeof c.amountOriginal === "number";
          const amountLabel = hasOriginal
            ? `${fmtByCurrency(Math.abs(c.amountOriginal), c.currency)} <span style="opacity:0.6">(≈${fmtUsd(Math.abs(parseFloat(c.amountUsd) || 0))})</span>`
            : fmtUsd(Math.abs(parseFloat(c.amountUsd) || 0));
          // Typed activities show which item(s) they touched; legacy
          // income/expense entries have none.
          const itemBits = [activityItemLabel(c.itemId), activityItemLabel(c.fromItemId), activityItemLabel(c.toItemId), activityItemLabel(c.assetItemId)]
            .filter(Boolean)
            .join(" → ");
          return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;
                             color:var(--wt-text-dim);padding:1px 0;gap:4px">
          <span style="color:${disp.color};white-space:nowrap">
            ${disp.icon} ${t(disp.labelKey)} — ${amountLabel}
          </span>
          <span style="opacity:0.7;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(itemBits || c.note || "")}</span>
          <button onclick='deleteContrib(${JSON.stringify(c)})'
            style="background:none;border:none;cursor:pointer;color:var(--wt-red);
                   font-size:10px;padding:0 2px;line-height:1">×</button>
        </div>`;
        })
        .join("")}
    </div>`
      : `<p style="font-size:10px;color:var(--wt-text-dim);opacity:0.5;margin:4px 0 0">${t("activityNoneThisMonth")}</p>`;

  return `
    <div style="border-radius:var(--wt-radius);${borderStyle};
                background:rgba(255,255,255,0.02);padding:12px 12px 10px;
                display:flex;flex-direction:column;gap:4px;position:relative;
                min-height:100px;transition:border-color .2s">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:12px;font-weight:600;color:${isCurrentMonth ? "var(--wt-gold)" : "var(--wt-text)"}">
          ${monthLabel(m0)}
        </span>
        ${hasCashFlow ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${netColor}">${netSign}${fmtUsd(Math.abs(net))}</span>` : ""}
      </div>

      ${entryList}
    </div>`;
}

// ── Full-screen overlay ──
function renderContribModal() {
  const year = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => i);

  // Year-level totals
  const yearIncome = months.reduce((s, m) => s + monthSummary(year + "-" + String(m + 1).padStart(2, "0")).income, 0);
  const yearExpense = months.reduce((s, m) => s + monthSummary(year + "-" + String(m + 1).padStart(2, "0")).expense, 0);
  const yearNet = yearIncome - yearExpense;
  const netColor = yearNet >= 0 ? "var(--wt-green)" : "var(--wt-red)";

  return `
  <div class="wt-contrib-fullscreen">
    <div class="wt-contrib-fs-inner">

      <!-- header -->
      <div class="wt-contrib-fs-header">
        <div>
          <h2 style="margin:0;font-size:18px;font-weight:700">${year} — ${t("contribScreenTitle")}</h2>
          <p style="margin:4px 0 0;font-size:12px;color:var(--wt-text-dim)">${t("contribScreenHint")}</p>
        </div>
        <div style="display:flex;gap:24px;align-items:flex-end">
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--wt-text-dim);margin-bottom:2px">${t("contribTotalIncome")}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:var(--wt-green)">▲ ${fmtUsd(yearIncome)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--wt-text-dim);margin-bottom:2px">${t("contribTotalExpense")}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:var(--wt-red)">▼ ${fmtUsd(yearExpense)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--wt-text-dim);margin-bottom:2px">${t("contribTotalNet")}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:${netColor}">${yearNet >= 0 ? "+" : ""}${fmtUsd(yearNet)}</div>
          </div>
          <button class="wt-btn-ghost" style="align-self:center" onclick="closeContribModal()">✕ ${t("close")}</button>
        </div>
      </div>

      <!-- quick-add: intent-driven entry points, all opening the same tabbed modal -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${["salary", "deposit", "withdrawal", "buy", "sell", "transfer", "correction"]
          .map(
            (k) =>
              `<button class="wt-btn-ghost" onclick="openActivityModal('${k}')">${t("activityType" + k.charAt(0).toUpperCase() + k.slice(1))}</button>`
          )
          .join("")}
      </div>

      <!-- 4×3 grid -->
      <div class="wt-contrib-grid">
        ${months.map((m) => renderMonthCard(year, m)).join("")}
      </div>

      <p style="font-size:11px;color:var(--wt-text-dim);margin-top:12px;text-align:center">
        ${t("contribClickHint")}
      </p>
    </div>
  </div>`;
}
