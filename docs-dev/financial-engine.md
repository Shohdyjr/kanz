# Kanz financial engine

The single source of truth for every interest/return calculation in Kanz is
**`backend/lib/growthPipeline.js`**. It's used, unmodified, by:

- the backend nightly cron (`backend/cron/dailySnapshot.js`) — the only thing
  that actually changes a stored balance
- the table's projection columns (`docs/js/return-config.js`)
- the "what if" simulator (`docs/js/simulator.js`)
- the backend's save-time validation (`backend/routes/data.js`), which
  rejects a `growthFormula` that fails to parse

`docs/js/growth-pipeline.js` is a generated, byte-identical copy (GitHub
Pages only serves `docs/`, so the frontend needs a physical file — see
`scripts/sync-growth-pipeline.js`). **Never edit that copy directly.**

## Why one file, not one class per product

An earlier design explored a full Strategy Pattern (`FixedInterestStrategy`,
`SavingsAccountStrategy`, `NavBasedStrategy`, ... one class per product,
pluggable at runtime). That was deliberately not built here, for a concrete
reason specific to this project: the frontend has no build step or module
bundler — every file is a plain `<script>` tag loaded directly in the
browser (see `docs/index.html`). A class hierarchy would either need a
bundler (a much bigger change than the engine itself) or would have to be
hand-wired into the global scope the same way the current functions already
are, at which point it's the same architecture with more ceremony.

What this file uses instead is **branch-by-attribute**: `calcMethod`,
`compounding`, `payoutFreq`, and `rateBasis` are explicit fields on each
item's `returnConfig`, and `projectValueAt()` reads them to pick the right
formula. A new product type is a new _combination of existing attributes_,
not a new code path — see "Adding a new product" below.

## The four calculation models

| Model                                   | Triggered by                                                                                                          | Formula                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Periodic-boundary** ("Bank Engine")   | `startDate` + `payoutFreq` resolves to a months-step + `compounding: true`                                            | Simple interest per period (`principal × rate/100/365 × days`), folded into the balance only at each real payout boundary — e.g. Mashreq-style monthly savings |
| **Certificate** (flat, no reinvestment) | `compounding: false` (with `calcMethod: "fixedPrincipal"` as the explicit tiebreaker when there's no schedule at all) | Simple interest off the _original_ principal, never compounded — interest is paid out elsewhere                                                                |
| **Tiered certificate**                  | `startDate` + `tierRates` array                                                                                       | Compounds annually, switching to the next rate in the array at each anniversary                                                                                |
| **Daily compounding** (fallback)        | Everything else — `calcMethod: "dailyBalance"` / `"navBased"`, or no return category configured at all                | `principal × (1 + rate/100)^(days/365)` — e.g. Thndr                                                                                                           |

A `growthFormula` on any item overrides the per-segment interest formula
(not the period _structure_ — periodic-boundary items still fold in at their
real boundaries, just using the custom formula for each segment's amount).

## Table vs. simulator: `assumeContinuous`

Both call the exact same `projectValueAt()` — see `computeGrowthValueAt()`
in `return-config.js` and `simComputeGrowthValueAt()` in `simulator.js`, both
thin wrappers with zero duplicated math. They differ in exactly one boolean
flag, `assumeContinuous`, because they answer two genuinely different
questions:

- **Table** (`assumeContinuous: true`): "what is my _real_ balance, which
  has genuinely existed since the item's real Since-date, worth right now?"
  The currently-open period is credited in full from its true start — the
  cron never touches `qty` mid-period, so days already elapsed this period
  are real, un-posted interest, not zero.
- **Simulator** (`assumeContinuous` omitted/false): "what would a
  _hypothetical_ amount, starting at a date I'm typing in right now, be
  worth?" That money cannot have earned interest before the date I said it
  started existing — even if the real item's Since-date implies an earlier
  period start. Period boundaries (which day of the month a period folds on)
  are anchored to the simulator's own chosen start date too, not the real
  item's Since-date — the simulator is fully self-contained.

See the comments directly above `periodicBoundaryValueAt()` and
`projectValueAt()` in `growthPipeline.js` for the exact mechanics.

## Day counting & timezones

`daysBetweenDates()` subtracts two `Date` objects that are always
constructed at **local midnight** (`parseDateStr` → `new Date(y, m-1, d)`,
never `toISOString()`/UTC) and rounds to the nearest whole day. This was
specifically verified against Egypt's real 2026 DST transitions (Apr 24
spring-forward, Oct 30 fall-back — Egypt reinstated DST in 2023): a span
crossing either transition is off by at most 1 hour in raw milliseconds,
which `Math.round()` correctly absorbs back to the exact calendar-day count.
See `backend/test/growthPipeline.test.js` for the regression tests (run
under `TZ=Africa/Cairo` — see `npm test` in `backend/package.json`).

The backend cron independently derives "today" via
`new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" })`
(`dailySnapshot.js`), so it always operates on Cairo's calendar date
regardless of the server process's own timezone (Vercel's Node runtime is
UTC) — no manual timezone conversion needed anywhere else.

