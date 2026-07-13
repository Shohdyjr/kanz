// ══════════════════════════════════════════════════════════════════════════
//  Thin backward-compatible wrapper around growthPipeline.js — the single
//  source of truth for all interest-calculation math (see that file for the
//  full rationale). Kept as a separate file only so `require("../lib/growthEngine")`
//  call sites (cron/dailySnapshot.js) don't need to change.
// ══════════════════════════════════════════════════════════════════════════

module.exports = require("./growthPipeline");
