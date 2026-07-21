# Return Presets — Source of Truth

This is the confirmed reference table for `RETURN_PRESETS` in
`docs/js/return-config.js`. **That array is the actual source of truth** —
this file is a human-readable mirror of it, kept in sync by hand. If they
ever disagree, `return-config.js` wins; fix this file to match it, not the
other way around.

Confirmed with the user on 2026-07-21.

| Preset | Product Type | Rate Type | Rate Basis | Growth Source | Growth Frequency | Balance Basis | Distribution Frequency | Compounding Frequency | Liquidity Frequency | Credit Anchor | Roll Forward | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mashreq NEO Savings | Savings Account | Variable | Nominal (APR) | Fixed Rate | Daily | Current Balance | None (Reinvested) | Monthly | Daily | Calendar Period End | Yes | Interest calculated daily, credited monthly at end of calendar month. |
| Mashreq Day by Day | Savings Account | Variable | Nominal (APR) | Fixed Rate | Daily | Current Balance | None (Reinvested) | Daily | Daily | Daily | No | Interest calculated and credited daily. |
| Mashreq Extra Savings | Savings Account | Variable | Nominal (APR) | Fixed Rate | Daily | Lowest Period Balance | None (Reinvested) | Monthly | Daily | Calendar Period End | Yes | Uses the lowest eligible balance during the month. |
| NBE Platinum 3-Year Step-Up Certificate | Certificate | Tiered | Nominal (APR) | Fixed Rate | Daily | Fixed Principal | Cash Distribution (Annual) | Never | At Maturity | Anniversary Date | Yes | Uses `tierRates` for Year 1, Year 2 and Year 3. Step-up rates are mandatory for this preset only — see "Step-up rates are Certificate-only" below. |
| **Thndr Cloud Daily (Estimated)** | Money Market Fund | Variable | Effective (APY) | Fixed Rate | Daily | Current Balance | None (Reinvested) | Daily | Daily | Daily | No | Estimated preset that approximates the real Thndr Cloud Daily using the configured APY (Rate field) instead of NAV. |
| **Thndr Cloud Monthly (Estimated)** | Money Market Fund | Variable | Effective (APY) | Fixed Rate | Daily | Current Balance | None (Reinvested) | Monthly | Monthly | Calendar Period End | Yes | Estimated preset that approximates the real Thndr Cloud Monthly using the configured APY (Rate field) instead of NAV. |

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

The "Step-up rates per year" field (`tierRates`) only ever appears, and is
only ever required, when **both**:
- Growth Source = Fixed Rate, **and**
- Product Type = Certificate

Every other fixed-rate preset (savings, the two estimated Thndr presets)
uses the single Rate (APY/APR) field instead — `tierRates` stays hidden and
unset for those, and is stripped out on save if present. This is enforced
in `onGrowthSourceChange()` and `readProductConfigForm()` in
`docs/js/return-config.js`.

## Open item

`Mashreq Extra Savings` didn't have a published rate in the original
request — `suggestedApy: 16.5` in the preset is a placeholder pending the
real published rate. Update it in `RETURN_PRESETS` in `return-config.js`
once known.
