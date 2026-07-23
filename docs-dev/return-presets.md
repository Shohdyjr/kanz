# Return Presets — Source of Truth

This is the confirmed reference table for `RETURN_PRESETS` in
`docs/js/return-config.js`. **That array is the actual source of truth** —
this file is a human-readable mirror of it, kept in sync by hand. If they
ever disagree, `return-config.js` wins; fix this file to match it, not the
other way around.

Structure confirmed with the user on 2026-07-21. Rates verified against
official bank pages / Thndr / recent Egyptian financial news on
**2026-07-22** — see Sources below. Rates move often (especially NBE/Mashreq,
which track CBE policy); re-check before relying on these for real money.

| Preset | Product Type | Rate Type | Rate Basis | Rate used | Growth Source | Growth Frequency | Balance Basis | Distribution | Compounding | Liquidity | Credit Anchor | Roll Forward |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mashreq NEO Savings | Savings Account | Variable | Nominal (APR) | 11% / 12% / 16%¹ | Fixed Rate | Daily | Tiered by Balance | None (Reinvested) | Monthly | Daily | Calendar Period End | Yes |
| Mashreq Day by Day | Savings Account | Variable | Nominal (APR) | 9% / 10.5% / 15%¹ | Fixed Rate | Daily | Tiered by Balance | None (Reinvested) | Daily | Daily | Daily | No |
| Mashreq Highest Interest Savings | Savings Account | Variable | Nominal (APR) | 18% | Fixed Rate | Daily | Lowest Period Balance | None (Reinvested) | Monthly | Daily | Calendar Period End | Yes |
| NBE Platinum 3-Year Step-Up Certificate | Certificate | Tiered | Nominal (APR) | Y1 22% / Y2 17.5% / Y3 13% | Fixed Rate | Daily | Fixed Principal | Cash Distribution (Annual) | Never | At Maturity | Anniversary Date | Yes |
| Thndr Cloud Daily (Estimated) | Money Market Fund | Variable | Effective (APY) | up to 19.5%² | Fixed Rate | Daily | Current Balance | None (Reinvested) | Daily | Daily | Daily | No |
| Thndr Cloud Monthly (Estimated) | Money Market Fund | Variable | Effective (APY) | up to 20%² | Fixed Rate | Daily | Current Balance | None (Reinvested) | Monthly | Monthly | Calendar Period End | Yes |

¹ Genuinely balance-tiered (`balanceBasis: "tieredByBalance"`) — the whole balance earns whichever band it's currently in, per EGP 5,000–49,999 / 50,000–499,999 / 500,000+ (open-ended top band). See "Balance tiering" below.
² Thndr's advertised yield is variable and "up to" — not guaranteed.

## Sources (checked 2026-07-22)

- Mashreq NEO Saving Account — mashreq.com/en/egypt/neo/accounts/neo-saving-account: tiered **11% / 12% / 16%** for EGP 5,000–49,999 / 50,000–499,999 / 500,000–1,000,000. Interest calculated daily, paid monthly.
- Mashreq Day by Day NEO Account — mashreq.com/en/egypt/neo/accounts/day-by-day-neo-account: tiered **9% / 10.5% / 15%** for the same three balance bands. Interest calculated and paid daily.
- Mashreq NEO Highest Interest Savings Account — mashreq.com/en/egypt/neo/accounts/neo-highest-interest-saving-account: flat **18%** for EGP 50,000–1,000,000 (no minimum to open, but interest only accrues from 50,000). Calculated on lowest balance in the month, paid monthly. No balance tiering — this is the one preset here that's an exact match, not an approximation.
- NBE 3-year decreasing-yield ("step-up"/"step-down") Platinum Certificate — Al-Masry Al-Youm, 5 June 2026: **22% Year 1 / 17.5% Year 2 / 13% Year 3**. (Separate from NBE's flat-rate 3-year Platinum Certificate, which was hiked to 17.25% flat in April 2026 — that's a different product, not modeled here.)
- Thndr Savings Clouds — thndr.app blog: Instant/daily clouds average **up to 19.5%** annually; Monthly clouds average **up to 20%** annually. Both are projected/variable yields on Thndr's underlying FRA-regulated mutual fund, not guaranteed.

## Balance tiering — now genuinely modeled

Mashreq NEO Savings, Mashreq Day by Day, and (in general) many Egyptian
savings accounts pay a **different rate depending on the account's balance
band** (e.g. Mashreq NEO: 11% under 50k, 12% from 50k–500k, 16% above
500k). The engine now supports this directly via
`balanceBasis: "tieredByBalance"` + a `balanceTiers` array (`{min, max,
rate}` per tier — see `resolveTieredRate()` in `growth-pipeline.js`,
mirrored in both the frontend and the backend cron).

Confirmed rules (2026-07-23):
- **Band rate, not marginal/graduated.** The *whole* balance earns
  whichever single tier it currently falls into — not a tax-bracket-style
  "first 50k at 11%, the rest at 12%" split. This matches how Egyptian
  banks publish these rates.
- **Open-ended top tier.** A tier with `max: null` keeps applying to any
  balance above its `min`, however high — it does not stop or cap out.
  (Mashreq's own pages say "maximum balance for interest calculation is
  1,000,000 EGP", i.e. balances above that still earn the top rate; they
  just don't earn *more* than the top rate. `max: null` on the top tier
  models this correctly.)
- **Resolved against the current balance each time growth is computed**
  (daily cron, table projections, simulator) — not re-evaluated mid-period
  as the balance compounds within a single credit period. Same
  lightweight-approximation tradeoff the rest of the engine makes
  elsewhere (e.g. `tierRates`' anniversary-only re-evaluation for
  certificates).

This is a **general** feature — any asset can use `tieredByBalance`, not
just these two presets. The Rate field in the UI is replaced by a "Balance
tiers & rates" textarea (one tier per line, `min-max:rate`, blank max =
open-ended) whenever `balanceBasis` is set to it, exactly like Step-up
rates swap in for a Certificate.

Mashreq Highest Interest Savings has no such tiering — it's genuinely
flat-rate — so it still uses the plain Rate field (`suggestedApy`).

## Thndr presets: deliberately NOT NAV-based

The real Thndr Cloud Daily / Thndr Cloud Monthly funds are NAV/unit-price
products. These two presets intentionally **do not** model that — they are
treated exactly like a fixed-rate product (`growthSource: "fixedRate"`),
same math as any Mashreq savings account, just with `rateBasis: "effective"`
(APY) instead of `"nominal"` (APR). No NAV logic is implemented for them.

`Rate` = an estimated APY (`suggestedApy` in the preset, shown as the
editable Rate field in the UI) — update it by hand whenever the real
published yield moves. Do not change `growthSource` back to `"nav"` for
`thndr_cloud_daily_estimated` / `thndr_cloud_monthly_estimated`.

## Step-up rates are Certificate-only

The "Step-up rates per year" field (`tierRates`) only ever appears — in the
Rate field's exact place — and is only ever required, when **both**:
- Growth Source = Fixed Rate, **and**
- Product Type = Certificate

Every other fixed-rate preset (savings, the two estimated Thndr presets)
uses the single Rate (APY/APR) field instead — `tierRates` stays hidden and
unset for those, and is stripped out on save if present. This is enforced
in `onGrowthSourceChange()` and `readProductConfigForm()` in
`docs/js/return-config.js`. There's no separate "Advanced overrides"
section any more — the Rate/Step-up-rates fields directly swap places in
the Financial Model section.
