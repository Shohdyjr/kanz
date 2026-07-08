const pool = require("../db/pool");

const OUNCE_TO_GRAM = 31.1034768;
const GOLD_CACHE_KEY = "last_gold_usd_per_gram";

/** Currency each built-in ("base") asset is denominated in. */
const BASE_ASSET_CURRENCY = {
  thunder_save: "EGP",
  thunder_invest: "EGP",
  tilda_invest: "EGP",
  ahli: "EGP",
  mashreq: "EGP",
  car: "EGP",
  usd: "USD",
  eur: "EUR",
  sar: "SAR",
  gold: "GOLD",
};

const HARD_CURRENCIES = ["USD", "EUR", "SAR"];

/** Default portfolio shape for a newly created user. */
function defaultUserData() {
  const customAssets = [
    { id: "default_bank", name_ar: "بنك", name_en: "Bank", icon: "🏦", currency: "EGP" },
    { id: "default_hard", name_ar: "عملة صعبة", name_en: "Hard Currency", icon: "💵", currency: "USD" },
    { id: "default_gold", name_ar: "ذهب", name_en: "Gold", icon: "🪙", currency: "GOLD" },
    { id: "default_asset", name_ar: "أصول", name_en: "Assets", icon: "🚗", currency: "EGP" },
  ];
  return {
    qty: { default_bank: 0, default_hard: 0, default_gold: 0, default_asset: 0 },
    customAssets,
    excludedBaseIds: Object.keys(BASE_ASSET_CURRENCY),
    baseOverrides: {},
    theme: "dark",
    lang: "en",
    order: customAssets.map((a) => a.id),
  };
}

async function fetchHourlyRates() {
  try {
    const res = await fetch("https://api.exchangerate.fun/latest?base=USD");
    const json = await res.json();
    if (!json.rates?.EGP) return null;
    return { egpPerUsd: json.rates.EGP, eurPerUsd: json.rates.EUR, sarPerUsd: json.rates.SAR };
  } catch {
    return null;
  }
}

async function fetchDailyRatesFallback() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  const fx = await res.json();
  return { egpPerUsd: fx.rates.EGP, eurPerUsd: fx.rates.EUR, sarPerUsd: fx.rates.SAR };
}

/**
 * Gold price has no second live provider baked into the original design, so a
 * single API hiccup used to fail fetchRatesServerSide() entirely — which in
 * turn failed the daily snapshot cron for every user, not just the gold
 * portion of it. This tries two independent free/no-key sources, and if both
 * are down, falls back to the last successfully-fetched price cached in
 * Postgres (kanz_settings) so the process degrades instead of failing.
 */
async function fetchGoldUsdPerOunce() {
  try {
    const res = await fetch("https://api.gold-api.com/price/XAU");
    const json = await res.json();
    const price = json.price ?? json.rate ?? json.value;
    if (typeof price === "number" && price > 0) return price;
  } catch (err) {
    console.warn("fetchGoldUsdPerOunce: primary source (gold-api.com) failed:", err.message);
  }

  try {
    // goldprice.org's public data feed — unofficial, but free and keyless.
    const res = await fetch("https://data-asg.goldprice.org/dbXRates/USD");
    const json = await res.json();
    const price = json?.items?.[0]?.xauPrice;
    if (typeof price === "number" && price > 0) return price;
  } catch (err) {
    console.warn("fetchGoldUsdPerOunce: fallback source (goldprice.org) failed:", err.message);
  }

  return null;
}

async function getCachedGoldUsdPerGram() {
  try {
    const { rows } = await pool.query("SELECT value FROM kanz_settings WHERE key = $1", [GOLD_CACHE_KEY]);
    const value = rows[0]?.value?.price;
    return typeof value === "number" ? value : null;
  } catch (err) {
    console.error("getCachedGoldUsdPerGram: cache read failed:", err.message);
    return null;
  }
}

