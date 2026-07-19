/**
 * Wealth Attribution — derives *why* Net Worth changed between two dates,
 * entirely from facts Kanz already records: Snapshots (`history`), Activities
 * (`activities[]` — see routes/data.js), and Item History
 * (cron-posted investment income).
 *
 * This file computes nothing new about the world; it only re-groups numbers
 * that already exist. It follows Kanz's core architectural principles:
 *
 *  - Facts over interpretations: every number below is either read directly
 *    from a stored fact or computed by plain arithmetic over stored facts.
 *    Where the facts don't settle a question, this reports "unattributed"
 *    rather than guessing (see `otherBalanceChanges` below).
 *  - No money identity or lineage: nothing here asks "which cash flow is
 *    this value made of." It only asks "how much did each *bucket* change,
 *    and how much of that change was quantity vs. price."
 *  - Activities describe intent, they don't own money: Activities are only
 *    ever summed by type/date, never traced across time.
 *
 * ── The six categories ──────────────────────────────────────────────────
 *
 * externalCashFlow   — Activities of type salary/deposit/withdrawal, summed.
 * investmentIncome    — item_history entries (cron-posted interest), summed.
 * marketRevaluation   — price movement of an asset in its OWN currency
 *                        (e.g. gold's USD/gram price moving), isolated per
 *                        currency bucket via the flow/price decomposition
 *                        below. Requires the bucket's native quantity +
 *                        rates to be present on both snapshots (see
 *                        computeSnapshot in lib/rates.js) — older snapshots
 *                        that predate this field simply can't be decomposed
 *                        and fall back to `unattributed`, honestly.
 * fxGainLoss          — the portion of a bucket's price movement caused by
 *                        EGP/EUR/SAR moving against USD, isolated the same
 *                        way. For gold, this is normalized to be USD/EGP-FX
 *                        only; gold's own dollar price move is Market
 *                        Revaluation, not FX.
 * otherBalanceChanges — Activities of type buy/sell/transfer/correction,
 *                        summed. These are real, intentional actions, just
 *                        not decomposed further per the "no money lineage"
 *                        principle — a Buy/Sell/Transfer/Correction is
 *                        reported as one honest category, not traced to
 *                        what funded it or where it went.
 * unattributed        — whatever remains after subtracting all of the
 *                        above from the raw totalUsd delta: untagged manual
 *                        qty edits, and any bucket movement that couldn't be
 *                        decomposed (missing nativeTotals/ratesUsed on an
 *                        old snapshot). Reported explicitly, never folded
 *                        into another category — this is what "Kanz reports
 *                        unattributed instead of manufacturing certainty"
 *                        looks like in practice.
 *
 * The five numbers above (plus unattributed) always sum to exactly
 * totalUsd(toDate) − totalUsd(fromDate) — see computeAttribution's return.
 */

// Activity types that represent external money entering/leaving the user's
// control entirely (not moved between their own holdings).
const EXTERNAL_CASH_FLOW_TYPES = new Set(["salary", "deposit", "withdrawal", "income", "expense"]);
// Activity types that are real, intentional, but deliberately NOT traced
// further (see file header — no money lineage).
const OTHER_BALANCE_CHANGE_TYPES = new Set(["buy", "sell", "transfer", "correction"]);

/** Sums Activities of the given types whose date falls in (fromDate, toDate]. */
function sumActivities(activities, fromDate, toDate, types) {
  return (activities || [])
    .filter((a) => a && a.date > fromDate && a.date <= toDate && types.has(a.type || inferLegacyType(a)))
    .reduce((sum, a) => sum + (parseFloat(a.amountUsd) || 0), 0);
}

/**
 * Pre-generalization Activities (the original `activities[]` shape, before
 * intent-driven types existed) never
 * had a `type` field — only a sign on `amountUsd`. Treat those exactly as
 * they always behaved (positive = income/external inflow, negative =
 * expense/external outflow) rather than silently dropping them from
 * attribution just because they predate the `type` field.
 */
