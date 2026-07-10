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
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok && Array.isArray(j.contributions)) {
        contributionsData = j.contributions.sort((a, b) => a.date.localeCompare(b.date));
      }
      render();
    })
    .withFailureHandler(function (err) {
      console.error("loadContributions:", err);
    })
    .loadContributionsForClient(currentUser, sessionToken);
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
    if (c.type === "income" || (!c.type && amt > 0)) income += Math.abs(amt);
    else if (c.type === "expense" || (!c.type && amt < 0)) expense += Math.abs(amt);
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
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        loadContributions();
        onDone && onDone(null);
      } else onDone && onDone(j?.error || "genericError");
    })
    .withFailureHandler(function () {
      onDone && onDone("connectionError");
    })
    .addContribution(
      currentUser,
      { date, amountUsd, amountOriginal, currency: cur, note: note || "", type },
      sessionToken
    );
}

function deleteContrib(date) {
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) loadContributions();
    })
    .withFailureHandler(function (err) {
      console.error("deleteContrib:", err);
    })
    .deleteContribution(currentUser, date, sessionToken);
}

// ── Per-cell inline editor ──
// We keep a tiny piece of ephemeral state in a global so the full render()
// cycle can show an expanded input row inside the right cell.
let _editingCell = null; // "YYYY-MM:income" | "YYYY-MM:expense" | null
let _editErr = null;
// Remembers the last currency picked in the cell editor for the rest of the
// session, so choosing "EGP" once doesn't mean re-picking it on every entry.
let _editCurrency = "EGP";

function openCellEditor(yearMonth, type) {
  _editingCell = yearMonth + ":" + type;
  _editErr = null;
  render();
  setTimeout(() => {
    const el = document.getElementById("contrib-cell-input");
    if (el) el.focus();
  }, 40);
}

function closeCellEditor() {
  _editingCell = null;
  _editErr = null;
  render();
}

function submitCellEntry(ev, yearMonth, type) {
  ev.preventDefault();
  const inp = document.getElementById("contrib-cell-input");
  const noteInp = document.getElementById("contrib-cell-note");
  const curInp = document.getElementById("contrib-cell-currency");
  const amt = inp ? inp.value : "";
  const note = noteInp ? noteInp.value : "";
  const currency = curInp ? curInp.value : _editCurrency;
  _editCurrency = currency; // remember for next time
  saveContribEntry(yearMonth, type, amt, currency, note, function (err) {
    if (err) {
      _editErr = err;
      render();
    } else {
      _editingCell = null;
      _editErr = null;
    }
  });
}

