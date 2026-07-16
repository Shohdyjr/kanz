// ══════════════════════════════════════════════════════════════════════════
//  legacy-config-mapper.js — ONE-TIME migration helper only.
//
//  Converts a pre-migration returnConfig entry (calcMethod / payoutFreq /
//  compounding / liquidity) into the new domain model (growthSource /
//  growthFrequency / distributionFrequency / compoundingFrequency /
//  liquidityFrequency / balanceBasis). Used exclusively by
//  migrate-to-domain-model.js.
//
//  This file must NOT be imported by growthPipeline.js, the cron, or any
//  route — the production engine consumes the new domain model directly and
//  has no knowledge of the legacy fields. Once every user's data has been
//  migrated (see migrate-to-domain-model.js), this file can be deleted too.
// ══════════════════════════════════════════════════════════════════════════

function monthsStepForFreq(frequency) {
  if (frequency === "monthly") return 1;
  if (frequency === "quarterly") return 3;
  if (frequency === "semiAnnual") return 6;
  if (frequency === "annual" || frequency === "maturity") return 12;
  return null;
}

// Old payoutFreq allowed "annual"; some very old records may still say
// "yearly" (the label financial-product-engine.js — since deleted — used).
function canonicalFreq(freq) {
  return freq === "yearly" ? "annual" : freq;
}

function legacyConfigToDomainModel(old) {
  const legacy = old || {};
  const isNav = legacy.calcMethod === "navBased" || legacy.calcMethod === "dailyBalance";
  const hasFormula = !!legacy.growthFormula;
  const payoutFreq = canonicalFreq(legacy.payoutFreq);
  const scheduled = !!(legacy.startDate && monthsStepForFreq(payoutFreq));

  const growthSource = hasFormula ? "manual" : isNav ? "nav" : "fixedRate";
  const growthFrequency = isNav ? "daily" : payoutFreq || "daily";
  const balanceBasis = legacy.calcMethod === "fixedPrincipal" ? "fixedPrincipal" : "currentBalance";

  // compoundingFrequency: legacy.compounding===true (or unset — the old
  // default) meant "reinvest"; explicit false meant "don't". NAV products
  // always compound (there is no other place for the growth to go).
  const legacyReinvests = legacy.compounding !== false;
  const compoundingFrequency = isNav || legacyReinvests ? growthFrequency : "none";

  // distributionFrequency: only the "reinvest === false" branches actually
  // distributed anything under the old engine.
  //   - scheduled + compounding:false  -> distributes on the schedule
  //   - growthFormula + compounding:false -> distributes daily (formula
  //     reruns every cron tick regardless of schedule)
  //   - no schedule, no formula, compounding:false -> old dailyGrowthDelta
  //     returned null (nothing ever auto-posted); the closest honest label
  //     is "maturity" (paid at some single future point the app doesn't
  //     track automatically) rather than inventing a fake cadence.
  let distributionFrequency = "none";
  if (!isNav && legacy.compounding === false) {
    if (scheduled) distributionFrequency = payoutFreq;
    else if (hasFormula) distributionFrequency = "daily";
    else distributionFrequency = "maturity";
  }

  const liquidityFrequency = legacy.liquidity || (scheduled ? payoutFreq : "daily");

  const next = {
    growthSource,
    growthFrequency,
    distributionFrequency,
    compoundingFrequency,
    liquidityFrequency,
    balanceBasis,
    rateBasis: legacy.rateBasis === "nominal" ? "nominal" : "effective",
  };
  if (legacy.startDate) next.startDate = legacy.startDate;
  if (legacy.growthFormula) next.growthFormula = legacy.growthFormula;
  if (Array.isArray(legacy.tierRates) && legacy.tierRates.length) {
    next.tierRates = legacy.tierRates;
    next.growthSource = "fixedRate"; // tiered certificates are always fixed-rate step-ups
  }
  return next;
}

module.exports = { legacyConfigToDomainModel, monthsStepForFreq, canonicalFreq };
