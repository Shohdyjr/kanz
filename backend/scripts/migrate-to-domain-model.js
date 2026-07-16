// ══════════════════════════════════════════════════════════════════════════
//  migrate-to-domain-model.js — ONE-TIME migration.
//
//  Converts every user's stored returnConfig (data.returnConfig in the
//  kanz_users table) from the legacy calcMethod/payoutFreq/compounding/
//  liquidity shape to the new domain model (growthSource/growthFrequency/
//  distributionFrequency/compoundingFrequency/liquidityFrequency/
//  balanceBasis) — see backend/lib/growthPipeline.js for the model itself.
//
//  Usage:
//    node backend/scripts/migrate-to-domain-model.js            # dry run, prints a report, writes nothing
//    node backend/scripts/migrate-to-domain-model.js --apply    # writes the migrated data back
//
//  Requires the same DATABASE_URL / env the backend server itself uses
//  (backend/db/pool.js) — run this from wherever the backend normally runs,
//  against the real Postgres database. This script was written and unit-
//  tested in this session, but was NOT executed against production data —
//  there is no DB access from this environment. Run the dry run first,
//  review the report, THEN run --apply once you're satisfied.
//
//  Safe to re-run: entries that are already domain-model-shaped (have a
//  `growthSource`) are left untouched.
// ══════════════════════════════════════════════════════════════════════════

const pool = require("../db/pool");
const { legacyConfigToDomainModel } = require("./legacy-config-mapper");
const { validateDomainModel } = require("../lib/growthPipeline");

async function migrateAllUsers({ apply }) {
  const { rows } = await pool.query("SELECT username, data FROM kanz_users");
  const report = { usersScanned: 0, usersChanged: 0, itemsMigrated: 0, itemsAlreadyMigrated: 0, itemsSkippedInvalid: [] };

  for (const row of rows) {
    report.usersScanned++;
    const data = row.data || {};
    const returnConfig = data.returnConfig || {};
    let changed = false;
    const nextReturnConfig = {};

    for (const [itemId, entry] of Object.entries(returnConfig)) {
      if (entry && entry.growthSource) {
        // Already migrated (re-run safety).
        nextReturnConfig[itemId] = entry;
        report.itemsAlreadyMigrated++;
        continue;
      }
      const migrated = legacyConfigToDomainModel(entry || {});
      const result = validateDomainModel(migrated);
      if (!result.valid) {
        report.itemsSkippedInvalid.push({ username: row.username, itemId, errors: result.errors, legacy: entry });
        // Keep the legacy entry as-is rather than writing something invalid —
        // needs a human look (see report). Does not block other items/users.
        nextReturnConfig[itemId] = entry;
        continue;
      }
      nextReturnConfig[itemId] = migrated;
      report.itemsMigrated++;
      changed = true;
    }

    if (changed) {
      report.usersChanged++;
      if (apply) {
        const updatedData = { ...data, returnConfig: nextReturnConfig };
        await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [
          JSON.stringify(updatedData),
          row.username,
        ]);
      }
    }
  }

  return report;
}

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  migrateAllUsers({ apply })
    .then((report) => {
      console.log(`\n${apply ? "APPLIED" : "DRY RUN (no writes — pass --apply to write)"} migration report`);
      console.log("──────────────────────────────────────────");
      console.log(`Users scanned:            ${report.usersScanned}`);
      console.log(`Users with changes:       ${report.usersChanged}`);
      console.log(`Items migrated:           ${report.itemsMigrated}`);
      console.log(`Items already migrated:   ${report.itemsAlreadyMigrated}`);
      console.log(`Items skipped (invalid):  ${report.itemsSkippedInvalid.length}`);
      if (report.itemsSkippedInvalid.length) {
        console.log("\nInvalid items (left as legacy — review by hand):");
        for (const item of report.itemsSkippedInvalid) {
          console.log(`  - ${item.username} / ${item.itemId}: ${item.errors.join("; ")}`);
        }
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { migrateAllUsers };