// ── Render a single month card ──
function renderMonthCard(year, m0) {
  const m1 = String(m0 + 1).padStart(2, "0");
  const yearMonth = year + "-" + m1;
  const { income, expense, net } = monthSummary(yearMonth);

  const isCurrentMonth = new Date().getFullYear() === year && new Date().getMonth() === m0;
  const netColor = net >= 0 ? "var(--wt-green)" : "var(--wt-red)";
  const netSign = net >= 0 ? "+" : "";
  const hasData = income > 0 || expense > 0;

  const borderStyle = isCurrentMonth ? "border:1.5px solid var(--wt-gold-dim)" : "border:1px solid var(--wt-line)";

  // Entries for this month (for the per-entry delete list)
  const monthEntries = (contributionsData || []).filter((c) => c.date.startsWith(yearMonth));

  const editingIncome = _editingCell === yearMonth + ":income";
  const editingExpense = _editingCell === yearMonth + ":expense";

  function rowHTML(type, amount, color, icon, labelKey) {
    const editing = _editingCell === yearMonth + ":" + type;
    const amtDisplay =
      amount > 0
        ? `<span style="color:${color};font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600">${icon}${fmtUsd(amount)}</span>`
        : `<span style="color:var(--wt-text-dim);font-size:10px;opacity:0.5">${t(labelKey)}</span>`;

    if (editing) {
      return `
        <form onsubmit="submitCellEntry(event,'${yearMonth}','${type}')" style="margin:4px 0">
          <div style="display:flex;gap:4px;align-items:center">
            <input id="contrib-cell-input" type="number" step="any" min="0"
              placeholder="0.00" dir="ltr"
              style="width:64px;padding:3px 6px;border-radius:6px;
                     border:1px solid var(--wt-line-strong);background:var(--wt-bg);
                     color:var(--wt-text);font-size:12px;font-family:'JetBrains Mono',monospace">
            <select id="contrib-cell-currency" dir="ltr"
              style="padding:3px 4px;border-radius:6px;border:1px solid var(--wt-line-strong);
                     background:var(--wt-bg);color:var(--wt-text);font-size:11px">
              ${CONTRIB_CURRENCIES.map((c) => `<option value="${c}" ${c === _editCurrency ? "selected" : ""}>${c}</option>`).join("")}
            </select>
            <button type="submit" class="wt-btn" style="padding:2px 8px;font-size:11px">${t("add")}</button>
            <button type="button" class="wt-btn-ghost" style="padding:2px 6px;font-size:11px" onclick="closeCellEditor()">✕</button>
          </div>
          <input id="contrib-cell-note" type="text" maxlength="100"
            placeholder="${t("contribNotePh")}"
            style="margin-top:3px;width:100%;padding:2px 6px;border-radius:5px;
                   border:1px solid var(--wt-line);background:var(--wt-bg);
                   color:var(--wt-text);font-size:10px">
          ${_editErr ? `<p style="color:var(--wt-red);font-size:10px;margin:2px 0 0">${t(_editErr) || _editErr}</p>` : ""}
        </form>`;
    }
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;
                  padding:2px 0;border-radius:4px"
           onclick="openCellEditor('${yearMonth}','${type}')">
        ${amtDisplay}
        <span style="font-size:10px;color:var(--wt-text-dim);opacity:0.6;padding-left:4px">+</span>
      </div>`;
  }

  // Compact entry list (for deleting old entries)
  const entryList =
    monthEntries.length > 0
      ? `
    <div style="margin-top:6px;border-top:1px solid var(--wt-line);padding-top:5px">
      ${monthEntries
        .map((c) => {
          const pos = (parseFloat(c.amountUsd) || 0) >= 0;
          // Legacy entries (saved before the currency field existed) have no
          // `currency`/`amountOriginal` — those just fall back to the USD
          // figure exactly like before this feature was added.
          const hasOriginal = c.currency && c.currency !== "USD" && typeof c.amountOriginal === "number";
          const amountLabel = hasOriginal
            ? `${fmtByCurrency(Math.abs(c.amountOriginal), c.currency)} <span style="opacity:0.6">(≈${fmtUsd(Math.abs(parseFloat(c.amountUsd) || 0))})</span>`
            : fmtUsd(Math.abs(parseFloat(c.amountUsd) || 0));
          return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;
                             color:var(--wt-text-dim);padding:1px 0">
          <span style="color:${pos ? "var(--wt-green)" : "var(--wt-red)"}">
            ${pos ? "▲" : "▼"} ${amountLabel}
          </span>
          ${c.note ? `<span style="opacity:0.7;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.note)}</span>` : ""}
          <button onclick="deleteContrib('${esc(c.date)}')"
            style="background:none;border:none;cursor:pointer;color:var(--wt-red);
                   font-size:10px;padding:0 2px;line-height:1">×</button>
        </div>`;
        })
        .join("")}
    </div>`
      : "";

  return `
    <div style="border-radius:var(--wt-radius);${borderStyle};
                background:rgba(255,255,255,0.02);padding:12px 12px 10px;
                display:flex;flex-direction:column;gap:4px;position:relative;
                min-height:100px;transition:border-color .2s">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:12px;font-weight:600;color:${isCurrentMonth ? "var(--wt-gold)" : "var(--wt-text)"}">
          ${monthLabel(m0)}
        </span>
        ${hasData ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${netColor}">${netSign}${fmtUsd(Math.abs(net))}</span>` : ""}
      </div>

      ${rowHTML("income", income, "var(--wt-green)", "▲ ", "contribIncomeLabel")}
      ${rowHTML("expense", expense, "var(--wt-red)", "▼ ", "contribExpenseLabel")}

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