/** Best-effort — a failed cache write should never break a successful rate fetch. */
async function cacheGoldUsdPerGram(value) {
  try {
    await pool.query(
      `INSERT INTO kanz_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [GOLD_CACHE_KEY, JSON.stringify({ price: value })]
    );
  } catch (err) {
    console.error("cacheGoldUsdPerGram: cache write failed:", err.message);
  }
}

/**
 * Fetches current FX rates plus gold price (USD/gram), server-side.
 * `goldStale: true` on the result means live gold sources were unavailable
 * and a cached (or zero, if no cache exists yet) price was used instead —
 * callers may want to surface that to the user rather than treat it as live.
 */
async function fetchRatesServerSide() {
  const fx = (await fetchHourlyRates()) || (await fetchDailyRatesFallback());

  const ounce = await fetchGoldUsdPerOunce();
  if (ounce !== null) {
    fx.goldUsdPerGram = ounce / OUNCE_TO_GRAM;
    fx.goldStale = false;
    cacheGoldUsdPerGram(fx.goldUsdPerGram); // fire-and-forget
    return fx;
  }

  const cached = await getCachedGoldUsdPerGram();
  fx.goldUsdPerGram = cached ?? 0;
  fx.goldStale = true;
  console.warn(
    cached !== null
      ? "fetchRatesServerSide: live gold sources unavailable — using last cached price."
      : "fetchRatesServerSide: live gold sources unavailable and no cached price exists — gold valued at 0."
  );
  return fx;
}

function priceForServerSide(currency, rates) {
  switch (currency) {
    case "USD":
      return 1;
    case "EGP":
      return 1 / rates.egpPerUsd;
    case "EUR":
      return 1 / rates.eurPerUsd;
    case "SAR":
      return 1 / rates.sarPerUsd;
    case "GOLD":
      return rates.goldUsdPerGram;
    default:
      return 0;
  }
}

/** Computes a portfolio snapshot (grouped USD totals) for a given day. */
function computeSnapshot(userData, rates, dateStr) {
  const excludedIds = userData.excludedBaseIds || [];
  const overrides = userData.baseOverrides || {};
  const customAssets = (userData.customAssets || []).map((c) => ({
    id: c.id,
    currency: c.currency,
    isAsset: !!c.isAsset,
  }));
  const qty = userData.qty || {};

  const baseAssets = Object.keys(BASE_ASSET_CURRENCY)
    .filter((id) => !excludedIds.includes(id))
    .map((id) => {
      const override = overrides[id];
      return {
        id,
        currency: BASE_ASSET_CURRENCY[id],
        isAsset: typeof override?.isAsset === "boolean" ? override.isAsset : id === "car",
      };
    });

  const totals = { egpUsd: 0, hardUsd: 0, goldUsd: 0, assetsUsd: 0 };

  for (const asset of [...baseAssets, ...customAssets]) {
    const value = (parseFloat(qty[asset.id]) || 0) * priceForServerSide(asset.currency, rates);
    if (asset.isAsset) totals.assetsUsd += value;
    else if (asset.currency === "EGP") totals.egpUsd += value;
    else if (asset.currency === "GOLD") totals.goldUsd += value;
    else if (HARD_CURRENCIES.includes(asset.currency)) totals.hardUsd += value;
  }

  return {
    date: dateStr,
    totalUsd: totals.egpUsd + totals.hardUsd + totals.goldUsd + totals.assetsUsd,
    ...totals,
  };
}

module.exports = {
  OUNCE_TO_GRAM,
  BASE_ASSET_CURRENCY,
  defaultUserData,
  fetchRatesServerSide,
  priceForServerSide,
  computeSnapshot,
  // Exported for unit testing; fetchRatesServerSide() remains the entry point
  // every real call site should use.
  fetchGoldUsdPerOunce,
  getCachedGoldUsdPerGram,
  cacheGoldUsdPerGram,
};