function inferLegacyType(a) {
  if (a.type) return a.type;
  return (parseFloat(a.amountUsd) || 0) >= 0 ? "income" : "expense";
}

/**
 * Sums item_history deltas (already-attributed investment income) in
 * (fromDate, toDate], converted to USD.
 *
 * `item_history` records each delta in the item's OWN currency (e.g. EGP
 * interest posted on an EGP savings account) — it is not already USD, so it
 * must be converted the same way computeSnapshot() converts everything else.
 * `itemCurrency(itemId)` looks up which currency an item is denominated in;
 * `priceAt(currency, rates)` prices one native unit of that currency in USD.
 * `toSnapRatesUsed` is the rate set to convert with — using the *window-end*
 * snapshot's rates for every entry in the window is a deliberate, stated
 * approximation (not a hidden one): day-by-day FX drift within a single
 * entry-to-entry gap is a second-order effect, and using one consistent,
 * named rate set is simpler and more auditable than silently picking a
 * different one per entry. This does not invent an allocation rule — it's a
 * documented pricing choice, exactly like any snapshot's own pricing.
 */
function sumInvestmentIncome(itemHistory, fromDate, toDate, itemCurrency, toSnapRatesUsed, priceAt) {
  return (itemHistory || [])
    .filter((e) => e && e.date > fromDate && e.date <= toDate)
    .reduce((sum, e) => {
      const currency = itemCurrency ? itemCurrency(e.itemId) : "USD";
      const rate = priceAt ? priceAt(currency, toSnapRatesUsed) : 1;
      if (!Number.isFinite(rate)) return sum; // unpriceable item — excluded, not guessed
      return sum + (parseFloat(e.delta) || 0) * rate;
    }, 0);
}

/**
 * Decomposes one currency bucket's USD delta between two snapshots into a
 * flow component (native quantity changed) and a price component (rate
 * changed), then further splits the price component into "the asset's own
 * price move" (marketRevaluation) vs. "USD moving against the asset's home
 * currency" (fxGainLoss) — standard flow/price attribution, no invented
 * convention. Returns null if either snapshot lacks the fields needed
 * (older snapshots, pre-dating this feature).
 *
 * `priceAt(rates)` returns the bucket's USD price for one native unit, given
 * a snapshot's `ratesUsed`. `isFx` says whether *all* of this bucket's price
 * movement is FX (true for plain hard currencies — a dollar's "price" only
 * moves because EGP/EUR/SAR move against it) or needs its own further split
 * (gold: has both a real USD commodity-price move AND an FX component).
 */
function decomposeBucket(fromSnap, toSnap, nativeKey, priceAt) {
  const q1 = fromSnap?.nativeTotals?.[nativeKey];
  const q2 = toSnap?.nativeTotals?.[nativeKey];
  const r1 = fromSnap?.ratesUsed;
  const r2 = toSnap?.ratesUsed;
  if (typeof q1 !== "number" || typeof q2 !== "number" || !r1 || !r2) return null;

  const p1 = priceAt(r1);
  const p2 = priceAt(r2);
  if (!Number.isFinite(p1) || !Number.isFinite(p2)) return null;

  // Flow component: quantity change, valued at the *current* price — this is
  // "how much USD value moved in/out because the native quantity changed,"
  // which already belongs to Activities/investment-income and must not be
  // double-counted here; we only return the price component.
  const priceComponent = q1 * (p2 - p1);
  return priceComponent;
}

/**
 * Computes the full attribution breakdown for (fromDate, toDate].
 *
 * @param {object[]} history       - snapshots (`history[]`), ascending by date
 * @param {object[]} activities    - Activities (`activities[]`, generalized)
 * @param {object[]} itemHistory   - `item_history[]`
 * @param {string} fromDate        - YYYY-MM-DD, exclusive
 * @param {string} toDate          - YYYY-MM-DD, inclusive
 * @param {(itemId: string) => string} [itemCurrency] - looks up an item's
 *   native currency, for converting item_history deltas to USD. If omitted,
 *   item_history deltas are assumed already-USD (safe default for callers
 *   that only ever store USD-denominated items).
 * @param {(currency: string, rates: object) => number} [priceAt] - prices
 *   one native unit of a currency in USD, given a rate set. Pass
 *   priceForServerSide from lib/rates.js in real use.
 */