**Day-count convention**: every formula here is Actual/365 (real elapsed
days ÷ 365), which is what every product actually configured in this app
(Egyptian bank savings/certificates, Thndr) uses in practice. Other
conventions (Actual/360, 30/360, Actual/Actual) are a real thing for bonds
and some corporate lending products, but nothing in this app's product list
uses them — adding a switchable day-count-convention framework for
conventions no configured product needs would be speculative complexity
with no current payoff. If a real product using one is ever added, the
convention only needs to change one thing: the `/365` divisor inside
`segmentInterest()`/the daily-compounding fallback — everything else
(period boundaries, tiered certificates, validation) is convention-agnostic
already.

## Safe custom formulas

`growthFormula` used to run through `new Function(...)` — arbitrary JS code
execution. It's now a small recursive-descent parser
(`tokenizeFormula`/`parseFormulaAst`/`evalFormulaAst` in
`growthPipeline.js`): only numbers, `+ - * / ^ ( )`, the variables
`principal`/`rate`/`days`, and a short whitelist of math functions
(`pow`, `min`, `max`, `sqrt`, `abs`). No code execution is possible even in
principle — see the "cannot execute arbitrary JS" test in
`growthPipeline.test.js`. `backend/routes/data.js` now also rejects an
unparseable formula at save time, instead of silently falling back to the
default the first time it's used.

## Validation

`backend/routes/data.js` (`isValidReturnConfigMap`/`isValidApyMap`) already
rejects: negative/NaN/Infinity APY, out-of-range APY (>100%), unknown enum
values, prototype-pollution keys, and oversized formula strings. Two gaps
were closed:

- `startDate` is now checked against the real calendar (`2026-02-30` used to
  pass the `YYYY-MM-DD` regex and would have silently rolled over to March 2
  via `Date`'s auto-normalization).
- `growthFormula` is now parsed at save time (see above) instead of only at
  first use.

## Decimal precision

Money is stored and calculated as plain JS `number`s, not an arbitrary-
precision decimal type. This is a deliberate choice, not an oversight: this
is a single-user personal tracker with balances in the thousands-to-low-
millions of EGP/USD, and JS doubles carry ~15-17 significant decimal
digits — far more precision than a single sub-cent rounding difference could
meaningfully affect at these magnitudes over the lifetime of the app.
Introducing a decimal library (e.g. `decimal.js`) would touch every
call site that reads/writes `qty`/`apy`/history (both backend and frontend,
since they'd need the same library loaded in both places) for a precision
class this app's numbers don't need. Display values are already rounded via
`fmtByCurrencyPrecise`/`toLocaleString`, which is the layer where rounding
actually matters for a personal finance tracker. This should be revisited if
Kanz ever moves to multi-user/shared money (where accumulated cent-level
drift across many accounts and years actually compounds into something
visible).

## Adding a new product

1. Does it fit one of the four models above via `calcMethod` +
   `compounding` + `payoutFreq` + `rateBasis`? Most Egyptian bank/fund
   products do — add it as a **preset** in `RETURN_PRESETS`
   (`docs/js/return-config.js`) with the right attribute combination, and
   optionally a productType default in `PRODUCT_TYPE_DEFAULTS`. No engine
   code changes needed.
2. Does it need a genuinely different _formula_ but fits an existing period
   structure? Use `growthFormula` on the item — no code change.
3. Does it need a real new calculation model the four above can't express?
   Add a new branch to `projectValueAt()` in `growthPipeline.js` (the one
   place it needs to exist) and a matching branch in `dailyGrowthDelta()`
   if the cron needs to auto-post it — then run
   `npm run sync-pipeline && npm test`.

## Known, accepted limitations

- `rateType: "variable"` is descriptive/UI-only — there's no rate-history
  tracking (no "18% until March, then 20%"), so a variable rate is just
  whatever's currently in `apy`. The user is expected to enter a
  representative/averaged value (this was an explicit decision, not a gap
  to silently fix — see project history).
- `navBased` (money-market/fund NAV pricing) has no real NAV data feed and
  falls back to daily-compounding the last entered rate — explicitly marked
  as an estimate in the UI (the "≈" prefix and tooltip on projection cells,
  driven by `calcMethod === "navBased"`), never presented as a guaranteed
  return.
- `lowestMonthlyBalance` assumes the balance isn't withdrawn from mid-period
  (an explicit simplifying assumption from the project owner, not a
  tracked-daily-balance implementation).
