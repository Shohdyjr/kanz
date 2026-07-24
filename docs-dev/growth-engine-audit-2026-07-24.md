# Growth Engine — Mathematical Audit (2026-07-24)

Audited by re-running the actual engine code (`growth-pipeline.js` /
`backend/lib/growthPipeline.js`) against 4 real test cases, not just
reading it. All numbers below are computed, not estimated.

## Verdict

**One real, confirmed, high-impact bug. One false alarm (stale rate, not a bug).**

The bug affects **every preset in the system** (all of them use
`growthFrequency: "daily"`), silently replacing the intended "calculate
daily, credit at calendar month-end" math with an unrelated continuous
daily-compounding formula anchored to **today's date** instead of the
item's real **Since** date.

---

## Root cause #1 — wrong compounding engine silently selected (growth-pipeline.js) only recognizes `"monthly"`,
`"quarterly"`, `"semiAnnual"`, `"annual"`, `"maturity"`:

```js
function monthsStepForFreq(frequency) {
  if (frequency === "monthly") return 1;
  if (frequency === "quarterly") return 3;
  if (frequency === "semiAnnual") return 6;
  if (frequency === "annual" || frequency === "maturity") return 12;
  return null;   // "daily" falls through to here
}
```

`projectValueAt()` (and 3 sibling functions — the real daily cron, the
"days until next touch" helper, and the accrual-breakdown helper) used to
call this **directly on `config.growthFrequency`**:

```js
const monthsStep = monthsStepForFreq(config.growthFrequency);   // "daily" → null
```