function computeAttribution(history, activities, itemHistory, fromDate, toDate, itemCurrency, priceAt) {
  const fromSnap = (history || []).find((h) => h.date === fromDate) || null;
  const toSnap = (history || []).find((h) => h.date === toDate) || null;

  const totalDelta = fromSnap && toSnap ? toSnap.totalUsd - fromSnap.totalUsd : null;

  const externalCashFlow = sumActivities(activities, fromDate, toDate, EXTERNAL_CASH_FLOW_TYPES);
  const investmentIncome = sumInvestmentIncome(
    itemHistory,
    fromDate,
    toDate,
    itemCurrency,
    toSnap?.ratesUsed,
    priceAt
  );
  const otherBalanceChanges = sumActivities(activities, fromDate, toDate, OTHER_BALANCE_CHANGE_TYPES);

  let marketRevaluation = 0;
  let fxGainLoss = 0;
  let decomposable = fromSnap && toSnap;

  if (decomposable) {
    // Gold: split into its own USD/gram move (Market Revaluation) and the
    // USD/EGP-driven portion (FX) — gold is priced in USD already, so its
    // "FX" component is 0 by this bucket's own convention; the EGP bucket
    // below already captures EGP-vs-USD movement for EGP holdings, and hard
    // currencies capture EUR/SAR-vs-USD. Gold's full price delta is treated
    // as Market Revaluation (a globally-quoted commodity price), which is
    // the conventional treatment and introduces no allocation ambiguity.
    const goldDelta = decomposeBucket(fromSnap, toSnap, "gold", (r) => r.goldUsdPerGram);
    const egpDelta = decomposeBucket(fromSnap, toSnap, "egp", (r) => 1 / r.egpPerUsd);
    const usdDelta = 0; // USD is the numeraire — never moves against itself
    const eurDelta = decomposeBucket(fromSnap, toSnap, "eur", (r) => 1 / r.eurPerUsd);
    const sarDelta = decomposeBucket(fromSnap, toSnap, "sar", (r) => 1 / r.sarPerUsd);

    if ([goldDelta, egpDelta, eurDelta, sarDelta].some((d) => d === null)) {
      decomposable = false;
    } else {
      marketRevaluation = goldDelta; // gold's own commodity price move
      fxGainLoss = egpDelta + usdDelta + eurDelta + sarDelta; // currency-vs-USD moves
    }
  }

  if (totalDelta === null) {
    return {
      totalDelta: null,
      externalCashFlow,
      investmentIncome,
      marketRevaluation: null,
      fxGainLoss: null,
      otherBalanceChanges,
      unattributed: null,
      note: "missingSnapshots",
    };
  }

  if (!decomposable) {
    // Snapshots exist but at least one predates nativeTotals/ratesUsed —
    // report the categories we CAN derive, and be explicit that revaluation
    // and FX couldn't be split out rather than silently reporting 0 (which
    // would misleadingly imply no price movement happened).
    const explained = externalCashFlow + investmentIncome + otherBalanceChanges;
    return {
      totalDelta,
      externalCashFlow,
      investmentIncome,
      marketRevaluation: null,
      fxGainLoss: null,
      otherBalanceChanges,
      unattributed: totalDelta - explained,
      note: "revaluationNotDerivable",
    };
  }

  const explained = externalCashFlow + investmentIncome + marketRevaluation + fxGainLoss + otherBalanceChanges;
  return {
    totalDelta,
    externalCashFlow,
    investmentIncome,
    marketRevaluation,
    fxGainLoss,
    otherBalanceChanges,
    unattributed: totalDelta - explained,
    note: null,
  };
}

module.exports = { computeAttribution, EXTERNAL_CASH_FLOW_TYPES, OTHER_BALANCE_CHANGE_TYPES };