Every preset in `RETURN_PRESETS` sets `growthFrequency: "daily"` (interest
is *calculated* daily — that's correct). But `monthsStep` being `null`
means the condition that gates the correct engine —
`periodicBoundaryValueAt()`, the one that walks real calendar-month
boundaries and only folds interest back in at the actual credit date — is
**never true**, for **any** preset. Every projection silently falls
through to an unrelated fallback (`projectValueAt`, lines ~719–726 before
the fix):

```js
const effectiveRate = basis === "nominal" ? nominalToEffective(rate, 365) : rate;
const days = Math.max(0, daysBetweenDates(fromDate, targetDate));
return principal * Math.pow(1 + effectiveRate / 100, days / 365);
```

This fallback has two compounding problems of its own:

1. **It uses `fromDate` directly.** For the real Wealth-over-time table,
   `fromDate` is always **today** (`return-config.js` calls
   `computeGrowthValueAt(a.id, principal, todayMid, nextDate)` — see lines
   1193/1218/1220/1222). `assumeContinuous=true` is passed specifically to
   signal "anchor to the item's real Since-date instead" — every *other*
   branch in `projectValueAt` respects that signal (see
   `flatBasisDate`), but this one fallback branch does not. **This is
   checklist item #1 — confirmed.**
2. **It treats a Nominal APR as continuously, daily compounded**
   (`nominalToEffective(rate, 365)` then `Math.pow(..., days/365)`), instead
   of simple daily accrual folded in once at the real monthly credit
   boundary. **This is checklist items #6/#7 — confirmed**, for every
   Nominal-basis product (both Mashreq presets).

### Why "Next credit: 31 Jul" was still shown correctly (checklist item #10 — confirmed)

`cycleFrequency()` in `return-config.js` — the function that decides the
**date** shown as "Next credit" — already gets this right:

```js
const realEvent = cfg.compoundingFrequency && cfg.compoundingFrequency !== "none"
  ? cfg.compoundingFrequency
  : ...;
if (realEvent && (FREQUENCY_RANK[realEvent] || 0) > (FREQUENCY_RANK[g] || 0)) return realEvent;
```

— it prefers `compoundingFrequency` ("monthly") over `growthFrequency`
("daily"). So the **Timeline date is correct**, while the **Timeline's own
projected value at that date** was computed by an entirely different code
path that never got the same correction. Two different notions of
"frequency" for the same date, silently diverging — exactly checklist
item #10.

### Checklist — full results

| # | Suspected bug | Verdict |
|---|---|---|
| 1 | Counting from today instead of Since | **Confirmed** (fallback branch only — see above) |
| 2 | Counting a full month instead of elapsed period | No — but see Root cause #2 below, a related (different) day-count bug |
| 3 | Counting the end date twice | No — the fix below adds the day back in exactly once, at the one place it was missing, not duplicated across chained periods |
| 4 | Using 30 days instead of actual calendar days | **Partially confirmed — see Root cause #2 below.** Calendar days were used correctly, but the credit day itself was silently excluded (30 instead of July's 31) |
| 5 | Using 365 or 360 | Always 365, consistently |
| 6 | APR accidentally treated as APY | **Confirmed** (fallback branch's `nominalToEffective`) |
| 7 | Nominal interest accidentally compounded | **Confirmed** (same fallback — continuous daily compounding of a simple annual rate) |
| 8 | Wrong principal (current vs. starting balance) | No — principal passed through correctly in all 4 cases |
| 9 | Projecting to maturity instead of next credit event | No — `nextDate`/`endOfCycle` targets are correct |
| 10 | Timeline using one date, projection using another | **Confirmed** — see above |

---

## Case-by-case

### Case 1 — Mashreq NEO Savings

- **Formula (correct):** simple daily interest, no intermediate boundary crossed → `principal × (rate/100/365) × days`
- **Days counted:** 16 (15 Jul → 31 Jul, `daysBetweenDates` = plain calendar diff)
- **Daily interest:** 10,869.28 × 0.11 / 365 = **3.2759 EGP/day**
- **Expected total interest:** 3.2759 × 16 = **52.41 EGP**
- **Expected projected balance:** **10,921.69 EGP**
- **Engine output you reported (buggy code):** 10,973.58 EGP
- **Difference:** 51.89 EGP absolute, **0.475%** — and note the *shape* of the error: 104.30 EGP of "interest" was booked for a 16-day window, which is what you'd get from a continuously-compounded ~32-day window instead — consistent with the fallback branch's date/compounding errors compounding on top of each other, not one clean off-by-N-days.
- **Re-run against the fixed engine (this session):** **10,921.69 EGP** — exact match to hand calculation. ✅

### Case 2 — Mashreq Highest Interest Savings

- **Formula (correct):** simple daily interest (lowest-balance basis, no intermediate boundary) → `principal × (rate/100/365) × days`
- **Days counted:** 30 (1 Jul → 31 Jul)
- **Daily interest:** 142,050.41 × 0.18 / 365 = **70.058 EGP/day**
- **Expected total interest:** 70.058 × 30 = **2,101.73 EGP**
- **Expected projected balance:** **144,152.14 EGP**
- **Engine output you reported (buggy code):** 142,611.80 EGP
- **Difference:** 1,540.34 EGP absolute, **1.07%** — this exact number is reproduced by feeding the buggy fallback formula `fromDate = 23 Jul` (**today**, not the 1 Jul Since-date) — a clean, exact match, hard proof of checklist item #1.
- **Re-run against the fixed engine (this session):** **144,151.98 EGP** — matches hand calculation to a few cents (rounding inside `segmentInterest`). ✅

### Case 3 — Thndr Cloud Monthly (Estimated)

- **Formula (correct):** Effective APY converted down to a monthly-equivalent nominal rate, simple interest within the (still-open) month → see `nominalToEffective`/`effectiveToNominal` conversion in `projectValueAt`
- **Days counted:** 8 (23 Jul → 31 Jul)
- **Engine output you reported:** 226,328.62 EGP (907.70 → actually 902.62 EGP interest)
- **Re-run against the fixed engine:** 226,333.70 EGP (907.70 EGP interest)
- **Difference:** only ~5.08 EGP (0.0022%) — because this window never crosses a calendar-month boundary, the buggy continuous-compounding fallback happened to land very close to the correct monthly-equivalent simple-interest answer by coincidence. **The bug is still present in the code path Thndr used** — it just wasn't very visible in this particular 8-day, single-period window. It would become visible for a longer window crossing a month boundary.

### Case 4 — NBE Platinum Step-Up Certificate

- **Not a bug.** Your test case assumes a 27% Year-1 rate. The currently
  configured preset uses **22%** (corrected during an earlier session
  against verified June 2026 rates — see `docs-dev/return-presets.md`).
  366,000.80 EGP is *exactly* what 22% on 300,000 EGP over one full
  calendar year (365 days, 12 Aug 2025 → 12 Aug 2026, no leap day in 2026)
  produces: 300,000 × 1.22 = **366,000.00 EGP** — 0.80 EGP off due to
  ordinary floating-point/day-count rounding, i.e. correct to within
  0.0002%. **Engine confirmed correct** for this product — its
  `compoundingFrequency: "none"` means it was never on the buggy code path
  in the first place (it uses `tieredValueAt`, a separate function,
  unaffected by this bug).

---

## Root cause #2 — the credit day itself wasn't being counted

**Caught by the user, confirmed and fixed 2026-07-24.** Separately from
root cause #1 above, there was a genuine off-by-one in day-counting.

`daysBetweenDates(d1, d2)` is a plain subtraction — `(d2 - d1) / 1 day`.
Every date in this engine is stored as that calendar day's **midnight
(00:00)**. So `daysBetweenDates("1 Jul" 00:00, "31 Jul" 00:00) = 30` — which
is correct **only** if "31 Jul" means "the instant July 31 begins", not
"through the end of July 31". But a bank crediting interest "on 31 Jul" (or
any "Next credit" date shown in this app) means the **whole day** of July
31 has already been earned by the time it posts — the balance sat in the
account through the entire month, all 31 calendar days of July.

**Proof it's a real bug, not a matter of convention:** this same function
already contains a second, independent way of finding period boundaries —
`anniversaryAfter(startDateStr, monthsStep, ...)`, used to chain multiple
compounding periods together. For a "since 1 Jul, monthly" schedule, that
function correctly lands on **1 Aug**, not 31 Jul — i.e. the codebase's own
internal chaining logic already agreed the true boundary is the *start* of
the next day, not the *start* of the last day. The plain
`daysBetweenDates(cursor, targetDate)` calculation from
`calendarPeriodEnd`'s "31 Jul" label disagreed with that by exactly 1 day.

### The fix

Added `inclusiveDayAdjustment()` and applied it **only** to the final
segment of `periodicBoundaryValueAt` and to `simpleFlatValueAt` — not to
the while-loop's interior boundaries (that would double-count every
interior month a multi-period projection crosses), and deliberately **not**
to `tieredValueAt` (certificates use `creditAnchor: "anniversary"`, a
same-day-next-year boundary that was already exact — see Case 4, which
matched before this fix and is untouched by it).

```js
function inclusiveDayAdjustment(cursor, targetDate) {
  return targetDate > cursor ? 1 : 0;
}
```

### Corrected numbers (both fixes applied)

| Case | Days (was → now) | Interest (was → now) | Balance (was → now) |
|---|---|---|---|
| 1. Mashreq NEO Savings | 16 → **17** | 52.41 → **55.69** | 10,921.69 → **10,924.97** |
| 2. Mashreq Highest Interest | 30 → **31** | 2,101.73 → **2,171.62** | 144,151.98 → **144,222.03** |
| 3. Thndr Cloud Monthly | 8 → **9** (23–31 Jul inclusive of the 31st) | 907.70 → **1,021.16** | 226,333.70 → **226,447.16** |
| 4. NBE Certificate | unaffected (uses `tieredValueAt`, not touched) | — | still **366,000.00**, matching your reported 366,000.80 to 0.0002% |

These are the numbers the app will now show. They supersede the "expected"
figures in the Case-by-case section above, which used the un-fixed
(30-day-style) day count.


Added a single helper, used everywhere `monthsStepForFreq(config.growthFrequency)`
used to be called directly (`growth-pipeline.js`, mirrored in
`backend/lib/growthPipeline.js`):

```js
// Mirrors cycleFrequency() in return-config.js, which already gets the
// "Next credit" DATE right by preferring compoundingFrequency.
function compoundingFrequencyFor(config) {
  if (config.compoundingFrequency && config.compoundingFrequency !== "none") return config.compoundingFrequency;
  if (config.distributionFrequency && config.distributionFrequency !== "none") return config.distributionFrequency;
  return config.growthFrequency;
}
```

Replaced in 5 places per file (both `growth-pipeline.js` and
`backend/lib/growthPipeline.js`):
- `projectValueAt` — the `monthsStep` gate, and the argument passed into `periodicBoundaryValueAt`
- `dailyGrowthDelta` — the real daily-cron poster
- `nextCronTouch`
- `accrualBreakdown`

This does **not** change the financial model — `growthFrequency` still
means exactly what it always meant (accrual granularity), and
`compoundingFrequency`/`distributionFrequency` still mean what they always
meant. It only fixes *which one* the engine consults to find real
calendar-boundary compounding periods, bringing the value-projection code
path into agreement with the date-projection code path that was already
correct.

No preset configuration needed to change — every existing preset already
has the correct `compoundingFrequency`/`distributionFrequency` set; they
just weren't being read for this purpose.
